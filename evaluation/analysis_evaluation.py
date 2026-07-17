from __future__ import annotations

from evaluation.models import BenchmarkScenario, ComponentEvaluation


class AnalysisEvaluator:
    def evaluate(
        self,
        *,
        benchmark: BenchmarkScenario,
        aggregated_topics: list[str],
        aggregated_genre_tags: list[str],
        aggregated_emotion_tags: list[str],
        preference_score: float,
        audience_signal_summary: str,
        commercial_signal_summary: str,
        recommended_hook_type: str,
        recommended_cliffhanger_type: str,
    ) -> ComponentEvaluation:
        details: list[str] = []
        score_parts: list[float] = []
        expected = benchmark.expected_analysis

        topic_hits = len(set(aggregated_topics) & set(expected.topics))
        topic_score = topic_hits / max(len(expected.topics), 1)
        score_parts.append(topic_score)
        details.append(f"Matched {topic_hits}/{len(expected.topics)} expected topics.")

        genre_hits = len(set(aggregated_genre_tags) & set(expected.genre_tags))
        genre_score = genre_hits / max(len(expected.genre_tags), 1)
        score_parts.append(genre_score)
        details.append(f"Matched {genre_hits}/{len(expected.genre_tags)} expected genre tags.")

        emotion_hits = len(set(aggregated_emotion_tags) & set(expected.emotion_tags))
        emotion_score = emotion_hits / max(len(expected.emotion_tags), 1)
        score_parts.append(emotion_score)
        details.append(f"Matched {emotion_hits}/{len(expected.emotion_tags)} expected emotion tags.")

        preference_in_range = expected.preference_score_range[0] <= preference_score <= expected.preference_score_range[1]
        score_parts.append(1.0 if preference_in_range else 0.0)
        details.append(
            f"Preference score {preference_score:.3f} {'is' if preference_in_range else 'is not'} within expected range."
        )

        hook_match = recommended_hook_type == expected.recommended_hook_type
        cliffhanger_match = (
            recommended_cliffhanger_type == expected.recommended_cliffhanger_type
        )
        score_parts.append(1.0 if hook_match else 0.0)
        score_parts.append(1.0 if cliffhanger_match else 0.0)
        details.append(f"Hook type match: {hook_match}.")
        details.append(f"Cliffhanger type match: {cliffhanger_match}.")

        audience_match = expected.audience_signal.lower().split()[0] in audience_signal_summary.lower()
        commercial_match = any(
            token in commercial_signal_summary.lower()
            for token in expected.commercial_signal.lower().split()[:2]
        )
        score_parts.append(1.0 if audience_match else 0.5)
        score_parts.append(1.0 if commercial_match else 0.5)
        details.append(f"Audience signal alignment: {audience_match}.")
        details.append(f"Commercial signal alignment: {commercial_match}.")

        score = round(sum(score_parts) / len(score_parts), 3)
        return ComponentEvaluation(
            component_name="analysis_evaluation",
            score=score,
            passed=score >= 0.7,
            details=details,
            artifacts={
                "aggregated_topics": aggregated_topics,
                "aggregated_genre_tags": aggregated_genre_tags,
                "aggregated_emotion_tags": aggregated_emotion_tags,
            },
        )
