# 53 DeepSeek Model Migration and Workflow Acceptance

Updated: 2026-09-11. This supersedes the active model allocation in report 51.

## Active Model Allocation

| Role | Model | Transport and reasoning |
| --- | --- | --- |
| Mainland screenplay, bounded repairs and conversation edits | deepseek-v4-pro | Chat Completions, thinking enabled, high |
| Planning conversation edits and Astra fallback | deepseek-v4-pro | Chat Completions, thinking enabled, high |
| Input classification and supplied-fact extraction | deepseek-v4-flash | Chat Completions, thinking disabled, 60s request budget |
| Independent dialogue presentation and translation | deepseek-v4-flash | Chat Completions, thinking disabled, 120s request budget |
| Initial outline, story tree, episode plan, Grill Me | gpt-6-astra | Responses, existing role budgets |
| Overseas screenplay and screenplay repairs/edits | gemini-3.6-flash | Chat Completions, existing role budgets |

The local environment, merged template, split templates and runtime fallback
selector use the new allocation. Pro and Flash share one DeepSeek credential
profile. Historical GLM artifacts and generic protocol compatibility tests remain
historical evidence; active roles no longer use GLM.

DeepSeek parameters follow the [official Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/).
Provider documentation and actual gateway support are verified separately.

## Migration Evidence

- The two active DeepSeek request configurations passed live streaming and
  non-streaming synthetic JSON probes: four successful requests, 2.32-6.38s each.
- Pro used enabled/high; Flash used disabled thinking and JSON object output.
- Reports are in `.cache/workflow-acceptance-20260911/deepseek-protocols.json`.
- Missing classifier credentials cannot inherit a different provider's primary
  credentials. Optional classification still permits local analysis offline.
- The active adapter inventory contains Astra, DeepSeek Pro/Flash and Gemini;
  no active GLM route remains. Startup diagnostics name both dialogue markets.
- Backend regression after the migration and blueprint fixes: 1360 passed, 1 skipped.
  The focused protocol, runtime, template and planning regression passed 405 tests. Frontend:
  399 passed, TypeScript and API contract checks passed.

## Workflow Scope

The isolated workflow probe now accepts both markets and one to three episodes,
records structured outputs for failure diagnosis, and bounds provider requests
and total elapsed time. Leaf readiness uses the product's shared 8-12 episode
constants. The previous probe incorrectly attempted to decompose 11-12 episode
leaves; its HTTP 422 was a test-client error.

`verify_story_workflow_delivery.py` copies the test SQLite database and starts a
new process to verify workspace persistence, zero-request draft replay,
provisional artifacts, idempotent canonical writes and ledger audit consistency.
Canonical confirmation is simulated only in that disposable database copy.

The frontend delivery probe checks Markdown, TXT and DOCX dialogue preservation,
incomplete-series confirmation rejection, and confirmation invalidation after
edits. Browser confirmation uses a clearly separate complete-subset fixture;
three drafts in a planned 48-episode work do not count as full-series delivery.

Browser confirmation, ZIP export and persisted confirmation after reload passed
at 1440x900 and 390x844, with no page errors or horizontal overflow. This uses
mocked project APIs and the complete-subset fixture described above.

The original 120s DeepSeek fallback budget expired during valid reasoning. With
a 300s budget, the mainland Story Bible completed in 167.28s on DeepSeek Pro;
the tree then compiled locally. Long roadmap calls now stream and use the
configured chunk budget. A later three-episode resume reached the roadmap
endpoint but still exhausted the 120s Astra primary plus 300s DeepSeek Pro
fallback path while producing reasoning only. The full workflow therefore remains
unaccepted. Single-episode body generation does complete: the Pro/high JSON-mode
sample saved 1,008 body characters after one initial request plus one focused
repair; the Pro/low comparison saved 777 characters in one request. Neither is a
creative-quality approval.

Streaming removed the 60s silent-response disconnect, but a six-episode Pro/high
roadmap batch still exhausted its 300s request budget during reasoning. The
resumable roadmap chunk size is now separately configurable through
`LLM_EPISODE_PLAN_CHUNK_SIZE` (1-6, legacy default 6). Current local and template
configuration uses 3; the complete 8-12 episode leaf, context, accepted prefix,
review gates and model reasoning level are preserved. Before JSON mode was enabled,
a Pro/low roadmap comparison reached a length finish after two complete plans and
one truncated plan; it is retained as diagnostic evidence. Production remains
Pro/high. The overseas Story Bible and both markets' full workflow have not passed
real acceptance.

DeepSeek V4 JSON output is now enabled for active thinking roles as `json_object`;
the adapter keeps the schema in the prompt and validates the result locally. Four
live protocol checks for Pro/Flash, streaming and non-streaming, passed after this
change. Blueprint completion now sends its exact field schema and the existing
scene context, preventing invented field names from reaching the 422 gate.

Both development instances, 3001/8001 and 3002/8002, loaded the new model
allocation. HTTP readiness and pages returned 200; the five existing projects
remained present. Desktop/mobile export verification also passed on 3001 with
all three document formats actually selected and inspected inside the ZIP.

No whole-series creative approval or enterprise production-readiness claim is
made by these mechanical checks.
