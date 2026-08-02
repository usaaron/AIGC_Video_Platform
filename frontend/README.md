# AI Comic Content OS Frontend

The frontend is a local creator workspace for review-first serialized script generation.

## Included

- Responsive Next.js application shell and project sidebar
- Local script project creation and selection
- Creative Input editor
- Backend Ontology-driven tag selection with an explicit local-authoring fallback
- Dedicated character create/edit pages and character-card deletion
- English and Chinese interface toggle with browser-local preference
- IndexedDB project persistence
- Startup restoration of every episode framework, edit, candidate, revision and final snapshot
- Generated projects open directly from Home/Sidebar into the episode workspace
- Searchable/deletable local project history
- Dedicated character create/edit routes
- Sequential and full generation settings; both produce editable episode frameworks first
- Real multi-episode generation through bounded calls to the existing backend when runtime resources are initialized
- Episode rail, structured editing, Save/Confirm, optional AI modification and on-demand Deepening candidates
- Per-episode and whole-series Markdown/JSON export
- Scene Goal / Conflict / Outcome and causal-link review
- Existing Revision, Re-QC, Acceptance Shadow, and Finalization Gate integration
- Framework, AI Modification, Deepening Shadow, Revised, and controlled FinalMasterScript version views
- Dark Romance static knowledge when explicitly tagged; bounded Deepening Shadow is available to all supported genres
- Visible generation-context preview and confirmation for synthesized intent

## Boundary

The frontend reuses the existing Creative Intent and single-episode Draft APIs. Full mode performs a bounded sequence of episode calls and carries forward continuity context; it is not a Story Planning runtime. It uses active backend Ontology nodes when available, while user-created tags remain explicit creative notes rather than fake Ontology IDs. Authentication, backend project persistence, Story Blueprint runtime, and automatic candidate application remain excluded.

## Run

From the repository root, the recommended complete local startup is:

```bash
cp .env.example .env.local
# Fill in the real LLM settings, then:
./start-local.sh
```

The launcher starts the API, initializes its in-memory generation resources, and starts this frontend. Without `.env.local`, it starts in an explicitly labeled Mock demo mode.

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

Because the current backend repositories are in memory, initialize the running API after each restart:

```bash
cd ..
.venv/bin/python scripts/bootstrap_frontend_mvp_runtime.py
```

Reload the frontend afterward. The bootstrap is idempotent and uses existing APIs only.
Browser-local drafts remain readable and exportable after a backend restart, but their temporary ContentSpec lineage cannot be used for new AI modification, Deepening, or Finalization calls. The workspace shows a recovery message; regenerate the affected episode to establish fresh backend lineage.
Persistence is scoped to the same browser profile and origin. Clearing site data, private browsing, or changing between hosts/ports uses a different local workspace.
