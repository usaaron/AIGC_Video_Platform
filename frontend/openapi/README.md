# API Contract

`openapi.json` is exported directly from the FastAPI application. The matching
TypeScript declarations live in `lib/generated/api-schema.d.ts`.

Run `npm run api:generate` after changing a backend route or schema. Run
`npm run api:check` in validation jobs to fail when either generated file is
stale. Neither command starts the backend server.
