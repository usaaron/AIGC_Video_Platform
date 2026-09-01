# Stable Tests And Isolated E2E

Status: accepted

The repository uses `test:full:stable` for the stable full verification path and `test:e2e` for browser flows. API database tests run serially against a shared test database with schema isolation, and the E2E suite mocks API routes instead of touching real Providers or billing state.

This replaces the previous pressure of starting many temporary Postgres containers during a full run and prevents E2E from creating provider charges or Docker leftovers. The trade-off is that mocked E2E covers product flows and request boundaries, while live Provider smoke tests remain explicit, manual, and cost-aware.
