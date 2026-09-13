import os
import sys
import time

import pytest

from scripts.run_with_wall_timeout import run_with_wall_timeout


@pytest.mark.skipif(os.name != "posix", reason="POSIX process groups")
def test_wall_timeout_preserves_exit_status():
    assert run_with_wall_timeout([sys.executable, "-c", "raise SystemExit(7)"], 5) == 7


@pytest.mark.skipif(os.name != "posix", reason="POSIX process groups")
def test_wall_timeout_stops_child_and_descendant(tmp_path):
    marker = tmp_path / "still-running"
    grandchild = (
        "import time; from pathlib import Path; time.sleep(1); "
        f"Path({str(marker)!r}).write_text('survived')"
    )
    child = (
        "import subprocess,sys,time; "
        f"subprocess.Popen([sys.executable,'-c',{grandchild!r}]); time.sleep(10)"
    )
    started = time.monotonic()
    assert run_with_wall_timeout([sys.executable, "-c", child], 0.3) == 124
    assert time.monotonic() - started < 3
    time.sleep(1)
    assert not marker.exists()
