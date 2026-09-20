# Quick model operation settings

Quick uses the configured planning, script, review and repair models. Its bounded
operation settings are local to each Quick invocation; standard workflows and
shared adapter objects retain their configured role settings.

| Environment variable | Default | Accepted values |
| --- | --- | --- |
| `QUICK_SCRIPT_REQUEST_DEADLINE_SECONDS` | `480` | Positive seconds, at most `480` |
| `QUICK_SCRIPT_OPERATION_DEADLINE_SECONDS` | `600` | At least the request deadline, at most `600` |
| `QUICK_SCRIPT_PLANNING_REASONING_EFFORT` | `low` | `low` or `high`; `medium` is accepted but maps to `high` on DeepSeek |

The Quick request deadline replaces the generic role request deadline only in
the current call context. For example, `LLM_PLANNING_REQUEST_DEADLINE_SECONDS=120`
still limits standard planning to two minutes while Quick can wait up to eight
minutes for its single request. An earlier enclosing operation deadline still
wins. Socket idle timeouts are unchanged; the production planning socket timeout
of 600 seconds exceeds Quick's cumulative request budget.

Only the compact **plan** step uses the Quick reasoning effort. Synopsis,
screenplay, review and repair retain their role effort. Thinking is not disabled,
the original streaming channel remains active, and no model is replaced.

Each step permits one physical model request. Timeouts and transport failures
stop that step; retry loops, transport changes and model fallback cannot spend
another request. Explicit recovery retries only the failed step, retaining the
confirmed synopsis, saved plan and completed episodes. Same operation IDs remain
idempotent.

Failed operation receipts retain only these diagnostic fields: `error_type`,
`category`, optional `http_status` and `deadline_scope`, `elapsed_ms`, and
`physical_requests`. They never contain provider error text, URLs, credentials,
or prompts. HTTP 504/524 is distinguished from the application's cumulative
deadline. Candidate artifacts retain the existing recovery behavior.
