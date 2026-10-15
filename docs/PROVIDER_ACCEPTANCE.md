# Provider acceptance

Use this check only after the API, Worker, Redis and object storage are running in a staging-like
environment. It creates real provider tasks and consumes credits/quota.

```bash
PROVIDER_ACCEPTANCE=1 pnpm provider:acceptance
```

Optional variables:

- `PROVIDER_ACCEPTANCE_API_ORIGIN`: API origin, default `http://127.0.0.1:8787`.
- `PROVIDER_ACCEPTANCE_EMAIL` / `PROVIDER_ACCEPTANCE_PASSWORD`: local login credentials.
- `PROVIDER_ACCEPTANCE_PROJECT_ID`: project to use. Defaults to the first visible project.
- `PROVIDER_ACCEPTANCE_TIMEOUT_MS`: per-task polling timeout. Defaults to 15 minutes.
- `PROVIDER_ACCEPTANCE_VIDEO=0`, `PROVIDER_ACCEPTANCE_IMG2=0`, `PROVIDER_ACCEPTANCE_AUDIO=0`: skip one provider.

The script verifies:

- Health reports Seedance, Img2 and Audio as configured.
- The task queue is BullMQ and storage is not local disk.
- Cancel returns `refundCredits` before provider submission.
- Failed tasks can be retried and task logs record the retry.
- Img2 writes three separate `front` / `side` / `back` platform media URLs.
- Img2 can regenerate one turnaround view, for example only `side`.
- Audio and Seedance outputs are materialized as `/api/v1/media/:id`.
- Each platform media URL is readable with the logged-in session.
- Completed tasks include durable task log events such as `task.created`, `provider.submitted`
  and `task.completed`.

Keep this script out of the default `pnpm check` path. CI should continue to use mocks for provider
and object storage behavior; run provider acceptance manually or from a protected staging workflow.
