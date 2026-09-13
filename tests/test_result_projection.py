from app.modules.script_engine.models import ScriptDraftModificationRequest, ScriptGenerationDraftRequest
from app.modules.script_engine.result_projection import PROMPT_OMITTED, compact_generation_result
from tests.test_script_generation_service import seed_dependencies


def test_compact_result_preserves_business_data_and_modification_reloads_server_prompts():
    service, content_spec_id = seed_dependencies()
    original = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id, generation_strategy_id="strategy.tiktok.service_generation.v1",
        desired_scene_count=3, output_language="en",
    ))
    compact = compact_generation_result(original)
    assert compact.draft_master_script == original.draft_master_script
    assert compact.prompt_build_result.trace == original.prompt_build_result.trace
    assert compact.llm_raw_output == {}
    assert original.llm_raw_output
    assert original.prompt_build_result.prompt_text != PROMPT_OMITTED
    prompt = compact.prompt_retrieval_result.prompts[0]
    assert prompt.prompt_template == PROMPT_OMITTED
    prompt.prompt_template = "UNTRUSTED_CLIENT_TEMPLATE"
    result = service.modify_draft(ScriptDraftModificationRequest(
        source_generation_run=compact, source_draft_master_script=compact.draft_master_script,
        instruction="Make the protagonist's decision more costly.",
    ))
    assert "UNTRUSTED_CLIENT_TEMPLATE" not in result.candidate_generation_run.prompt_build_result.prompt_text
    assert result.candidate_generation_run.prompt_retrieval_result.prompts == original.prompt_retrieval_result.prompts
