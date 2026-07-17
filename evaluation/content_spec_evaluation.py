from __future__ import annotations

from app.modules.content_spec.models import ContentSpec
from evaluation.models import BenchmarkScenario, ComponentEvaluation


class ContentSpecEvaluator:
    def evaluate(
        self,
        *,
        benchmark: BenchmarkScenario,
        content_spec: ContentSpec,
    ) -> ComponentEvaluation:
        expected = benchmark.expected_analysis
        tag_ids = [tag.ontology_node_id for tag in content_spec.tags]
        genre_hits = len(set(tag_ids) & set(expected.genre_tags))
        emotion_hits = len(set(tag_ids) & set(expected.emotion_tags))
        hook_type_match = expected.recommended_hook_type.split()[0] in content_spec.creative_brief.hook.lower()
        score_parts = [
            genre_hits / max(len(expected.genre_tags), 1),
            emotion_hits / max(len(expected.emotion_tags), 1),
            1.0 if content_spec.platform_goal.target_duration_seconds <= 60 else 0.0,
            1.0 if content_spec.creative_brief.target_emotion else 0.5,
            1.0 if hook_type_match else 0.6,
        ]
        score = round(sum(score_parts) / len(score_parts), 3)
        return ComponentEvaluation(
            component_name="content_spec_evaluation",
            score=score,
            passed=score >= 0.68,
            details=[
                f"Matched {genre_hits} expected genre tags.",
                f"Matched {emotion_hits} expected emotion tags.",
                f"Creative brief hook alignment: {hook_type_match}.",
            ],
            artifacts={"tag_ids": tag_ids, "creative_hook": content_spec.creative_brief.hook},
        )
