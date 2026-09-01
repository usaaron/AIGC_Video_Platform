# Context Map

This repository has multiple active product contexts. Read the matching `CONTEXT.md` before changing a feature so new code, UI copy, tests and docs use the same language.

## Contexts

- [Creative Platform](./docs/contexts/creative/CONTEXT.md) - project creation, assets, 生图大师, generation batches, media reuse and the account asset library.
- [Admin Console](./docs/contexts/admin/CONTEXT.md) - personal account management, organization spaces, plan changes, billing operations and compliance review.

## Relationships

- **Creative Platform -> Asset Library**: project assets and generation results can be saved to the account-level asset library, then imported back into a project.
- **Creative Platform -> Admin Console**: prompts and generation metadata can appear in admin compliance review; admin copy must stay operator-facing and not leak into ordinary user UI.
- **Admin Console -> Product Vocabulary**: role and account terms must follow [PRODUCT_VOCABULARY.md](./docs/PRODUCT_VOCABULARY.md) and [ADMIN_ACCOUNT_MODEL.md](./docs/ADMIN_ACCOUNT_MODEL.md).
- **Testing & Release**: full verification and E2E rules live in [BACKEND_TESTING.md](./docs/BACKEND_TESTING.md), [RELIABILITY_GATES.md](./docs/RELIABILITY_GATES.md) and [OPERATIONS_RUNBOOK.md](./docs/OPERATIONS_RUNBOOK.md).

## Current Feature References

- [生图大师](./docs/IMAGE2_STUDIO.md)
- [资产库](./docs/ASSET_LIBRARY.md)
- [账号模型与后台文案](./docs/ADMIN_ACCOUNT_MODEL.md)
- [当前状态](./docs/CURRENT_STATE.md)
- [开发记忆](./docs/DEVELOPMENT_MEMORY.md)
