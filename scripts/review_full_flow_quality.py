#!/usr/bin/env python3
"""Collect reproducible full-flow evidence; literary assessments are authored separately.

Only action and dialogue count toward the body target. Metadata, alternative drafts,
planning contracts and storyboard descriptions never contribute to that count.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import unicodedata
import urllib.error
import urllib.request


def effective_characters(text: str) -> int:
    return sum(unicodedata.category(c)[0] in {'L', 'N'} for c in unicodedata.normalize('NFKC', text))


def working_draft(episode: dict) -> dict:
    raw = episode.get('workingDraftJson')
    if raw:
        return json.loads(raw) if isinstance(raw, str) else raw
    return (episode.get('generationRun') or {}).get('draft_master_script') or {}


def body_parts(draft: dict) -> tuple[list[str], list[str]]:
    scenes = draft.get('scenes') or []
    return ([str(a) for scene in scenes for a in scene.get('character_actions', [])],
            [str(d.get('text', '')) for scene in scenes for d in scene.get('dialogues', [])])


def screenplay_text(draft: dict) -> str:
    parts = [draft.get('title', '')]
    for scene in draft.get('scenes', []):
        parts.append(scene.get('scene_heading') or scene.get('setting_hint') or scene.get('slug', ''))
        actions = scene.get('character_actions', [])
        dialogue = scene.get('dialogues', [])
        used = set()
        for ref in scene.get('body_order', []):
            try:
                kind, raw_index = ref.split(':'); index = int(raw_index)
                if ref in used:
                    continue
                if kind == 'action':
                    parts.append(actions[index])
                elif kind == 'dialogue':
                    d = dialogue[index]; parts.append(d.get('character_name', '') + '：' + d.get('text', ''))
                else:
                    continue
                used.add(ref)
            except (ValueError, IndexError, AttributeError):
                continue
        parts.extend(a for i, a in enumerate(actions) if f'action:{i}' not in used)
        parts.extend(d.get('character_name', '') + '：' + d.get('text', '')
                     for i, d in enumerate(dialogue) if f'dialogue:{i}' not in used)
        parts.append('')
    return '\n'.join(parts)


def audit(bundle: dict) -> dict:
    ws = bundle['workspace']; settings = ws.get('generationSettings', {})
    count = settings.get('episodeCount', 0); target = settings.get('targetTotalCharacters', 0)
    expected = set(range(1, count + 1)); rows = []; findings = list(bundle.get('collectionErrors', []))
    roadmap_numbers = [p['episode_number'] for p in ws.get('episodeRoadmaps', [])]
    approved = {p['episode_number'] for p in ws.get('episodeRoadmaps', []) if p.get('status') == 'approved'}
    boards = {p['episode_number']: p for p in bundle.get('storyboards', [])}
    roadmap_by_number = {p['episode_number']: p for p in ws.get('episodeRoadmaps', [])}
    for episode in sorted(ws.get('episodes', []), key=lambda e: e['episodeNumber']):
        number = episode['episodeNumber']; draft = working_draft(episode)
        actions, dialogues = body_parts(draft); action_count = sum(map(effective_characters, actions))
        dialogue_count = sum(map(effective_characters, dialogues))
        text = screenplay_text(draft); board = boards.get(number)
        row = {'episode': number, 'actionCharacters': action_count, 'dialogueCharacters': dialogue_count,
               'bodyCharacters': action_count + dialogue_count, 'sceneCount': len(draft.get('scenes', [])),
               'dialogueLines': len(dialogues), 'storyboardComplete': False, 'shots': 0,
               'storyboardDuration': 0, 'uncoveredSourceRefs': [], 'missingStoryboardScenes': []}
        row['rushedStoryboardShots'] = []
        runtime = roadmap_by_number.get(number, {}).get('target_duration_seconds')
        row['plannedRuntimeSeconds'] = runtime
        row['dialogueCharactersPerSecond'] = round(dialogue_count / runtime, 2) if runtime else None
        context = (episode.get('generationRun') or {}).get('episode_context') or {}
        recall = context.get('memory_recall')
        row['memoryBoundaryStatus'] = 'not_recorded'
        row['futureMemorySources'] = []
        if recall:
            row['memoryThroughEpisode'] = recall.get('through_episode_number')
            for capsule in recall.get('capsules', []):
                sources = [capsule.get('source_episode')]
                sources += [fact.get('source_episode_number') for fact in capsule.get('knowledge_states', [])]
                if any(isinstance(source, int) and source >= number for source in sources):
                    row['futureMemorySources'].append(capsule.get('capsule_id'))
            through = row['memoryThroughEpisode']
            invalid = bool(row['futureMemorySources'] or (isinstance(through, int) and through >= number))
            row['memoryBoundaryStatus'] = 'failed' if invalid else 'passed'
            if invalid:
                findings.append({'stage': 'memory', 'episode': number, 'issue': '写作记忆包含本集或未来状态'})
            if recall.get('status') == 'insufficient':
                findings.append({'stage': 'memory', 'episode': number, 'issue': '写作请求携带未满足的记忆要求',
                                 'missing': recall.get('missing_requirements', [])})
        metadata = draft.get('llm_metadata') or {}
        row['modelPasses'] = metadata.get('model_pass_count')
        row['successfulGenerationSeconds'] = round(metadata['generation_elapsed_ms'] / 1000, 1) if metadata.get('generation_elapsed_ms') else None
        row['preparedSceneContract'] = (context.get('approved_episode_plan') or {}).get('execution_ready')
        row['actingProfileInstructionIncluded'] = '长期表演：' in (context.get('episode_instruction') or '')
        if not row['sceneCount'] or not row['bodyCharacters']:
            findings.append({'stage': 'script', 'episode': number, 'issue': '正文为空'})
        if re.search(r'character\.[a-z_]|sl_[a-z_]|待补充|待生成', text):
            findings.append({'stage': 'script', 'episode': number, 'issue': '正文含内部引用或占位语句，请核查上下文'})
        if board:
            source = board.get('source_draft', {}); scenes = board.get('scenes', [])
            by_number = {s['scene_number']: s for s in scenes}
            row['unresolvedStoryboardQuestions'] = sum(len(scene.get('unresolved_questions', [])) for scene in scenes)
            row['shotsWithActingDirection'] = sum(bool(shot.get('acting_direction', {}).get('objective')) for scene in scenes for shot in scene.get('shots', []))
            row['shotsWithFirstFrame'] = sum(bool(shot.get('prompt_plan', {}).get('first_frame')) for scene in scenes for shot in scene.get('shots', []))
            for original in draft.get('scenes', []):
                scene_number = original['scene_number']; compiled = by_number.get(scene_number)
                if compiled is None:
                    row['missingStoryboardScenes'].append(scene_number); continue
                expected_refs = {f'action:{i}' for i in range(len(original.get('character_actions', [])))}
                expected_refs |= {f'dialogue:{i}' for i in range(len(original.get('dialogues', [])))}
                actual_refs = {r for shot in compiled.get('shots', []) for r in shot.get('source_refs', [])}
                row['uncoveredSourceRefs'].extend(f'{scene_number}/{r}' for r in sorted(expected_refs - actual_refs))
                shots = compiled.get('shots', []); row['shots'] += len(shots)
                row['storyboardDuration'] += sum(s.get('duration_seconds', 0) for s in shots)
                source_scene = next((s for s in source.get('scenes', []) if s['scene_number'] == scene_number), {})
                source_lines = source_scene.get('dialogues', [])
                for shot_number, shot in enumerate(shots, 1):
                    spoken_seconds = 0
                    for ref in shot.get('source_refs', []):
                        if not ref.startswith('dialogue:'):
                            continue
                        try:
                            line = source_lines[int(ref.split(':')[1])]['text']
                        except (ValueError, IndexError, KeyError):
                            continue
                        chinese = len(re.findall(r'[\u3400-\u9fff]', line))
                        english = len(re.findall(r"[A-Za-z]+(?:['’-][A-Za-z]+)*", line))
                        spoken_seconds += chinese / 4.2 if chinese >= english else english / 2.7
                    allocated = shot.get('duration_seconds', 0)
                    if spoken_seconds > allocated * 1.2 + 1:
                        row['rushedStoryboardShots'].append({'scene': scene_number, 'shot': shot_number,
                            'allocatedSeconds': allocated, 'referenceSpokenSeconds': round(spoken_seconds, 1)})
                if not shots:
                    findings.append({'stage': 'storyboard', 'episode': number, 'scene': scene_number, 'issue': '空镜头场景'})
            source_matches = body_parts(source) == body_parts(draft)
            row['sourceBodyMatches'] = source_matches
            content = lambda value: {key: item for key, item in value.items() if key not in {'llm_metadata', 'created_at', 'updated_at'}}
            row['sourceContentMatches'] = content(source) == content(draft)
            row['storyboardComplete'] = bool(row['sceneCount'] and row['shots'] and source_matches and row['sourceContentMatches']
                and all(scene.get('shots') for scene in scenes)
                and not any(f.get('severity') == 'error' for f in board.get('findings', []))
                and not row['missingStoryboardScenes'] and not row['uncoveredSourceRefs']
                and not board.get('candidate') and not board.get('stale_scene_numbers'))
            row['storyboardFindings'] = board.get('findings', [])
        rows.append(row)
    present = {r['episode'] for r in rows}; complete_boards = {r['episode'] for r in rows if r['storyboardComplete']}
    body_count = sum(r['bodyCharacters'] for r in rows)
    missing = {'roadmaps': sorted(expected - set(roadmap_numbers)), 'approvedRoadmaps': sorted(expected - approved),
               'scripts': sorted(expected - present), 'completeStoryboards': sorted(expected - complete_boards)}
    duplicates = {key: [n for n, amount in Counter(nums).items() if amount > 1] for key, nums in
                  [('roadmaps', roadmap_numbers), ('scripts', [r['episode'] for r in rows])]}
    return {'projectId': ws['id'], 'title': ws['title'], 'targetEpisodes': count, 'targetCharacters': target,
            'bodyCharacters': body_count, 'bodyTargetRatio': body_count / target if target else None,
            'roadmaps': len(roadmap_numbers), 'approvedRoadmaps': len(approved), 'scripts': len(rows),
            'completeStoryboards': len(complete_boards), 'missing': missing, 'duplicates': duplicates,
            'storyboardShotsWithTimingWarnings': sum(len(r['rushedStoryboardShots']) for r in rows),
            'flowComplete': bool(count and not any(missing.values()) and not any(duplicates.values())
                                 and not bundle.get('collectionErrors')),
            'targetReached': bool(target and body_count >= target), 'episodes': rows, 'findings': findings}


def collect(base: str, project_id: str) -> dict:
    def get(path):
        with urllib.request.urlopen(base.rstrip('/') + path, timeout=30) as response:
            return json.load(response)['data']
    ws = get(f'/story-projects/{project_id}/workspace')['workspace_payload']
    result = {'capturedAt': datetime.now(timezone.utc).isoformat(), 'workspace': ws,
              'storyboards': [], 'collectionErrors': []}
    for number in range(1, ws.get('generationSettings', {}).get('episodeCount', 0) + 1):
        try:
            result['storyboards'].append(get(f'/story-projects/{project_id}/episodes/{number}/storyboard'))
        except urllib.error.HTTPError as error:
            if error.code != 404:
                result['collectionErrors'].append({'stage': 'collection', 'episode': number, 'httpStatus': error.code})
        except (OSError, ValueError) as error:
            result['collectionErrors'].append({'stage': 'collection', 'episode': number, 'error': str(error)})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base', nargs='?', default='http://127.0.0.1:8010')
    parser.add_argument('project_id', nargs='?', default='7ba0653a-cf7e-49d7-bb36-5e2c4bb3d1d0')
    parser.add_argument('output', nargs='?', default='.cache/full-flow-72-20260915/review')
    parser.add_argument('--snapshot', type=Path, help='Evaluate a previously collected bundle offline')
    args = parser.parse_args(); out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
    bundle = json.loads(args.snapshot.read_text()) if args.snapshot else collect(args.base, args.project_id)
    report = audit(bundle)
    for filename, value in [('evidence-bundle.json', bundle), ('quality-metrics.json', report)]:
        (out / filename).write_text(json.dumps(value, ensure_ascii=False, indent=2))
    scripts = out / 'screenplays'; scripts.mkdir(exist_ok=True)
    for episode in bundle['workspace'].get('episodes', []):
        (scripts / f'episode-{episode["episodeNumber"]:03d}.txt').write_text(screenplay_text(working_draft(episode)))
    lines = ['# 全流程验收：可复核指标', '', f'项目：{report["title"]}；采集时间：{bundle["capturedAt"]}', '',
             f'规划 {report["roadmaps"]}/{report["targetEpisodes"]}；批准 {report["approvedRoadmaps"]}；'
             f'剧本 {report["scripts"]}；完整分镜 {report["completeStoryboards"]}。', '',
             f'正文有效字符 {report["bodyCharacters"]:,} / 目标 {report["targetCharacters"]:,}。', '',
             f'分镜口播时长待核对：{report["storyboardShotsWithTimingWarnings"]} 镜。按每秒4.2个汉字或2.7个英文词估算，超过已分配时长的1.2倍加1秒时提示；这是节奏复核参考，不替代表演实测。', '',
             '口径：NFKC 规范化后仅统计动作和对白中的字母、汉字和数字。人物档案、梗概、记忆、规划、分镜及重复版本不计入正文。', '',
             f'全流程覆盖：{"完整" if report["flowComplete"] else "未完成"}。字数目标：{"已达到" if report["targetReached"] else "尚未达到"}。', '',
             '以下为结构和来源检查，不能替代人物、对白、因果与节奏的专业审读。文学评价另附实际段落证据，未生成阶段不评分。', '',
             '| 集数 | 正文字数 | 动作 | 对白 | 场数 | 镜头 | 分镜完整 |', '|---|---:|---:|---:|---:|---:|---|']
    lines.extend(f'| {r["episode"]} | {r["bodyCharacters"]} | {r["actionCharacters"]} | {r["dialogueCharacters"]} | '
                 f'{r["sceneCount"]} | {r["shots"]} | {"是" if r["storyboardComplete"] else "否"} |' for r in report['episodes'])
    lines += ['', '缺失项：', '', '```json', json.dumps(report['missing'], ensure_ascii=False, indent=2), '```']
    (out / 'quality-metrics.md').write_text('\n'.join(lines))
    print(json.dumps({k: v for k, v in report.items() if k not in {'episodes', 'findings', 'missing'}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
