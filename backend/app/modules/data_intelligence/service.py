from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any

from app.modules.content_spec.models import (
    ContentSpec,
    ContentSpecCreate,
    CreativeBrief,
    PlatformGoal,
    TagRef,
    TargetGoal,
)
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.content_spec.service import ContentSpecService
from app.modules.data_intelligence.adapters import (
    ManualCSVImportAdapter,
    ManualJSONImportAdapter,
)
from app.modules.data_intelligence.models import (
    AnalysisResult,
    ContentSpecDraft,
    DataPipelineResponse,
    ExtractedFeatureSet,
    KeywordEvidence,
    ManualCSVPipelineRequest,
    ManualJSONPipelineRequest,
    MappedTag,
    RawContentRecord,
    RawContentRecordInput,
    ScoreBreakdown,
    ScoreFactor,
)
from app.modules.ontology_node.repository import OntologyNodeRepository
from app.modules.platform_profile.models import PlatformProfile
from app.modules.platform_profile.repository import PlatformProfileRepository


class NoMappableTagsError(ValueError):
    """Raised when no controlled tags can be mapped from imported content."""


class MissingPlatformProfileError(ValueError):
    """Raised when the selected platform profile does not exist."""


class DataIntelligenceService:
    RULE_MAP: dict[str, tuple[str, str]] = {
        "romance": ("genre.romance", "romance keyword"),
        "love": ("genre.romance", "love keyword"),
        "revenge": ("emotion.revenge", "revenge keyword"),
        "betrayal": ("emotion.revenge", "betrayal signal"),
        "wedding": ("hook.fake_marriage", "wedding hook keyword"),
        "marriage": ("hook.fake_marriage", "marriage hook keyword"),
        "fake marriage": ("hook.fake_marriage", "explicit hook phrase"),
        "drama": ("genre.drama", "drama keyword"),
        "werewolf": ("theme.werewolf", "werewolf fantasy keyword"),
        "alpha": ("theme.werewolf", "alpha mate signal"),
        "ceo": ("character.ceo", "ceo archetype keyword"),
        "billionaire": ("character.ceo", "billionaire power fantasy keyword"),
        "supernatural": ("genre.supernatural", "supernatural genre keyword"),
        "vampire": ("genre.supernatural", "vampire signal"),
    }
    TOPIC_MAP: dict[str, str] = {
        "fake marriage": "fake marriage",
        "wedding": "wedding betrayal",
        "marriage": "marriage contract",
        "revenge": "revenge drama",
        "betrayal": "betrayal fallout",
        "werewolf": "werewolf romance",
        "alpha": "alpha mate conflict",
        "ceo": "ceo romance",
        "billionaire": "power fantasy romance",
        "supernatural": "supernatural romance",
        "vampire": "vampire romance",
        "romance": "romance tension",
        "love": "romantic attachment",
        "drama": "melodrama escalation",
    }

    def __init__(
        self,
        content_spec_repository: ContentSpecRepository,
        platform_profile_repository: PlatformProfileRepository,
        ontology_node_repository: OntologyNodeRepository,
    ) -> None:
        self._content_spec_service = ContentSpecService(
            repository=content_spec_repository,
            platform_profile_repository=platform_profile_repository,
            ontology_node_repository=ontology_node_repository,
        )
        self._platform_profile_repository = platform_profile_repository
        self._ontology_node_repository = ontology_node_repository
        self._json_adapter = ManualJSONImportAdapter()
        self._csv_adapter = ManualCSVImportAdapter()

    def run_manual_json_pipeline(
        self, payload: ManualJSONPipelineRequest
    ) -> DataPipelineResponse:
        parsed_records = self._json_adapter.parse(payload.records)
        return self.run_records_pipeline(
            parsed_records,
            platform_profile_id=payload.platform_profile_id,
            audience_hint=payload.audience_hint,
            commercial_objective=payload.commercial_objective,
        )

    def run_manual_csv_pipeline(
        self, payload: ManualCSVPipelineRequest
    ) -> DataPipelineResponse:
        parsed_records = self._csv_adapter.parse(payload.csv_content)
        return self.run_records_pipeline(
            parsed_records,
            platform_profile_id=payload.platform_profile_id,
            audience_hint=payload.audience_hint,
            commercial_objective=payload.commercial_objective,
        )

    def run_records_pipeline(
        self,
        parsed_records: list[RawContentRecordInput],
        platform_profile_id: str,
        audience_hint: str,
        commercial_objective: str,
    ) -> DataPipelineResponse:
        return self._run_pipeline(
            parsed_records,
            platform_profile_id=platform_profile_id,
            audience_hint=audience_hint,
            commercial_objective=commercial_objective,
        )

    def _run_pipeline(
        self,
        parsed_records: list[RawContentRecordInput],
        platform_profile_id: str,
        audience_hint: str,
        commercial_objective: str,
    ) -> DataPipelineResponse:
        platform_profile = self._platform_profile_repository.get(platform_profile_id)
        if platform_profile is None:
            raise MissingPlatformProfileError(
                f"PlatformProfile '{platform_profile_id}' was not found."
            )

        raw_records = [RawContentRecord.model_validate(record.model_dump()) for record in parsed_records]
        analysis_results = [
            self._analyze_record(record, platform_profile) for record in raw_records
        ]
        content_spec_draft = self._build_content_spec_draft(
            analysis_results=analysis_results,
            raw_records=raw_records,
            platform_profile=platform_profile,
            platform_profile_id=platform_profile_id,
            audience_hint=audience_hint,
            commercial_objective=commercial_objective,
        )
        content_spec = self._finalize_content_spec(content_spec_draft, raw_records=raw_records)
        return DataPipelineResponse(
            raw_content_records=raw_records,
            analysis_results=analysis_results,
            content_spec_draft=content_spec_draft,
            content_spec=content_spec,
        )

    def _analyze_record(
        self,
        record: RawContentRecord,
        platform_profile: PlatformProfile,
    ) -> AnalysisResult:
        analysis_text = self._compose_analysis_text(record)
        normalized_text = self._normalize_text(analysis_text)
        token_count = len(normalized_text.split())
        keyword_hits = self._extract_keyword_hits(normalized_text)
        keyword_evidence = self._collect_keyword_evidence(record, keyword_hits)
        mapped_tags = self._map_tags(keyword_hits)
        topic_labels = self._derive_topic_labels(keyword_hits)
        preference_score, preference_score_breakdown = self._compute_preference_score(record)
        commercial_score, commercial_score_breakdown = self._compute_commercial_score(record)
        platform_fit_score, platform_fit_score_breakdown = self._compute_platform_fit_score(
            record,
            keyword_hits,
            platform_profile.platform_name,
        )
        audience_signal_summary = self._summarize_audience_signal(
            record,
            keyword_hits,
            preference_score,
        )
        commercial_signal_summary = self._summarize_commercial_signal(
            record,
            commercial_score,
        )
        recommended_hook_type = self._recommend_hook_type(keyword_hits)
        recommended_cliffhanger_type = self._recommend_cliffhanger_type(keyword_hits)

        features = ExtractedFeatureSet(
            normalized_text=normalized_text,
            token_count=token_count,
            keyword_hits=keyword_hits,
            detected_signals=[tag.reason for tag in mapped_tags],
            evidence_snippets=[evidence.excerpt for evidence in keyword_evidence[:5]],
        )
        summary = (
            f"Imported {record.platform} content shows {', '.join(topic_labels[:3] or ['general'])} "
            f"signals with preference score {preference_score:.2f} and hook type {recommended_hook_type}."
        )
        return AnalysisResult(
            raw_content_record_id=record.id,
            extracted_features=features,
            mapped_tags=mapped_tags,
            topic_labels=topic_labels,
            keyword_evidence=keyword_evidence,
            preference_score=preference_score,
            preference_score_breakdown=preference_score_breakdown,
            commercial_score=commercial_score,
            commercial_score_breakdown=commercial_score_breakdown,
            platform_fit_score=platform_fit_score,
            platform_fit_score_breakdown=platform_fit_score_breakdown,
            audience_signal_summary=audience_signal_summary,
            commercial_signal_summary=commercial_signal_summary,
            recommended_hook_type=recommended_hook_type,
            recommended_cliffhanger_type=recommended_cliffhanger_type,
            explanation_notes=[
                "Keyword hits were derived from title, body text, hashtags and comments.",
                "Score breakdowns preserve the raw metrics and normalized contribution of each rule.",
            ],
            summary=summary,
        )

    def _build_content_spec_draft(
        self,
        analysis_results: list[AnalysisResult],
        raw_records: list[RawContentRecord],
        platform_profile: PlatformProfile,
        platform_profile_id: str,
        audience_hint: str,
        commercial_objective: str,
    ) -> ContentSpecDraft:
        if not analysis_results:
            raise NoMappableTagsError("No analysis results were produced from imported content.")

        tag_scores: dict[str, float] = defaultdict(float)
        mapped_tag_index: dict[str, MappedTag] = {}
        hooks: list[str] = []
        top_preference = 0.0
        for result in analysis_results:
            top_preference = max(top_preference, result.preference_score)
            hooks.append(result.extracted_features.normalized_text.split(".")[0][:240])
            for tag in result.mapped_tags:
                tag_scores[tag.ontology_node_id] += (
                    tag.confidence + result.preference_score + result.platform_fit_score
                )
                mapped_tag_index[tag.ontology_node_id] = tag

        if not tag_scores:
            raise NoMappableTagsError(
                "No controlled tags could be mapped from the imported content."
            )

        top_tag_ids = [tag_id for tag_id, _ in Counter(tag_scores).most_common(5)]
        tag_refs = [
            TagRef(
                ontology_node_id=mapped_tag_index[tag_id].ontology_node_id,
                label=mapped_tag_index[tag_id].label,
                category=mapped_tag_index[tag_id].category,
                confidence=min(tag_scores[tag_id] / 3.0, 1.0),
            )
            for tag_id in top_tag_ids
        ]

        title = f"{tag_refs[0].label} planning draft for {platform_profile.platform_name}"
        hook = hooks[0][:240]
        tone = "intense" if any(tag.category == "Emotion" for tag in tag_refs) else "melodramatic"
        target_emotion = (
            next((tag.label.lower() for tag in tag_refs if tag.category == "Emotion"), "curiosity")
        )
        primary_language = self._select_primary_value([record.language for record in raw_records])
        primary_region = self._select_primary_value([record.region for record in raw_records])
        creative_brief = CreativeBrief(
            hook=hook,
            tone=tone,
            pacing="fast",
            target_emotion=target_emotion,
            asset_constraints=[
                "Prefer reusable assets with strong hook compatibility.",
            ],
            generation_notes=[
                "Draft derived from manual import trend signals.",
            ],
        )

        return ContentSpecDraft(
            platform_profile_id=platform_profile_id,
            title=title,
            audience_goal_summary=f"Serve the audience segment described as: {audience_hint}.",
            commercial_goal_summary=f"Support the commercial objective: {commercial_objective}.",
            platform_goal_objective=(
                f"Maximize retention and replay value for {platform_profile.content_mode} output."
            ),
            target_duration_seconds=45 if top_preference >= 0.5 else 35,
            story_goal="Turn the strongest trend and preference signals into a short-form cliffhanger script.",
            tags=tag_refs,
            creative_brief=creative_brief,
            quality_level="high" if top_preference >= 0.6 else "medium",
            budget_level="medium",
            rationale=[
                f"Selected {len(tag_refs)} controlled tags from rule-based mapping.",
                f"Top preference score observed: {top_preference:.2f}.",
                f"Primary imported language: {primary_language}.",
                f"Primary imported region: {primary_region}.",
            ],
        )

    def _finalize_content_spec(
        self,
        draft: ContentSpecDraft,
        *,
        raw_records: list[RawContentRecord],
    ) -> ContentSpec:
        primary_language = self._select_primary_value([record.language for record in raw_records])
        primary_region = self._select_primary_value([record.region for record in raw_records])
        primary_platform = self._select_primary_value([record.platform for record in raw_records])
        payload = ContentSpecCreate(
            title=draft.title,
            audience_goal=TargetGoal(
                summary=draft.audience_goal_summary,
                success_metric="Engagement quality on manually imported trend samples.",
            ),
            commercial_goal=TargetGoal(
                summary=draft.commercial_goal_summary,
                success_metric="Commercial signal score across imported content.",
            ),
            platform_goal=PlatformGoal(
                platform_profile_id=draft.platform_profile_id,
                objective=draft.platform_goal_objective,
                target_duration_seconds=draft.target_duration_seconds,
                target_aspect_ratio=self._get_primary_aspect_ratio(draft.platform_profile_id),
            ),
            story_goal=draft.story_goal,
            quality_level=draft.quality_level,
            budget_level=draft.budget_level,
            tags=draft.tags,
            creative_brief=draft.creative_brief,
            metadata={
                "generated_by": "data_intelligence_pipeline",
                "draft_id": draft.id,
                "rationale": draft.rationale,
                "source_language": primary_language,
                "source_region": primary_region,
                "source_platform": primary_platform,
            },
        )
        return self._content_spec_service.create(payload)

    def _compose_analysis_text(self, record: RawContentRecord) -> str:
        metadata = record.metadata if isinstance(record.metadata, dict) else {}
        comments = metadata.get("comments", [])
        hashtags = metadata.get("hashtags", [])
        comment_text = " ".join(comment for comment in comments if isinstance(comment, str))
        hashtag_text = " ".join(tag.lstrip("#") for tag in hashtags if isinstance(tag, str))
        return " ".join(
            part
            for part in [
                record.title,
                record.body_text,
                hashtag_text,
                comment_text,
            ]
            if part
        )

    def _normalize_text(self, text: str) -> str:
        text = re.sub(r"\s+", " ", text).strip()
        return text.lower()

    def _extract_keyword_hits(self, normalized_text: str) -> list[str]:
        hits: list[str] = []
        for keyword in self.RULE_MAP:
            pattern = rf"(?<!\w){re.escape(keyword)}(?!\w)"
            if re.search(pattern, normalized_text):
                hits.append(keyword)
        return hits

    def _derive_topic_labels(self, keyword_hits: list[str]) -> list[str]:
        topics: list[str] = []
        for keyword in keyword_hits:
            topic = self.TOPIC_MAP.get(keyword)
            if topic and topic not in topics:
                topics.append(topic)
        return topics[:5]

    def _collect_keyword_evidence(
        self,
        record: RawContentRecord,
        keyword_hits: list[str],
    ) -> list[KeywordEvidence]:
        metadata = record.metadata if isinstance(record.metadata, dict) else {}
        sources: list[tuple[str, str]] = [
            ("title", record.title),
            ("body_text", record.body_text),
        ]
        for hashtag in metadata.get("hashtags", []):
            if isinstance(hashtag, str):
                sources.append(("hashtag", hashtag))
        for comment in metadata.get("comments", []):
            if isinstance(comment, str):
                sources.append(("comment", comment))

        evidence_items: list[KeywordEvidence] = []
        for keyword in keyword_hits:
            _, matched_rule = self.RULE_MAP[keyword]
            for source_type, source_text in sources:
                if keyword in self._normalize_text(source_text):
                    evidence_items.append(
                        KeywordEvidence(
                            keyword=keyword,
                            source_type=source_type,
                            excerpt=source_text[:240],
                            matched_rule=matched_rule,
                        )
                    )
                    break
        return evidence_items

    def _map_tags(self, keyword_hits: list[str]) -> list[MappedTag]:
        mapped_tags: list[MappedTag] = []
        seen = set()
        for keyword in keyword_hits:
            ontology_node_id, reason = self.RULE_MAP[keyword]
            if ontology_node_id in seen:
                continue
            ontology_node = self._ontology_node_repository.get(ontology_node_id)
            if ontology_node is None:
                continue
            mapped_tags.append(
                MappedTag(
                    ontology_node_id=ontology_node.id,
                    label=ontology_node.label,
                    category=ontology_node.category.value,
                    confidence=0.8 if "fake marriage" in keyword else 0.7,
                    reason=reason,
                )
            )
            seen.add(ontology_node_id)
        return mapped_tags

    def _compute_preference_score(
        self,
        record: RawContentRecord,
    ) -> tuple[float, ScoreBreakdown]:
        views = max(record.engagement.view_count, 1)
        like_rate = record.engagement.like_count / views
        comment_rate = record.engagement.comment_count / views
        share_rate = record.engagement.share_count / views
        completion_rate = record.engagement.completion_rate
        factor_specs = [
            ("view_scale", float(views), min(views / 100000, 1.0), 0.2, "Higher views suggest broader audience pull."),
            ("like_rate", like_rate, min(like_rate * 10, 1.0), 0.25, "Like rate indicates immediate audience resonance."),
            ("comment_rate", comment_rate, min(comment_rate * 25, 1.0), 0.2, "Comments indicate discussion and engagement depth."),
            ("share_rate", share_rate, min(share_rate * 40, 1.0), 0.15, "Shares indicate viral recommendation behavior."),
            ("completion_rate", completion_rate, completion_rate, 0.2, "Completion rate is a core retention quality signal."),
        ]
        factors = self._build_score_factors(factor_specs)
        score = round(min(sum(factor.contribution for factor in factors), 1.0), 3)
        return (
            score,
            ScoreBreakdown(
                score_name="preference_score",
                final_score=score,
                factors=factors,
            ),
        )

    def _compute_commercial_score(
        self,
        record: RawContentRecord,
    ) -> tuple[float, ScoreBreakdown]:
        views = max(record.engagement.view_count, 1)
        save_rate = record.engagement.save_count / views
        share_rate = record.engagement.share_count / views
        factor_specs = [
            ("save_rate", save_rate, min(save_rate * 50, 1.0), 0.4, "Saves imply follow-up interest and commercial recall."),
            ("share_rate", share_rate, min(share_rate * 40, 1.0), 0.3, "Shares imply referral value and sequel potential."),
            (
                "completion_rate",
                record.engagement.completion_rate,
                record.engagement.completion_rate,
                0.3,
                "Completion supports monetizable watch behavior.",
            ),
        ]
        factors = self._build_score_factors(factor_specs)
        score = round(min(sum(factor.contribution for factor in factors), 1.0), 3)
        return (
            score,
            ScoreBreakdown(
                score_name="commercial_score",
                final_score=score,
                factors=factors,
            ),
        )

    def _compute_platform_fit_score(
        self,
        record: RawContentRecord,
        keyword_hits: list[str],
        expected_platform_name: str,
    ) -> tuple[float, ScoreBreakdown]:
        hook_bonus = 1.0 if any(hit in {"marriage", "wedding", "fake marriage"} for hit in keyword_hits) else 0.35
        completion_bonus = min(record.engagement.completion_rate * 1.2, 1.0)
        platform_match_bonus = (
            1.0
            if record.platform.strip().lower() == expected_platform_name.strip().lower()
            else 0.35
        )
        factor_specs = [
            ("hook_compatibility", float(hook_bonus), hook_bonus, 0.2, "Hook patterns should fit short-form dramatic openings."),
            (
                "completion_alignment",
                record.engagement.completion_rate,
                completion_bonus,
                0.5,
                "Completion rate indicates pacing fit for the target platform.",
            ),
            (
                "platform_match",
                1.0 if platform_match_bonus == 1.0 else 0.0,
                platform_match_bonus,
                0.3,
                "Explicit platform match reduces transfer risk.",
            ),
        ]
        factors = self._build_score_factors(factor_specs)
        score = round(min(sum(factor.contribution for factor in factors), 1.0), 3)
        return (
            score,
            ScoreBreakdown(
                score_name="platform_fit_score",
                final_score=score,
                factors=factors,
            ),
        )

    def _build_score_factors(
        self,
        factor_specs: list[tuple[str, float, float, float, str]],
    ) -> list[ScoreFactor]:
        return [
            ScoreFactor(
                metric_name=metric_name,
                raw_value=round(raw_value, 6),
                normalized_value=round(normalized_value, 3),
                weight=weight,
                contribution=round(normalized_value * weight, 3),
                rationale=rationale,
            )
            for metric_name, raw_value, normalized_value, weight, rationale in factor_specs
        ]

    def _summarize_audience_signal(
        self,
        record: RawContentRecord,
        keyword_hits: list[str],
        preference_score: float,
    ) -> str:
        signal = "high repeat-interest romance viewers" if preference_score >= 0.6 else "broad curiosity-driven short-form viewers"
        if any(keyword in {"werewolf", "alpha"} for keyword in keyword_hits):
            signal = "fantasy romance viewers responding to mate-bond tension"
        elif any(keyword in {"ceo", "billionaire"} for keyword in keyword_hits):
            signal = "power-fantasy romance viewers responding to status imbalance"
        elif any(keyword in {"supernatural", "vampire"} for keyword in keyword_hits):
            signal = "supernatural romance viewers responding to forbidden-world reveals"
        return (
            f"{record.region} {record.language.upper()} audience signal suggests {signal} on {record.platform}."
        )

    def _summarize_commercial_signal(
        self,
        record: RawContentRecord,
        commercial_score: float,
    ) -> str:
        strength = "high sequel potential" if commercial_score >= 0.6 else "moderate retention potential"
        return (
            f"Commercial signal indicates {strength} with saves={record.engagement.save_count} "
            f"and shares={record.engagement.share_count}."
        )

    def _recommend_hook_type(self, keyword_hits: list[str]) -> str:
        if any(keyword in {"marriage", "wedding", "fake marriage"} for keyword in keyword_hits):
            return "identity reveal"
        if any(keyword in {"werewolf", "alpha"} for keyword in keyword_hits):
            return "dangerous mate-bond reveal"
        if any(keyword in {"ceo", "billionaire"} for keyword in keyword_hits):
            return "power imbalance reveal"
        if any(keyword in {"supernatural", "vampire"} for keyword in keyword_hits):
            return "forbidden world reveal"
        return "relationship disruption"

    def _recommend_cliffhanger_type(self, keyword_hits: list[str]) -> str:
        if any(keyword in {"revenge", "betrayal"} for keyword in keyword_hits):
            return "public betrayal escalation"
        if any(keyword in {"werewolf", "alpha"} for keyword in keyword_hits):
            return "mate-bond interruption"
        if any(keyword in {"supernatural", "vampire"} for keyword in keyword_hits):
            return "monster secret reveal"
        return "power reversal"

    def _get_primary_aspect_ratio(self, platform_profile_id: str) -> str:
        platform_profile = self._platform_profile_repository.get(platform_profile_id)
        if platform_profile is None:
            raise MissingPlatformProfileError(
                f"PlatformProfile '{platform_profile_id}' was not found."
            )
        return platform_profile.supported_aspect_ratios[0]

    def _select_primary_value(self, values: list[str]) -> str:
        counts = Counter(value.strip() for value in values if value.strip())
        if not counts:
            raise ValueError("At least one non-empty source value is required.")
        return counts.most_common(1)[0][0]
