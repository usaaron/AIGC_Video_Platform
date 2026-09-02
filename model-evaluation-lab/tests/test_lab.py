from __future__ import annotations

import asyncio
import base64
from dataclasses import replace
from io import BytesIO
import os
from pathlib import Path
import threading
import unittest
from unittest.mock import AsyncMock, patch
from zipfile import ZipFile

from model_eval_lab.attachments import AttachmentPayload, extract_attachments
from model_eval_lab.config import EvaluationModelConfig, load_stage_models
from model_eval_lab.prompts import STAGES, build_evaluation_prompt
from model_eval_lab import runner


class ModelEvaluationLabTests(unittest.TestCase):
    @staticmethod
    def _configured_model(index: int) -> EvaluationModelConfig:
        return EvaluationModelConfig(
            id=f"outline.model.{index:02d}",
            stage="outline",
            label=f"并行模型 {index}",
            provider="openai_compatible",
            model=f"model-{index}",
            api_key="test-key",
            base_url="https://api.example.com/v1",
            wire_api="chat_completions",
            reasoning_effort=None,
            thinking_mode=None,
            timeout_seconds=30,
            max_retries=0,
            max_tokens=1000,
            temperature=0.7,
        )

    def test_four_stages_are_independent_and_complete(self) -> None:
        self.assertEqual(
            list(STAGES),
            ["outline", "story_tree", "episode_roadmap", "screenplay"],
        )
        prompts = {
            stage: build_evaluation_prompt(stage, "相同测试输入", [])
            for stage in STAGES
        }
        self.assertEqual(len(set(prompts.values())), 4)
        self.assertTrue(all("相同测试输入" in prompt for prompt in prompts.values()))
        self.assertTrue(
            all(
                "不得读取、推断或引用其他测试阶段的输出" in prompt
                for prompt in prompts.values()
            )
        )

    def test_service_imports_with_static_frontend(self) -> None:
        from model_eval_lab.server import STATIC_DIR, app

        self.assertEqual(app.title, "My Comic Model Evaluation Lab")
        self.assertTrue((STATIC_DIR / "index.html").is_file())

    def test_runner_has_no_formal_project_imports(self) -> None:
        runner_source = (
            Path(__file__).parents[1] / "model_eval_lab" / "runner.py"
        ).read_text()
        start_source = (Path(__file__).parents[1] / "start.sh").read_text()
        self.assertNotIn("from app", runner_source)
        self.assertNotIn("import app", runner_source)
        self.assertNotIn("PROJECT_DIR", start_source)
        self.assertNotIn("/backend", start_source)
        self.assertIn('export PYTHONPATH="$LAB_DIR"', start_source)

    def test_model_config_keeps_key_server_side(self) -> None:
        prefix = "EVAL_OUTLINE_MODEL_02"
        overrides = {
            f"{prefix}_LABEL": "测试模型",
            f"{prefix}_MODEL": "test-model",
            f"{prefix}_API_KEY": "secret-value",
            f"{prefix}_BASE_URL": "https://api.example.com/v1",
        }
        with patch.dict(os.environ, overrides):
            models = load_stage_models("outline")
        model = next(item for item in models if item.id == "outline.model.02")
        self.assertTrue(model.configured)
        self.assertNotIn("secret-value", str(model.public_dict()))
        self.assertEqual(model.public_dict()["route"], "api.example.com")

    def test_model_loader_exposes_only_a_to_e_slots(self) -> None:
        overrides = {
            "EVAL_OUTLINE_MODEL_06_LABEL": "不应显示的模型 F",
            "EVAL_OUTLINE_MODEL_06_MODEL": "ignored-model",
            "EVAL_OUTLINE_MODEL_06_API_KEY": "ignored-key",
            "EVAL_OUTLINE_MODEL_06_BASE_URL": "https://api.example.com/v1",
        }
        with patch.dict(os.environ, overrides):
            models = load_stage_models("outline")
        self.assertTrue(all(model.id.endswith(tuple(f".{i:02d}" for i in range(1, 6))) for model in models))
        self.assertNotIn("outline.model.06", {model.id for model in models})

    def test_models_receive_identical_prompt_concurrently(self) -> None:
        models = [self._configured_model(1), self._configured_model(2)]
        rendezvous = threading.Barrier(len(models))
        received: list[tuple[str, str]] = []

        def fake_generate(
            stage: str,
            prompt: str,
            model: EvaluationModelConfig,
        ) -> str:
            received.append((model.id, prompt))
            rendezvous.wait(timeout=2)
            return f"{stage}:{model.id}"

        with patch.object(runner, "_generate_text", fake_generate):
            results = asyncio.run(
                runner.run_evaluation_models(
                    stage="outline",
                    prompt="所有模型必须收到这一份输入",
                    models=models,
                )
            )

        self.assertEqual(
            {prompt for _, prompt in received},
            {"所有模型必须收到这一份输入"},
        )
        self.assertEqual({result["status"] for result in results}, {"completed"})
        self.assertEqual({result["model_id"] for result in results}, {model.id for model in models})

    def test_partial_provider_output_is_kept_for_download(self) -> None:
        model = self._configured_model(1)

        def partial_generate(stage: str, prompt: str, model: EvaluationModelConfig) -> str:
            raise runner.PartialGenerationError("已经生成的正文", "上游流式连接超时")

        with patch.object(runner, "_generate_text", partial_generate):
            result = asyncio.run(
                runner._run_one(stage="outline", prompt="输入", model=model)
            )

        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["output"], "已经生成的正文")
        self.assertIn("超时", result["error"])

    def test_non_json_gateway_response_is_described(self) -> None:
        self.assertEqual(
            runner._response_body_preview(b"<html><title>502 Bad Gateway</title></html>"),
            "<html><title>502 Bad Gateway</title></html>",
        )
        self.assertEqual(runner._response_body_preview(b""), "响应为空")
        self.assertTrue(runner._looks_like_html("<!doctype html><html>"))
        self.assertFalse(runner._looks_like_html('{"error":"bad request"}'))

    def test_evaluation_automatically_runs_every_configured_model(self) -> None:
        from model_eval_lab import server

        configured = [self._configured_model(1), self._configured_model(2)]
        unconfigured = replace(self._configured_model(3), api_key="")
        run_models = AsyncMock(return_value=[])
        request = server.EvaluationRequest(
            stage="outline",
            input_text="同一份公共输入",
        )

        with (
            patch.object(
                server,
                "load_stage_models",
                return_value=[*configured, unconfigured],
            ),
            patch.object(server, "run_evaluation_models", run_models),
        ):
            response = asyncio.run(server.create_evaluation(request))

        self.assertEqual(response["parallel_model_count"], 2)
        called_models = run_models.await_args.kwargs["models"]
        self.assertEqual(called_models, configured)
        self.assertIn("同一份公共输入", run_models.await_args.kwargs["prompt"])

    def test_plain_text_attachment_is_extracted(self) -> None:
        content = "人物：林夏\n冲突：必须在今晚作出选择。".encode()
        attachments = extract_attachments(
            [
                AttachmentPayload(
                    name="story.md",
                    mime_type="text/markdown",
                    size_bytes=len(content),
                    content_base64=base64.b64encode(content).decode(),
                )
            ],
            input_characters=10,
        )
        self.assertEqual(attachments, [("story.md", content.decode())])

    def test_docx_attachment_preserves_paragraph_text(self) -> None:
        xml = '''<?xml version="1.0" encoding="UTF-8"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body>
        </w:document>'''.encode()
        document = BytesIO()
        with ZipFile(document, "w") as archive:
            archive.writestr("word/document.xml", xml)
        content = document.getvalue()
        attachments = extract_attachments(
            [
                AttachmentPayload(
                    name="reference.docx",
                    mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    size_bytes=len(content),
                    content_base64=base64.b64encode(content).decode(),
                )
            ],
            input_characters=0,
        )
        self.assertIn("第一段", attachments[0][1])
        self.assertIn("第二段", attachments[0][1])


if __name__ == "__main__":
    unittest.main()
