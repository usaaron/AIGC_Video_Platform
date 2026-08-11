# Usage Metrics Contract

This document freezes the backend usage metric vocabulary for realtime operations,
admin reporting, billing diagnostics, and future rate-limit policies.

Public API and frontend copy should keep the product concept as `organization`.
Database columns may still use `tenant_id` as an internal physical name.

## Metric Definitions

| Metric                | Window         | Unit           | Type  | Definition                                                                      |
| --------------------- | -------------- | -------------- | ----- | ------------------------------------------------------------------------------- |
| `apiConcurrency`      | realtime       | requests       | gauge | Current in-flight API requests for the subject.                                 |
| `jobConcurrency`      | realtime       | count          | gauge | Current running generation tasks for the subject.                               |
| `providerConcurrency` | realtime       | count          | gauge | Current external AI provider calls for the subject.                             |
| `rpm`                 | rolling 60s    | requests       | count | API requests completed or observed during the last 60 seconds.                  |
| `tpm`                 | rolling 60s    | tokens         | sum   | Model tokens reported during the last 60 seconds; mainly applies to LLM calls.  |
| `requestCount`        | selected range | requests       | count | Total API requests in the selected range.                                       |
| `inputTokens`         | selected range | tokens         | sum   | Input or prompt tokens reported in the selected range.                          |
| `outputTokens`        | selected range | tokens         | sum   | Output or completion tokens reported in the selected range.                     |
| `totalTokens`         | selected range | tokens         | sum   | Total model tokens reported in the selected range.                              |
| `creditsUsed`         | selected range | credits        | sum   | Actual credits deducted in the selected range.                                  |
| `errorCount`          | selected range | count          | count | Failed requests in the selected range.                                          |
| `errorRate`           | selected range | ratio          | ratio | `errorCount / requestCount`; return `0` when `requestCount` is `0`.             |
| `providerUnits`       | selected range | provider units | sum   | Provider-native image/video usage units when available and tokens do not apply. |

The executable contract is `packages/contracts/src/usage.ts`. Contract tests freeze the
metric names, units, windows, and response shape.

## Range Rules

The first supported report ranges are:

| Range   | Meaning                       |
| ------- | ----------------------------- |
| `today` | Current local business day.   |
| `week`  | Current local business week.  |
| `month` | Current local business month. |

Realtime gauges and rolling 60-second metrics should come from Redis or an equivalent
central realtime store. Historical `today`, `week`, and `month` metrics should come from
Postgres rollups, not from scanning request logs.

## Scope Rules

Usage visibility follows `usageVisibilityFor()` in `apps/api/src/core/auth/roles.ts`:

| Role                  | Scope                |
| --------------------- | -------------------- |
| `owner`               | `all`                |
| `super_admin`         | `all`                |
| `admin`               | `platform_scope`     |
| `organization_admin`  | `organization_scope` |
| `member`              | `self`               |
| `organization_member` | `self`               |

Admin usage APIs must authorize with `usage.read.self`, `usage.read.scoped`, or
`usage.read.all`, then apply the scope above at repository/query level. Frontend hiding is
not sufficient.

## Counting Rules

- `apiConcurrency` starts when the authenticated API handler begins processing and ends when
  the response is completed or aborted.
- `jobConcurrency` starts when a generation task is claimed for execution and ends when it
  reaches a terminal state or the lease is released.
- `providerConcurrency` starts immediately before an external AI provider request and ends
  after success, retry exhaustion, cancellation, or failure.
- `rpm` counts API requests in the last 60 seconds. It is not averaged across a longer range.
- `tpm` counts provider-reported tokens in the last 60 seconds. If an image or video provider
  does not report tokens, record `creditsUsed` and optional `providerUnits` instead.
- `creditsUsed` is the actual deducted credit amount from billing ledger generation charges.
  Refunds are not subtracted here; report refunds separately when needed.
- `errorCount` should include HTTP 5xx, failed provider calls, and failed generation jobs when
  the endpoint or report explicitly includes those sources. Each API must document its source set.

## Collection Points

The first backend collection points are:

| Point               | Current hook                                                     | Captured data                                                                                             |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| API middleware      | `installObservabilityHooks()`                                    | active request lifecycle, status, latency, route, `userId`, `organizationId`, and rolling RPM             |
| AI provider wrapper | `observeProviderCall()` plus text provider response parsing      | provider concurrency, provider latency, provider errors, provider-reported input/output/total tokens, TPM |
| Worker / BullMQ     | `GenerationTaskRunner`, `AiJobRunner`, and BullMQ runner context | job concurrency, completion/failure events, credits used on completed jobs, and propagated `traceId`      |

Provider calls that do not return token usage still emit a provider usage event with `estimated=true`
and zero tokens. Image/video providers should report `creditsUsed` and `providerUnits` when those
values are available instead of pretending they have LLM tokens.

## Storage Boundary

Do not store user-level RPM/TPM as Prometheus labels. User-level metrics are high-cardinality
business/ops data and belong in Redis realtime keys plus Postgres rollup tables.

Recommended future tables:

- `usage_events`
- `usage_minute_rollups`
- `usage_daily_rollups`

Billing ledger remains the money and credit source of truth. Usage metrics may reference ledger
charges for `creditsUsed`, but must not replace billing ledger entries.
