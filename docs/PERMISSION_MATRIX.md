# Organization and Identity Permission Matrix

This document freezes the public product vocabulary and the formal account role model.
Public API and frontend copy must use `organization`. Database table names that still use
`tenant` are internal implementation details.

## Public API Vocabulary

| Surface                     | Rule                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| New public organization API | Use `/api/v1/organizations/*`.                                                                                             |
| New admin organization API  | Use `/api/v1/admin/organizations/*`.                                                                                       |
| Compatibility API           | `/api/v1/workspaces/*`, `/api/v1/tenants/*`, and `/api/v1/admin/tenants/*` remain only as deprecated compatibility routes. |
| Deprecated response headers | Compatibility routes must return `Deprecation: true` and a `Link` header pointing to the `/organizations/*` successor.     |
| Internal DB naming          | `tenants`, `tenant_memberships`, and `tenant_invitations` may remain until a dedicated DB naming migration.                |
| Forbidden new vocabulary    | Do not add new public `workspace`, `tenant`, or `creator` concepts.                                                        |

## Frozen Roles

The formal role set is exactly:

| Role                  | Product meaning                                                  | Scope                                    |
| --------------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| `owner`               | Platform owner with final control                                | Global                                   |
| `super_admin`         | Global administrator close to owner, without final owner control | Global                                   |
| `admin`               | Internal platform operations, support, and review administrator  | Assigned organization scope              |
| `member`              | C-side individual creator                                        | Own account and authorized creative data |
| `organization_admin`  | B-side organization administrator                                | Own organization only                    |
| `organization_member` | B-side organization employee or collaborator                     | Own organization only                    |

`creator` is retired. Historical DB migrations may convert `creator` to `member`, but new
contracts, API inputs, bootstrap paths, and production runtime code must not reintroduce it.

## Permission Matrix

| Permission               | owner | super_admin | admin | member | organization_admin | organization_member |
| ------------------------ | ----- | ----------- | ----- | ------ | ------------------ | ------------------- |
| `project.read`           | yes   | yes         | yes   | yes    | yes                | yes                 |
| `project.write`          | yes   | yes         | no    | yes    | yes                | yes                 |
| `generation.task.create` | yes   | yes         | no    | yes    | yes                | yes                 |
| `generation.task.read`   | yes   | yes         | yes   | yes    | yes                | yes                 |
| `asset.read`             | yes   | yes         | yes   | yes    | yes                | yes                 |
| `asset.write`            | yes   | yes         | no    | yes    | yes                | yes                 |
| `billing.read.self`      | yes   | yes         | no    | yes    | no                 | yes                 |
| `billing.read.all`       | yes   | yes         | yes   | no     | yes                | no                  |
| `billing.manage`         | yes   | yes         | yes   | no     | yes                | no                  |
| `usage.read.self`        | yes   | yes         | yes   | yes    | yes                | yes                 |
| `usage.read.scoped`      | yes   | yes         | yes   | no     | yes                | no                  |
| `usage.read.all`         | yes   | yes         | no    | no     | no                 | no                  |
| `user.read`              | yes   | yes         | yes   | no     | yes                | no                  |
| `user.manage`            | yes   | yes         | yes   | no     | yes                | no                  |
| `admin.dashboard.read`   | yes   | yes         | yes   | no     | yes                | no                  |
| `system.config.manage`   | yes   | no          | no    | no     | no                 | no                  |

The executable source of truth is `packages/contracts/src/permissions.ts`. Contract tests
freeze the role set and the exact matrix.

## Management Boundaries

| Actor                 | Can create/manage                                                                                     | Cannot manage                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `owner`               | All users and organizations; appoint or revoke `super_admin`; transfer organization administrators    | Cannot create a second active owner                                                                                                         |
| `super_admin`         | `admin`, `member`, `organization_admin`, `organization_member`; all non-owner organization records    | Cannot replace owner final control; cannot appoint or revoke `super_admin`                                                                  |
| `admin`               | C-side `member` accounts and scoped platform operations                                               | `owner`, `super_admin`, `admin`, `organization_admin`, `organization_member`                                                                |
| `member`              | Own account, own sessions, authorized creative content                                                | Admin console and other users                                                                                                               |
| `organization_admin`  | Own organization's `organization_member` accounts, sessions, billing records, and operational records | Other organizations; platform `member`, `admin`, `super_admin`, `owner`; other `organization_admin` unless transferred by owner/super_admin |
| `organization_member` | Own account, own sessions, authorized organization creative content                                   | Admin console and other users                                                                                                               |

## Usage Visibility Boundaries

Usage metrics include realtime concurrency, RPM, TPM, request counts, token counts,
credit consumption, provider usage, and error rates. User-level usage data is high-cardinality
operational data and must not be exposed through public metrics labels.

| Actor                 | Usage visibility                                                                                                   | Required permission                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `owner`               | All platform users, all organizations, global totals, and per-user/per-organization details                        | `usage.read.all`                                            |
| `super_admin`         | All platform users, all organizations, global totals, and per-user/per-organization details                        | `usage.read.all`                                            |
| `admin`               | Platform C-side `member` users and explicitly authorized platform operations scope; no owner/super_admin internals | `usage.read.scoped`; repository must apply scope rules      |
| `organization_admin`  | Users, sessions, jobs, billing usage, and usage records inside the current organization only                       | `usage.read.scoped`; repository must filter by organization |
| `member`              | Own usage only                                                                                                     | `usage.read.self`                                           |
| `organization_member` | Own usage only inside the authorized organization                                                                  | `usage.read.self`                                           |

The backend scope helper is `usageVisibilityFor()` in `apps/api/src/core/auth/roles.ts`:

- `owner` and `super_admin`: `all`.
- `admin`: `platform_scope`.
- `organization_admin`: `organization_scope`.
- `member` and `organization_member`: `self`.

Future usage APIs must authorize with `usage.read.self`, `usage.read.scoped`, or `usage.read.all`
and then apply the scope returned by `usageVisibilityFor()`. Frontend hiding is not sufficient.
Metric names and counting rules are frozen in `docs/USAGE_METRICS.md` and
`packages/contracts/src/usage.ts`.

## Hard Limits

| Rule                                                 | Enforced by                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| At most one active `owner` account globally          | API service checks and `017_account_role_limits.sql` trigger         |
| At most five active `super_admin` accounts globally  | API service checks and `017_account_role_limits.sql` trigger         |
| System organization is internal only                 | `018_system_organizations.sql` and account management service checks |
| Production startup must not auto-bootstrap accounts  | `BOOTSTRAP_ACCOUNTS_ON_START=false` production config guard          |
| Production startup must not seed demo workspace data | `BOOTSTRAP_DEMO_WORKSPACE=false` production config guard             |
| Production account creation is explicit              | Run `db:migrate`, then `accounts:init`, then start API and Worker    |

## Test Requirements

Every change that touches roles, organizations, or account bootstrap must keep these checks green:

- `packages/contracts/src/permissions.test.ts`: frozen roles and permission matrix.
- `apps/api/src/config.test.ts`: production rejects demo auth, startup bootstrap, and demo workspace bootstrap.
- `apps/api/src/infra/postgres.test.ts`: DB rejects `creator`, second active owner, and protected system organization changes.
- `apps/api/src/modules/accountManagement/routes.test.ts`: deprecated compatibility headers, role limits, creator input rejection, and scoped role management.
- `apps/api/src/modules/admin/routes.test.ts`: admin console scope boundaries for users, organizations, billing, sessions, and audit logs.
