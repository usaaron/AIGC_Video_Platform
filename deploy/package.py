"""Create a source-only release archive from Git's tracked files."""

import argparse
import hashlib
import io
from pathlib import Path
import subprocess
import tarfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--candidate", action="store_true", help="Include untracked source for pre-release builds.")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    dirty = bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=root).strip())
    if dirty and not args.candidate:
        raise SystemExit("Commit the validated changes before creating a release (or use --candidate).")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root).decode().strip()
    branch = subprocess.check_output(["git", "branch", "--show-current"], cwd=root).decode().strip()
    command = ["git", "ls-files", "-z", "--cached"]
    if args.candidate:
        command += ["--others", "--exclude-standard"]
    names = sorted(set(subprocess.check_output(command, cwd=root).decode().split("\0")) - {""})
    allowed = {"backend", "frontend", "evaluation", "datasets", "migrations", "scripts", "tests", "deploy"}
    top_files = {".dockerignore", "compose.production.yml", "alembic.ini", "pyproject.toml", "README.md"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with tarfile.open(args.output, "w:gz") as archive:
        for name in names:
            path = Path(name)
            if path.parts[0] not in allowed and name not in top_files:
                continue
            if any(part.startswith(".env") or part in {"node_modules", "__pycache__"} or part.startswith(".next") for part in path.parts):
                continue
            if path.suffix in {".env", ".db", ".sqlite", ".sqlite3", ".log", ".pyc"}:
                continue
            if (root / path).is_file():
                archive.add(root / path, arcname=path.as_posix(), recursive=False)
                count += 1
        manifest = f"SourceCommit={commit}\nSourceBranch={branch}\nSourceDirty={str(dirty).lower()}\nIncludedFiles={count}\n".encode()
        info = tarfile.TarInfo("DEPLOY_BUILD.txt")
        info.size = len(manifest)
        info.mode = 0o644
        archive.addfile(info, io.BytesIO(manifest))
    print(f"Source files: {count}")
    print(f"SHA256: {hashlib.sha256(args.output.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
