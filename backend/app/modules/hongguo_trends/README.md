# Hongguo Public Feeds

This module reads the public HTML at `https://hongguoduanju.com`. It does not
invoke an LLM or the content-spec/data-intelligence ingestion pipeline.
The displayed publication label is copied from visible HTML; it is not inferred
from fetch time. Category pages currently have no displayed update label.

## API

Both endpoints accept `format=real|comic|ai` (default `comic`) and return
`{"data": {...}}`:

- `GET /hongguo/categories`: `categories: [{label, tag_id}]`.
- `GET /hongguo/trending-tags`: `recommendations`, `sample_work_count`, and
  `pages_fetched`.
- Each recommendation contains `label`, nullable `tag_id`, `raw_labels`, `rank`,
  `ranked_work_count`, `weighted_score`, and up to three `sample_works` containing
  `title`, `url`, source work `rank`, and nullable `cover_url`.
- Both data objects include `id`, `format`, `source_url`, nullable `fetched_at`,
  nullable `source_updated_label`, `stale`, `status`, `last_attempt_at`,
  `last_attempt_status`, nullable `next_retry_at`, and `next_refresh_at`.

Successful and stale responses use HTTP 200. A failed cold fetch uses HTTP 503
with the same data envelope, `status: "unavailable"`, `fetched_at: null`, empty
items, and `Retry-After: 300`. All timestamps use an explicit UTC offset.

Recommendations include every meaningful source label up to 20 codepoints,
including unknown ontology labels with `tag_id: null`. Only exact known labels
and synonyms map to the mainland ontology; unknowns are not discarded.
The frontend can persist them as `custom.hongguo.*` IDs plus custom tag labels.
`raw_labels` retains source aliases merged under one known ontology ID.
In particular, horror/fantasy labels with different mainland meanings are not
merged merely because the English ontology identifier sounds similar.

`weighted_score` sums `1 / source_work_rank` once per tag per deduplicated work.
Recommendation `rank` is the ordinal of that derived order, not an official
platform tag ranking. Ties use work count and then the stable tag key.
Work IDs are deduplicated; explicit numbered season/part suffixes are grouped
only when the remaining title matches exactly and has at least three characters.
The best-ranked representative provides the franchise's tags and sample link.

## Cache and Lifecycle

`HongguoTrendsRepository` reuses `DocumentRepository`. Persistence requires its
database runtime factory; without one, repository storage is in memory.
The six fixed document IDs are `{categories|trends}.v2.{real|comic|ai}`.
Older skeleton IDs are ignored. TTL is one hour from a successful fetch;
failed attempts, including cold failures, persist a five-minute retry window.
Failed or inconsistent pagination never replaces previously usable data.

`service.refresh_due(stop_event: threading.Event | None = None)` returns a list
of snapshots refreshed during that call. It visits only these six existing keys,
honors TTL/backoff, skips busy formats, and never starts untouched feeds.
Lifespan code may call it using `asyncio.to_thread` once per minute. Set the event
on shutdown and await the active batch: the event is checked between feeds.
Each feed uses a 45-second elapsed budget and at most a 10-second socket timeout;
an in-progress socket operation can finish after the elapsed budget.

Singleflight locks are process-local and shared across service instances.
Multiple workers may fetch the same feed concurrently. Durable writes are atomic
but last-write-wins; this module provides no cross-process lease or Redis lock.

Fetches use `httpx` with `trust_env=False`, no redirects, and an exact allowlist
of three category roots and up to five rank pages per format. Source pagination
URLs are never followed. HTML bodies are capped at four MB. Sample work links
are constructed from numeric series IDs; cover links are restricted to the
observed HTTPS ByteDance image hosts and are never fetched by this service.

## Verified Categories

Verified from visible category navigation on 2026-09-11, preserving source order:

- `real`: 爱情、年代、逆袭、传奇、成长、家庭、家族、萌宝、悬疑、惊悚、恐怖、志怪、古装、玄幻、奇幻、都市、青春、喜剧、科幻、灾难、动作冒险、战争、综艺、剧情
- `comic` and `ai`: 脑洞、玄幻、剧情、末世、豪门、奇幻、科幻、冒险

These are observations for frontend defaults, not a server fallback on failure.
