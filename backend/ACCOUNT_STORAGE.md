# Host account storage

Production uses `SCRIPT_MASTER_ACCOUNT_ISOLATION=true`, `DATABASE_URL` pointing to
a dedicated PostgreSQL database, and `HOST_INTEGRATION_SECRET` (or
`SCRIPT_MASTER_SHARED_SECRET`). Required host mode always enforces isolation;
setting the isolation flag false cannot disable an active host boundary.

Signed host claims identify `(tenantId, actorId)`. `account_context.py` hashes the
framed pair into a safe private schema name. `DatabaseRuntime` retains one engine
and pool; it resolves the schema at each session, sets transaction-local
`search_path` after every begin, and never includes public in an account search
path. A commit or rollback cannot return the next operation to public. Account
foreign keys point to tables in the same schema.

Authorization runs before route dependencies. Reads require `project.read`, all
mutations/generation require `project.write`. Scoped project tickets also check
path, query, and nested body project references. HTTP identity never comes from
unsigned tenant/actor headers. Invalid/expired tokens fail before accessing data.

The pure ASGI middleware creates and revokes a request storage scope. SSE,
`asyncio.to_thread`, generation threads and lease heartbeat threads inherit that
scope. Copied contexts are revoked after the response; sessions also check before
executing, flushing and committing, including already-open transactions. Durable
jobs that outlive HTTP must explicitly reauthorize their identity in a future job
runner; a copied expired request is not a durable job credential.

## Deployment

Run `python scripts/prepare_production.py` before serving traffic. It upgrades the
public template, atomically seeds both mainland and overseas static catalogs, then
upgrades every existing account schema. Startup repeats schema upgrades. New
accounts run the same Alembic migration chain. Programmatic migrations use an
explicit connection/configuration, a process lock, and an advisory transaction
lock; they never mutate DATABASE_URL or global logging.

Include the root Alembic configuration, `migrations/`, `scripts/prepare_production.py`,
`scripts/bootstrap_frontend_mvp_runtime.py`, and
`scripts/run_real_generation_validation.py` in the backend image. The latter two
are imported only for static payload builders. Bootstrap does not call providers.

Only `platform_profiles`, `ontology_nodes`, `prompt_library`,
`generation_strategies`, and explicitly bootstrap-marked static scene assets are
copied from public. Projects, content specifications, scripts, generated assets,
checkpoints and legacy public user content are never copied. Existing account
customizations are retained; newly added catalog IDs are copied during upgrades.
Do not import a local development database into the public template.

Public contains the static baseline. The trusted feed collector uses `sm_feed`,
which is upgraded separately and contains only external catalog/feed data.
Unauthenticated liveness/readiness stay available; API documentation is disabled
in required host mode. SQLite standalone development behavior is unchanged.

Experimental ingestion/trend/benchmark repositories remain process-local but
are partitioned by account. They do not provide restart durability or cross-worker
synchronization; deploy one API worker until these features gain durable storage.
Optional benchmark exports use `SCRIPT_MASTER_REPORT_ROOT/<account-schema>`
(default `var/account-reports`), never a client-supplied directory.

## Verification

Set `TEST_DATABASE_URL` to a disposable PostgreSQL database and run:

```sh
python -m pytest tests/test_account_storage_postgres.py tests/test_account_context.py tests/test_prepare_production.py tests/test_host_integration.py -q
```

Tests create/delete only their private schemas in that explicit test database and
seed its public static template. They cover two actors in one organization,
different organizations, identical resource IDs, persisted assets, foreign keys,
pool reuse, explicit commits/rollbacks, concurrent processes, failed migration
rollback, signed authorization, SSE and revoked task contexts. No paid API is used.
