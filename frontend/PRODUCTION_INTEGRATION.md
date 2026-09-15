# Script Master frontend production integration

Build-time configuration (Next public variables are compiled into browser assets):

```dotenv
NEXT_PUBLIC_BASE_PATH=/script-master
NEXT_PUBLIC_HOST_LAUNCH_URL=/api/v1/script-master/launch
NEXT_PUBLIC_HOST_DELIVERY_URL=/api/v1/script-master/deliveries
BACKEND_API_URL=http://script-master-api:8000
```

`next.config.ts` emits standalone output. Package `.next/standalone` and `.next/static` (placed under `.next/static` beside the standalone server); there is currently no `public` directory. The reverse proxy must preserve `/script-master` in forwarded URLs. Next applies this prefix to routes, assets and the `/api/:path*` backend rewrite. Browser API requests use `/script-master/api`; without the base path the development default remains `/api`, with the existing `NEXT_PUBLIC_API_BASE_URL` override available only in that mode. Backend URL changes require rebuilding the rewrite configuration.

The host cookie-authenticated GET launch endpoint must remain on the same origin. It returns `{ enabled: true, launchUrl }`, with a signed `host_token` in the launch URL fragment. Initial page load always obtains a fresh ticket using the current host cookies and `cache: no-store` before accessing project storage. The supplied fragment or session ticket alone never unlocks caches. An initial ticket with a different tenant/actor from the current login is rejected. Requests share one refresh, with automatic renewal at 60 seconds remaining, request-time renewal after a suspended tab resumes, and forced revalidation on focus. A 401/403, invalid ticket or identity change clears the ticket, aborts pending transports and requires relaunch; it never switches an existing document to a new account. Ticket values and response bodies are excluded from session errors.

Network failures, 5xx, 408 and 429 are recoverable. An already validated, unexpired ticket remains usable and refresh retries are limited to once per 10 seconds, with a single shared request. Automatic retries stop at expiry; no expired bearer is returned for new requests. Previously accepted streams and the pinned account identity survive transient host outages, and subsequent requests can recover under the same identity after the retry cooldown. Cached content already unlocked for that identity remains associated with it. Initial validation failure never unlocks caches and shows a retry action. This permits recovery without reloading a multi-hour job while retaining permanent fail-closed behavior for account changes and revoked login.

Browser-decoded tenant/actor claims select the IndexedDB database and localStorage keys only. The backend remains responsible for verifying signatures, expiry, permissions and data ownership. Project snapshots (including planning sessions), workspace chat, planning task history and the synchronization client identifier are isolated by both tenant and actor. Authenticated accounts never import the shared legacy anonymous storage. Locale is a device preference and remains shared.

`host_project_id` is retained through client navigation and tab reloads, supplied as the launch endpoint's `projectId` query and used as the delivery target. Scoped entry startup waits for the server catalog before bootstrapping an empty project; creation uses the host ID and reuses existing content. Without a project scope, the user's complete own catalog and normal project creation remain available.

Bulk delivery uses `GET /api/v1/script-master/targets` and `POST /api/v1/script-master/imports` with the v2 contract. Unscoped projects choose an owned host project; scoped entry retains its bound destination. Scripts, current adopted storyboards and listed assets share one host transaction. Legacy v1 remains for older clients. Bearer authentication without host cookies prevents a concurrent cookie-account switch from changing the delivery identity. See `deploy/HOST_BULK_IMPORT.md` for limits.

Tests cover login-before-cache ordering, missing authentication, shared concurrent refresh, timed/expired refresh, immutable tenant/actor identity, storage namespace isolation, scoped creation, unscoped catalog retention, API/SSE/delivery authorization and navigation scope retention. They mock host/model responses and do not make paid generation calls. Deployment validation must separately confirm proxy behavior, host login and backend ownership enforcement.

Validation on 2026-09-15: `npm test` passed all 599 tests; `npm run typecheck` passed. This includes actual React server rendering without a browser, transient auth recovery, and local/production Next rewrite configuration. On this Windows machine, npm used a temporary Git Bash shell with the installed Node directory first in PATH to avoid an unrelated broken ancestor `node_modules/.bin/node` shim; no dependency or package-script change was needed.

## Local host integration

Use this frontend configuration, then restart `next dev`:

```dotenv
NEXT_PUBLIC_BASE_PATH=
NEXT_PUBLIC_HOST_LAUNCH_URL=/api/v1/script-master/launch
NEXT_PUBLIC_HOST_DELIVERY_URL=/api/v1/script-master/deliveries
HOST_API_URL=http://localhost:8787
BACKEND_API_URL=http://127.0.0.1:8000
```

Configure the main host's `SCRIPT_MASTER_URL=http://localhost:3000` (or the actual Next port) and matching backend/host shared secrets. Log in to the main app and open the Next frontend using the same browser hostname, `localhost`, throughout; cookies are shared across ports, but `localhost` and `127.0.0.1` are different cookie hosts. Server-to-server FastAPI URLs may still use `127.0.0.1`.

Next forwards `/api/v1/script-master/launch`, `/deliveries`, `/targets` and `/imports` under the same host prefix to `HOST_API_URL`, before its general `/api/:path*` FastAPI rewrite. These four host paths never acquire the Next base path. Development defaults `HOST_API_URL` to `http://localhost:8787`; production has no host forwarding unless explicitly configured, so Caddy keeps ownership of the root host API. `HOST_API_URL` is server-only. The browser still sends cookie-authenticated refreshes to its own origin; no cross-origin credential exception or broader CORS policy is needed.

The 2026-09-16 host UI opens this service as a full page. Creation settings use an inline workspace, and return links open the corresponding host project in another tab to preserve ongoing work. Optional public build variable `NEXT_PUBLIC_HOST_HOME_URL` overrides the host root (production `/`, local `http://localhost:5173/`). See `deploy/HOST_WORKSPACE.md`.
