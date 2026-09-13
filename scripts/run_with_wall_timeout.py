"""Run an isolated command with a POSIX process-group wall-clock limit."""

from __future__ import annotations

import argparse
import math
import os
import signal
import subprocess
import time


def run_with_wall_timeout(command: list[str], seconds: float) -> int:
    if not command or not math.isfinite(seconds) or seconds <= 0:
        raise ValueError("A command and a finite positive timeout are required.")
    if os.name != "posix":
        raise RuntimeError("Process-group termination requires POSIX.")
    started = time.monotonic()
    process = subprocess.Popen(command, start_new_session=True)
    try:
        return process.wait(timeout=max(0, seconds - (time.monotonic() - started)))
    except subprocess.TimeoutExpired:
        # Kill the whole isolated group, including a blocked worker or bridge.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        print(f"Wall-clock limit reached ({seconds:g}s); isolated command stopped.", flush=True)
        return 124
    except BaseException:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=float, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    return run_with_wall_timeout(command, args.seconds)


if __name__ == "__main__":
    raise SystemExit(main())
