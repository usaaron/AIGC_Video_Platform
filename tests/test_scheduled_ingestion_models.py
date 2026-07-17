import pytest
from pydantic import ValidationError

from app.modules.scheduled_ingestion.models import DataIngestionJobCreate


def build_payload() -> dict:
    return {
        "id": "job.manual_json_daily_v1",
        "title": "Daily manual json import",
        "adapter_type": "manual_json",
        "schedule_type": "daily",
        "platform_profile_id": "tiktok_v1",
        "audience_hint": "TikTok romance viewers",
        "commercial_objective": "Find reusable high-retention concepts",
        "manual_json_records": [
            {
                "source_name": "manual_json",
                "source_item_id": "item_001",
                "platform": "tiktok",
                "source_url": "https://example.com/item_001",
                "title": "Fake marriage revenge wedding",
                "body_text": "A fake marriage becomes revenge after a public betrayal.",
                "language": "en",
                "region": "US",
            }
        ],
    }


def test_data_ingestion_job_create_accepts_valid_payload() -> None:
    model = DataIngestionJobCreate.model_validate(build_payload())
    assert model.adapter_type == "manual_json"
    assert len(model.manual_json_records) == 1


def test_data_ingestion_job_create_requires_cron_expression_for_custom_cron() -> None:
    payload = build_payload()
    payload["schedule_type"] = "custom_cron"

    with pytest.raises(ValidationError, match="cron_expression"):
        DataIngestionJobCreate.model_validate(payload)


def test_data_ingestion_job_create_requires_manual_csv_content_for_manual_csv() -> None:
    payload = build_payload()
    payload["adapter_type"] = "manual_csv"
    payload["manual_json_records"] = []

    with pytest.raises(ValidationError, match="manual_csv_content"):
        DataIngestionJobCreate.model_validate(payload)
