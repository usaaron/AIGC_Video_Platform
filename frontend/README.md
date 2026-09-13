# 剧本大师 Frontend | 序幕 TV

剧本大师是序幕 TV 旗下的长剧本创作工作区，采用先审阅、再推进的连续剧本生成流程。

## Included

- Responsive Next.js application shell and project sidebar
- Local script project creation and selection
- Creative Input editor
- Backend Ontology-driven tag selection with an explicit local-authoring fallback
- Chinese creator interface with per-project Mainland China / Overseas market selection
- IndexedDB project persistence
- Startup restoration of every episode framework, edit, candidate, revision and final snapshot
- Generated projects open directly from Home/Sidebar into the episode workspace
- Searchable/deletable local project history
- One review-first Story Bible → recursive planning → single-episode roadmap → bounded script workflow
- Real multi-episode generation through bounded calls to the existing backend when runtime resources are initialized
- Episode rail, structured editing, Save/Confirm, optional AI modification and on-demand Deepening candidates
- Per-episode and whole-series Markdown/JSON export
- Scene Goal / Conflict / Outcome and causal-link review
- Existing Revision, Re-QC, Acceptance Shadow, and Finalization Gate integration
- Framework, AI Modification, Deepening Shadow, Revised, and controlled FinalMasterScript version views
- Dark Romance static knowledge when explicitly tagged; bounded Deepening Shadow is available to all supported genres
- Visible generation-context preview and confirmation for synthesized intent

## Boundary

The frontend uses the Creative Intent, Story Bible, recursive Story Plan Node, single-episode roadmap and Draft APIs. It carries forward continuity context while keeping each body request strictly single-episode. It uses active backend Ontology nodes when available, while user-created tags remain explicit creative notes rather than fake Ontology IDs. Authentication, unattended whole-tree jobs and automatic candidate application remain excluded.

## Run

From the repository root, the recommended complete local startup is:

```bash
# Fill in the real LLM settings in the project-root .env.local file, then:
./start-local.sh
```

The launcher starts the API, applies database migrations, bootstraps idempotent generation resources, and starts this frontend. When `DATABASE_URL` is absent it uses `.cache/local-runtime/my-comic.db`, because story planning requires durable project revisions. Without real LLM settings, generation remains in the explicitly labeled Mock demo mode.

For frontend-only development:

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

## Validate

```bash
npm run typecheck
npm run build
```

The default Next.js proxy targets `http://127.0.0.1:8000`. `start-local.sh` intentionally sets `NEXT_PUBLIC_API_BASE_URL` to the backend URL so long-running real-LLM generation does not time out in the development rewrite proxy. FastAPI limits cross-origin access to `FRONTEND_ORIGINS`. Set `BACKEND_API_URL` when the backend runs elsewhere.

The launcher performs the runtime bootstrap automatically. Run it manually only when starting the backend outside `start-local.sh`:

```bash
cd ..
.venv/bin/python scripts/bootstrap_frontend_mvp_runtime.py
```

Reload the frontend afterward. The bootstrap is idempotent and uses existing APIs only.
Browser-local drafts remain readable and exportable after a backend restart, but their temporary ContentSpec lineage cannot be used for new AI modification, Deepening, or Finalization calls. The workspace shows a recovery message; regenerate the affected episode to establish fresh backend lineage.
Persistence is scoped to the same browser profile and origin. Clearing site data, private browsing, or changing between hosts/ports uses a different local workspace.

## Local validation

The frontend uses the manually started local services at `127.0.0.1:3000` and
`127.0.0.1:8000`. It never starts them as part of tests.

```bash
npm run api:check
npm run typecheck
npm test
npm run test:e2e
```

`npm test` loads the existing TypeScript paths through the Node test runtime
hook; use a Node release providing `node:module.registerHooks` (validated with
Node 22.18.0).

`test:e2e` covers desktop and mobile smoke flows, browser/server errors, market
route selection, input assessment, uploaded episode counts, planning approval,
first-episode recovery, and page performance budgets. Generation-related checks
use isolated fixtures and intercepted APIs. Install its browser once with
`npm run test:e2e:install`. Performance results are attached to the Playwright
report rather than written into the application runtime.
