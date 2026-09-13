"""Review author intent before rewriting a screenplay against established facts."""

import hashlib
import json

from app.document_repository import DocumentRepository
from app.modules.script_engine.author_conflict_models import (
    AuthorConflictAssessment,
    AuthorConflictReview,
    StoredAuthorConflictReview,
)


class AuthorConflictResolutionError(ValueError):
    pass


class AuthorConflictReviewRepository(DocumentRepository[StoredAuthorConflictReview]):
    namespace = "script_author_conflict_reviews"
    model_type = StoredAuthorConflictReview


def source_packet(payload) -> dict:
    draft = payload.source_draft_master_script.model_dump(mode="json")
    for field in ("llm_metadata", "created_at", "updated_at"):
        draft.pop(field, None)
    context = payload.source_generation_run.episode_context
    return {
        "story_project_id": payload.source_generation_run.story_project_id,
        "source_draft_master_script": draft,
        "episode_context": context.model_dump(mode="json") if context else None,
        "instruction": payload.instruction,
        "source_story_bible_version": payload.source_story_bible_version,
        "selection_context": payload.selection_context.model_dump(mode="json") if payload.selection_context else None,
    }


def source_fingerprint(payload) -> str:
    return hashlib.sha256(json.dumps(
        source_packet(payload), ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()


def review_prompt(payload) -> str:
    return """你负责作者修改要求的冲突审阅，只返回结构化审阅结果，暂不改写正文。
以用户本次明确要求为调整目标。平台审美、常用剧情套路、反转偏好不能成为否决依据。
先区分普通润色、用户明确改变旧设定、模型原稿自身错误。只有本次要求与可定位的既有事实、
人物知情或动机存在实质冲突时才返回 conflicts；不能因要求新颖、节奏安静或缺少反转而报冲突。
普通表达修改及符合既定人物发展的行为返回 conflicts=[]、options=[]，直接进入原有候选流程。

每条冲突的 source_ref 是输入JSON里的点分隔路径（数组用零基数字），established_fact 必须是该
路径字符串中的原文摘录。路径只能来自 source_draft_master_script 或 episode_context，
不能把 instruction 或 selection_context 中的新要求引用为已有设定。
requested_change 解释用户希望改变什么，impact 解释会影响哪些因果与内容。
不得把模型推测当既有设定。所有冲突/方案说明使用简体中文，原文证据保留原语言。
对于实质冲突，提出1至3个契合当前故事、有具体因果做法的可编辑处理方案：
- bridge：仅补足本集人物转变或行动依据，保持已批准的事实、结局和规划义务；不能借补因果另造秘密、
  改写过去或让已死亡的人无缘无故复活。不能兼容既有事实时不要提供这种方案。
- revise_upstream：明确指出需局部修改的总纲设定与因果关系，并说明后续规划受影响的原因。
  该路径会建立独立的修订版本，保留原项目与原稿；新总纲作为待审草稿，完整规划须重新确认，旧正文
  与旧连续性记忆不自动成为新版事实。没有可引用的总纲时也可说明需要先建立/补全总纲。
方案只提出候选，不预选、不排名、不写“最佳/推荐”。不得默认把矛盾只当当前集例外。
用户可以自行改写方案或撤回本次要求；不能把保留旧设定当成已替用户作出的决定。
只返回符合schema的JSON，不输出正文、不操作任何保存或确认状态。

输入：
""" + json.dumps(source_packet(payload), ensure_ascii=False, separators=(",", ":"))


def make_review(payload, assessment: AuthorConflictAssessment) -> AuthorConflictReview:
    packet = source_packet(payload)
    for evidence in assessment.conflicts:
        if not evidence.source_ref.startswith(("source_draft_master_script.", "episode_context.")):
            raise ValueError("Conflict evidence must cite the existing screenplay or planning context.")
        value = packet
        try:
            for part in evidence.source_ref.split("."):
                value = value[int(part)] if isinstance(value, list) else value[part]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ValueError("Conflict evidence must reference an existing source field.") from exc
        if not isinstance(value, str) or evidence.established_fact not in value:
            raise ValueError("Conflict evidence must quote the referenced source exactly.")
    fingerprint = source_fingerprint(payload)
    assessment_hash = hashlib.sha256(assessment.model_dump_json().encode()).hexdigest()[:16]
    return AuthorConflictReview(
        **assessment.model_dump(),
        review_id=f"author_conflict.{fingerprint[:48]}.{assessment_hash}",
        source_fingerprint=fingerprint,
        instruction=payload.instruction,
        source_story_bible_version=payload.source_story_bible_version,
    )


def resolved_option(payload, repository: AuthorConflictReviewRepository):
    resolution = payload.resolution
    if resolution is None:
        return None
    stored = repository.get(resolution.review.review_id)
    if stored is None or stored.review != resolution.review:
        raise AuthorConflictResolutionError("冲突审阅记录已不可用，请重新检查本次修改。")
    if stored.review.source_fingerprint != source_fingerprint(payload):
        raise AuthorConflictResolutionError("正文、规划或修改要求已变化，请重新检查影响后再确认。")
    option = next((item for item in stored.review.options if item.option_id == resolution.option_id), None)
    if option is None:
        raise AuthorConflictResolutionError("请选择当前审阅中的处理方案；自定义方向须先重新检查影响。")
    return option
