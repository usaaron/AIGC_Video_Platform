from types import SimpleNamespace

from app.modules.asset.models import Asset
from app.modules.ontology_node.models import OntologyNode
from app.modules.platform_profile.models import PlatformProfile
from app.modules.script_engine.models import GenerationStrategy, PromptLibraryItem
from scripts.prepare_production import static_catalog


def test_both_markets_catalog_has_valid_references_and_no_generation(monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError("Static bootstrap must never send a request")
    monkeypatch.setattr("httpx.Client.send", no_network)
    monkeypatch.setattr("httpx.AsyncClient.send", no_network)
    types = {"/assets": Asset, "/ontology-nodes": OntologyNode,
             "/platform-profiles": PlatformProfile, "/generation-strategies": GenerationStrategy,
             "/prompt-library": PromptLibraryItem}
    values = {}
    for path, payload in static_catalog(SimpleNamespace(provider="openai_compatible", model_name="mock-model")):
        item = types[path].model_validate(payload)
        assert (path, item.id) not in values
        values[(path, item.id)] = item
    profiles = {key[1] for key in values if key[0] == "/platform-profiles"}
    assert profiles == {"cn_mainland_comic_drama_v1", "tiktok_frontend_mvp_v1"}
    assert {item.metadata["market_profile"] for (path, _), item in values.items() if path == "/assets"} == {"cn_mainland", "overseas_tiktok"}
    for (path, _), item in values.items():
        if path == "/assets":
            assert set(item.applicable_platform_profile_ids) <= profiles
            assert item.metadata["source"] == "frontend_mvp_runtime_bootstrap"
            for tag in item.tags:
                node = values[("/ontology-nodes", tag.ontology_node_id)]
                assert (tag.label, tag.category) == (node.label, node.category.value)
        if path == "/generation-strategies":
            assert all(("/prompt-library", key) in values for key in item.prompt_ids + item.deepening_prompt_ids)
