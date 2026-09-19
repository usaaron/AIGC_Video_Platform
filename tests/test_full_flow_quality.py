"""Acceptance reports must not inflate text volume or mistake partial runs for completion."""
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('full_flow_quality', Path(__file__).parents[1] / 'scripts/review_full_flow_quality.py')
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)


def bundle():
    draft = {'title': '不计入的标题', 'synopsis': '不计入的重复介绍' * 100,
             'scenes': [{'scene_number': 1, 'slug': 'INT. 屋内',
                         'character_actions': ['抬手。'], 'dialogues': [{'text': '别动。'}]}]}
    return {'workspace': {'id': 'test', 'title': '测试', 'generationSettings': {'episodeCount': 72, 'targetTotalCharacters': 100000},
                          'episodeRoadmaps': [{'episode_number': 1, 'status': 'approved'}],
                          'episodes': [{'episodeNumber': 1, 'workingDraftJson': json.dumps(draft),
                                        'generationRun': {'draft_master_script': draft}}]},
            'storyboards': [{'episode_number': 1, 'source_draft': draft, 'scenes': [{'scene_number': 1,
                            'shots': [{'source_refs': ['action:0', 'dialogue:0'], 'duration_seconds': 4}]}]}]}


def test_body_count_excludes_synopsis_internal_metadata_and_alternative_versions():
    result = quality.audit(bundle())
    assert result['bodyCharacters'] == 4
    assert result['completeStoryboards'] == 1
    assert result['flowComplete'] is False
    assert result['missing']['scripts'] == list(range(2, 73))


def test_storyboard_coverage_requires_every_source_ref_and_current_body():
    data = bundle()
    data['workspace']['generationSettings'] = {'episodeCount': 1, 'targetTotalCharacters': 4}
    assert quality.audit(data)['flowComplete'] is True
    data['storyboards'][0]['scenes'][0]['shots'][0]['source_refs'] = ['action:0']
    assert quality.audit(data)['completeStoryboards'] == 0
    assert quality.audit(data)['episodes'][0]['uncoveredSourceRefs'] == ['1/dialogue:0']
    data['storyboards'][0]['scenes'][0]['shots'][0]['source_refs'].append('dialogue:0')
    data['storyboards'][0]['source_draft']['scenes'][0]['dialogues'][0]['text'] = '走。'
    assert quality.audit(data)['episodes'][0]['sourceBodyMatches'] is False


def test_character_count_matches_frontend_unicode_letter_and_number_rule():
    assert quality.effective_characters(' A 汉 １２！🙂') == 4


def test_memory_audit_distinguishes_missing_evidence_from_valid_and_future_facts():
    data = bundle()
    assert quality.audit(data)['episodes'][0]['memoryBoundaryStatus'] == 'not_recorded'
    run = data['workspace']['episodes'][0]['generationRun']
    run['episode_context'] = {'memory_recall': {
        'status': 'sufficient', 'through_episode_number': 0,
        'capsules': [{'capsule_id': 'known-at-start', 'source_episode': 0,
                      'knowledge_states': [{'source_episode_number': 0}]}],
    }}
    assert quality.audit(data)['episodes'][0]['memoryBoundaryStatus'] == 'passed'
    run['episode_context']['memory_recall']['capsules'][0]['knowledge_states'][0]['source_episode_number'] = 2
    report = quality.audit(data)
    assert report['episodes'][0]['memoryBoundaryStatus'] == 'failed'
    assert report['episodes'][0]['futureMemorySources'] == ['known-at-start']
    assert any(f['stage'] == 'memory' for f in report['findings'])
