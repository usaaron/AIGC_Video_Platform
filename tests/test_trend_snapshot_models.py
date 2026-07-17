import pytest
from pydantic import ValidationError

from app.modules.trend_snapshot.models import TrendSnapshotGenerateRequest


def test_trend_snapshot_generate_request_accepts_valid_payload() -> None:
    model = TrendSnapshotGenerateRequest.model_validate(
        {"job_id": "job.manual_json_daily_v1", "lookback_runs": 3}
    )
    assert model.lookback_runs == 3


def test_trend_snapshot_generate_request_rejects_invalid_lookback_runs() -> None:
    with pytest.raises(ValidationError):
        TrendSnapshotGenerateRequest.model_validate(
            {"job_id": "job.manual_json_daily_v1", "lookback_runs": 0}
        )
