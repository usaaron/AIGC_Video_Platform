"""Provision the application role in the dedicated Script Master Postgres.

Run on the deployment host after starting only script-master-db. The backend
uses a non-superuser role; database administrator credentials stay in Postgres.
"""

import os
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlparse


def read_raw_env(path):
    return dict(line.split("=", 1) for line in path.read_text().splitlines()
                if line and not line.startswith("#") and "=" in line)


def identifier(value):
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", value):
        raise ValueError("Invalid database identifier")
    return '"' + value + '"'


def main():
    shared = Path(os.getenv("SCRIPT_MASTER_SECRETS_DIR", "/opt/script-master/shared"))
    backend = read_raw_env(shared / "backend.env")
    admin = read_raw_env(shared / "postgres.env")
    url = urlparse(backend["DATABASE_URL"])
    role = unquote(url.username or "")
    database = url.path.lstrip("/")
    if role == admin["POSTGRES_USER"]:
        raise ValueError("Application and database administrator must be different roles")
    quoted_role, quoted_db = identifier(role), identifier(database)
    password = unquote(url.password or "").replace("'", "''")
    if not password:
        raise ValueError("Application database password is missing")
    sql = (
        f"SELECT 1 FROM pg_roles WHERE rolname = '{role}';"
    )
    command = ["docker", "compose", "--env-file", "release.env", "-f", "compose.production.yml",
               "exec", "-T", "script-master-db", "psql", "-v", "ON_ERROR_STOP=1", "-At",
               "-U", admin["POSTGRES_USER"], "-d", database]
    result = subprocess.run(command, input=sql, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError("Database role lookup failed; inspect database health")
    statements = []
    if result.stdout.strip() != "1":
        statements.append(f"CREATE ROLE {quoted_role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '{password}';")
    statements += [f"ALTER DATABASE {quoted_db} OWNER TO {quoted_role};",
                   "REVOKE CREATE ON SCHEMA public FROM PUBLIC;",
                   f"GRANT USAGE, CREATE ON SCHEMA public TO {quoted_role};"]
    result = subprocess.run(command, input="\n".join(statements), text=True, capture_output=True)
    if result.returncode:
        # Do not echo SQL or stderr: a server error can include the password.
        raise RuntimeError("Application database role initialization failed")
    print("Application database role ready (non-superuser).")


if __name__ == "__main__":
    main()
