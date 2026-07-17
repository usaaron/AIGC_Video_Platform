from __future__ import annotations

import os

import pytest

from scripts.run_real_generation_validation import main


pytestmark = pytest.mark.skipif(
    os.getenv("RUN_REAL_LLM_INTEGRATION") != "1",
    reason="Real LLM integration runs are manual-only unless RUN_REAL_LLM_INTEGRATION=1.",
)


@pytest.mark.anyio
async def test_real_generation_validation_runs_end_to_end() -> None:
    await main()
