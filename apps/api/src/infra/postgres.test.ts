import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../testing/postgresAuth.js'
import { AccountDatabase } from './postgres.js'

let postgres: PostgresAuthFixture | undefined

beforeAll(async () => {
  postgres = await startPostgresAuthFixture()
}, 120_000)

afterAll(async () => {
  await postgres?.close()
})

describe('postgres migrations', { timeout: 30_000 }, () => {
  it('runs advisory lock operations only while the lock is available', async () => {
    if (!postgres) throw new Error('Postgres fixture is not ready')
    const database = new AccountDatabase(postgres.connectionString)
    const lockKey = `seqora:test-lock:${uniqueSuffix()}`

    try {
      const result = await database.withAdvisoryLock(lockKey, async () => {
        const nested = await database.withAdvisoryLock(lockKey, async () => 'nested')
        return { nested }
      })
      const released = await database.withAdvisoryLock(lockKey, async () => 'released')

      expect(result).toEqual({ nested: null })
      expect(released).toBe('released')
    } finally {
      await database.close()
    }
  })

  it('checks pending migrations without applying them', async () => {
    const suffix = uniqueSuffix()
    const tableName = `migration_check_${suffix}`
    const migrationName = `900_${suffix}_check.sql`
    const migrationsPath = await createMigrationDirectory({
      [migrationName]: `CREATE TABLE ${tableName} (id TEXT PRIMARY KEY);`,
    })
    const database = await createDatabase(migrationsPath)

    try {
      await expect(database.ensureLatestMigrations()).rejects.toThrow(
        `Pending Postgres migrations: ${migrationName}`,
      )

      const table = await database.query<{ table_name: string | null }>(
        `SELECT to_regclass('public.${tableName}')::text AS table_name`,
      )
      expect(table.rows[0]?.table_name).toBeNull()
    } finally {
      await database.close()
      await rm(migrationsPath, { recursive: true, force: true })
    }
  })

  it('wraps each migration file in its own transaction', async () => {
    const suffix = uniqueSuffix()
    const okTableName = `migration_ok_${suffix}`
    const failedTableName = `migration_failed_${suffix}`
    const okMigrationName = `900_${suffix}_ok.sql`
    const failedMigrationName = `901_${suffix}_failed.sql`
    const migrationsPath = await createMigrationDirectory({
      [okMigrationName]: `
        CREATE TABLE ${okTableName} (id TEXT PRIMARY KEY);
        INSERT INTO ${okTableName} (id) VALUES ('ok');
      `,
      [failedMigrationName]: `
        CREATE TABLE ${failedTableName} (id TEXT PRIMARY KEY);
        INSERT INTO definitely_missing_migration_table (id) VALUES ('failed');
      `,
    })
    const database = await createDatabase(migrationsPath)

    try {
      await expect(database.migrate()).rejects.toThrow()

      const tables = await database.query<{
        ok_table_name: string | null
        failed_table_name: string | null
      }>(
        `
        SELECT
          to_regclass('public.${okTableName}')::text AS ok_table_name,
          to_regclass('public.${failedTableName}')::text AS failed_table_name
        `,
      )
      expect(tables.rows[0]).toEqual({
        ok_table_name: okTableName,
        failed_table_name: null,
      })

      const applied = await database.query<{ name: string }>(
        `
        SELECT name
        FROM schema_migrations
        WHERE name = ANY($1)
        ORDER BY name
        `,
        [[okMigrationName, failedMigrationName]],
      )
      expect(applied.rows).toEqual([{ name: okMigrationName }])
    } finally {
      await database.close()
      await rm(migrationsPath, { recursive: true, force: true })
    }
  })

  it('creates the project domain tables with their core constraints', async () => {
    if (!postgres) throw new Error('Postgres fixture is not ready')
    const database = new AccountDatabase(postgres.connectionString)

    try {
      const tables = await database.query<{
        projects_table: string | null
        project_versions_table: string | null
        assets_table: string | null
        shots_table: string | null
        generation_tasks_table: string | null
        ai_jobs_table: string | null
        outbox_events_table: string | null
        media_objects_table: string | null
      }>(
        `
        SELECT
          to_regclass('public.projects')::text AS projects_table,
          to_regclass('public.project_versions')::text AS project_versions_table,
          to_regclass('public.assets')::text AS assets_table,
          to_regclass('public.shots')::text AS shots_table,
          to_regclass('public.generation_tasks')::text AS generation_tasks_table,
          to_regclass('public.ai_jobs')::text AS ai_jobs_table,
          to_regclass('public.outbox_events')::text AS outbox_events_table,
          to_regclass('public.media_objects')::text AS media_objects_table
        `,
      )
      expect(tables.rows[0]).toEqual({
        projects_table: 'projects',
        project_versions_table: 'project_versions',
        assets_table: 'assets',
        shots_table: 'shots',
        generation_tasks_table: 'generation_tasks',
        ai_jobs_table: 'ai_jobs',
        outbox_events_table: 'outbox_events',
        media_objects_table: 'media_objects',
      })

      const userId = `user-${uniqueSuffix()}`
      const tenantId = `tenant-${uniqueSuffix()}`
      const projectId = `project-${uniqueSuffix()}`
      const assetId = `asset-${uniqueSuffix()}`
      const shotId = `shot-${uniqueSuffix()}`
      const taskId = `task-${uniqueSuffix()}`
      const aiJobId = `ai-job-${uniqueSuffix()}`
      const mediaId = `media-${uniqueSuffix()}`
      const versionId = `version-${uniqueSuffix()}`
      const membershipId = `membership-${tenantId}-${userId}`

      await database.transaction(async (client) => {
        await client.query(
          `INSERT INTO users (id, display_name, status, created_at, updated_at) VALUES ($1, $2, 'active', now(), now())`,
          [userId, 'Migration User'],
        )
        await client.query(
          `
          INSERT INTO tenants (id, name, status, created_by_user_id, created_at, updated_at)
          VALUES ($1, $2, 'active', $3, now(), now())
          `,
          [tenantId, 'Migration Tenant', userId],
        )
        await client.query(
          `
          INSERT INTO tenant_memberships (
            id, tenant_id, user_id, roles, is_primary, status, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, false, 'active', now(), now())
          `,
          [membershipId, tenantId, userId, ['owner']],
        )
        await client.query(
          `
          INSERT INTO projects (
            id, tenant_id, owner_user_id, name, content_type, aspect_ratio, status,
            synopsis, script, version, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, 'short-drama', '9:16', 'draft', '', '', 1, now(), now())
          `,
          [projectId, tenantId, userId, 'Migration Project'],
        )
        await client.query(
          `
          INSERT INTO project_versions (
            id, project_id, tenant_id, version, name, synopsis, script,
            project_snapshot, assets_snapshot, shots_snapshot, created_by_user_id, created_at
          )
          VALUES (
            $1, $2, $3, 1, $4, $5, $6,
            $7::jsonb, $8::jsonb, $9::jsonb, $10, now()
          )
          `,
          [
            versionId,
            projectId,
            tenantId,
            'Migration Project v1',
            'Snapshot synopsis',
            'Snapshot script',
            JSON.stringify({
              id: projectId,
              tenantId,
              ownerId: userId,
              name: 'Migration Project',
              contentType: 'short-drama',
              aspectRatio: '9:16',
              status: 'draft',
              synopsis: '',
              script: '',
              version: 1,
            }),
            JSON.stringify([
              {
                id: assetId,
                name: 'Snapshot Asset',
              },
            ]),
            JSON.stringify([
              {
                id: shotId,
                title: 'Snapshot Shot',
              },
            ]),
            userId,
          ],
        )
        await client.query(
          `
          INSERT INTO assets (
            id, project_id, tenant_id, kind, source_mode, name, description, prompt, prompt_mode,
            custom_prompt_mode, custom_prompt, negative_prompt, reference_items, attributes, image_url,
            status, created_at, updated_at
          )
          VALUES (
            $1, $2, $3, 'character', 'generate', $4, 'Asset description', 'Asset prompt',
            'standard', 'append', '', '', '[]'::jsonb,
            '{"type":"character","subjectType":"human","gender":"female","ageGroup":"young","exactAge":null,"species":"","anthropomorphic":false,"visualStyle":"cinematic-cg","framing":"full","bodyType":"balanced","background":"solid","faceStatus":"pending","bodyStatus":"pending","faceReference":null,"bodyReference":null,"portraitSource":"ai-virtual","trustedPortrait":null,"legStretch":false,"turnaround":false,"turnaroundLayout":"sheet"}'::jsonb,
            NULL, 'draft', now(), now()
          )
          `,
          [assetId, projectId, tenantId, 'Migration Asset'],
        )
        await client.query(
          `
          INSERT INTO shots (
            id, project_id, tenant_id, shot_order, title, framing, duration_seconds, prompt,
            negative_prompt, image_url, continuity_mode, continuity_note, created_at, updated_at
          )
          VALUES ($1, $2, $3, 1, $4, '中景', 5, 'Shot prompt', '', NULL, 'independent', '', now(), now())
          `,
          [shotId, projectId, tenantId, 'Migration Shot'],
        )
        await client.query(
          `
          INSERT INTO generation_tasks (
            id, client_request_id, project_id, tenant_id, user_id, membership_id, kind, label,
            prompt, negative_prompt, provider, model, tier, metadata, status, progress,
            estimated_credits, attempts, max_attempts, lease_owner_id, lease_token,
            lease_acquired_at, lease_heartbeat_at, lease_expires_at, result_url, outputs, error,
            created_at, updated_at
          )
          VALUES (
            $1, 'client-request-1', $2, $3, $4, $5, 'video', 'Task label',
            'Task prompt', '', 'local', NULL, NULL, '{"shotId":"shot-1"}'::jsonb, 'queued', 0,
            10, 0, 3, NULL, NULL, NULL, NULL, NULL, NULL, '[]'::jsonb, NULL, now(), now()
          )
          `,
          [taskId, projectId, tenantId, userId, membershipId],
        )
        await client.query(
          `
          INSERT INTO ai_jobs (
            id, client_request_id, project_id, tenant_id, user_id, membership_id, kind, label,
            provider, input, output, status, cost_credits, attempts, max_attempts,
            lease_owner_id, lease_token, lease_acquired_at, lease_heartbeat_at, lease_expires_at,
            error, refunded_at, created_at, updated_at
          )
          VALUES (
            $1, 'ai-client-request-1', $2, $3, $4, $5, 'novel.summaryQueueBatch', 'AI job label',
            'text', '{"queueId":"queue-1"}'::jsonb, NULL, 'queued', 4, 0, 3,
            NULL, NULL, NULL, NULL, NULL, NULL, NULL, now(), now()
          )
          `,
          [aiJobId, projectId, tenantId, userId, membershipId],
        )
        await client.query(
          `
          INSERT INTO media_objects (
            id, project_id, tenant_id, created_by_user_id, generation_task_id, asset_id, shot_id,
            media_type, purpose, name, content_type, size_bytes, storage_driver, storage_key, bucket,
            checksum_sha256, width, height, duration_seconds, metadata, status, deleted_at, created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            'video', 'generation-output', 'Render output', 'video/mp4', 1024, 'local', 'media/1',
            NULL, NULL, 1920, 1080, 5.25, '{}'::jsonb, 'active', NULL, now(), now()
          )
          `,
          [mediaId, projectId, tenantId, userId, taskId, assetId, shotId],
        )
      })

      const counts = await database.query<{
        project_count: string
        version_count: string
        asset_count: string
        shot_count: string
        task_count: string
        ai_job_count: string
        media_count: string
      }>(
        `
        SELECT
          (SELECT count(*)::text FROM projects WHERE id = $1) AS project_count,
          (SELECT count(*)::text FROM project_versions WHERE project_id = $1) AS version_count,
          (SELECT count(*)::text FROM assets WHERE project_id = $1) AS asset_count,
          (SELECT count(*)::text FROM shots WHERE project_id = $1) AS shot_count,
          (SELECT count(*)::text FROM generation_tasks WHERE project_id = $1) AS task_count,
          (SELECT count(*)::text FROM ai_jobs WHERE project_id = $1) AS ai_job_count,
          (SELECT count(*)::text FROM media_objects WHERE project_id = $1) AS media_count
        `,
        [projectId],
      )
      expect(counts.rows[0]).toEqual({
        project_count: '1',
        version_count: '1',
        asset_count: '1',
        shot_count: '1',
        task_count: '1',
        ai_job_count: '1',
        media_count: '1',
      })

      await expect(
        database.query(
          `
          INSERT INTO media_objects (
            id, project_id, tenant_id, media_type, purpose, name, content_type, size_bytes,
            storage_driver, storage_key, created_at, updated_at
          )
          VALUES (
            $1, $2, $3, 'video', 'generation-output', 'Duplicate storage key', 'video/mp4', 1,
            'local', 'media/1', now(), now()
          )
          `,
          [`media-${uniqueSuffix()}`, projectId, tenantId],
        ),
      ).rejects.toThrow()
    } finally {
      await database.close()
    }
  })

  it('normalizes legacy creator roles and rejects unknown account roles', async () => {
    if (!postgres) throw new Error('Postgres fixture is not ready')
    const suffix = uniqueSuffix()
    const database = new AccountDatabase(postgres.connectionString)
    const userId = `user-legacy-${suffix}`
    const tenantId = `tenant-legacy-${suffix}`
    const membershipId = `membership-legacy-${suffix}`
    const invitationId = `invitation-legacy-${suffix}`

    try {
      await database.transaction(async (client) => {
        await client.query(
          'ALTER TABLE tenant_memberships DROP CONSTRAINT IF EXISTS tenant_memberships_roles_known_check',
        )
        await client.query(
          'ALTER TABLE tenant_invitations DROP CONSTRAINT IF EXISTS tenant_invitations_roles_known_check',
        )
        await client.query(
          'ALTER TABLE tenant_invitations DROP CONSTRAINT IF EXISTS tenant_invitations_scope_roles_check',
        )
        await client.query(
          `
          INSERT INTO users (id, display_name, status, created_at, updated_at)
          VALUES ($1, 'Legacy User', 'active', now(), now())
          `,
          [userId],
        )
        await client.query(
          `
          INSERT INTO tenants (id, name, status, created_at, updated_at)
          VALUES ($1, 'Legacy Tenant', 'active', now(), now())
          `,
          [tenantId],
        )
        await client.query(
          `
          INSERT INTO tenant_memberships (id, tenant_id, user_id, roles, is_primary, status, created_at, updated_at)
          VALUES ($1, $2, $3, ARRAY['creator', 'admin', 'creator']::text[], false, 'active', now(), now())
          `,
          [membershipId, tenantId, userId],
        )
        await client.query(
          `
          INSERT INTO tenant_invitations (
            id, tenant_id, email, roles, invited_by_user_id, token_secret_hash, status, expires_at,
            created_at, updated_at
          )
          VALUES ($1, $2, $3, ARRAY['creator']::text[], $4, $5, 'pending', now() + interval '7 days', now(), now())
          `,
          [invitationId, tenantId, `legacy-${suffix}@example.com`, userId, `token-secret-${suffix}`],
        )
      })
      await database.query(await readProjectMigration('009_account_roles.sql'))

      const roles = await database.query<{
        membership_roles: string[]
        invitation_roles: string[]
      }>(
        `
        SELECT
          (SELECT roles FROM tenant_memberships WHERE id = $1) AS membership_roles,
          (SELECT roles FROM tenant_invitations WHERE id = $2) AS invitation_roles
        `,
        [membershipId, invitationId],
      )
      expect(roles.rows[0]).toEqual({
        membership_roles: ['member', 'admin'],
        invitation_roles: ['member'],
      })

      await expect(
        database.query(
          `
          INSERT INTO tenant_memberships (id, tenant_id, user_id, roles)
          VALUES ($1, $2, $3, ARRAY['creator']::text[])
          `,
          [`membership-invalid-${suffix}`, tenantId, userId],
        ),
      ).rejects.toThrow()

      await expect(
        database.query(
          `
          INSERT INTO tenant_invitations (
            id, tenant_id, email, roles, invited_by_user_id, token_secret_hash, status, expires_at
          )
          VALUES ($1, $2, $3, ARRAY['creator']::text[], $4, $5, 'pending', now() + interval '7 days')
          `,
          [
            `invitation-invalid-${suffix}`,
            tenantId,
            `invalid-${suffix}@example.com`,
            userId,
            `invalid-token-secret-${suffix}`,
          ],
        ),
      ).rejects.toThrow()
    } finally {
      await database.query('DELETE FROM tenant_invitations WHERE id = $1', [invitationId]).catch(() => {})
      await database.query(await readProjectMigration('016_organization_roles.sql')).catch(() => {})
      await database.query(await readProjectMigration('027_organization_invitation_scopes.sql')).catch(() => {})
      await database.close()
    }
  })

  it('rejects a second active owner at the database migration layer', async () => {
    if (!postgres) throw new Error('Postgres fixture is not ready')
    await postgres.reset()
    const suffix = uniqueSuffix()
    const database = new AccountDatabase(postgres.connectionString)
    const tenantId = `tenant-role-limit-${suffix}`
    const ownerUserId = `user-role-limit-owner-${suffix}`
    const secondOwnerUserId = `user-role-limit-second-owner-${suffix}`
    const ownerMembershipId = `membership-role-limit-owner-${suffix}`

    try {
      const applied = await database.query<{ name: string }>(
        `
        SELECT name
        FROM schema_migrations
        WHERE name = '017_account_role_limits.sql'
        `,
      )
      expect(applied.rows).toEqual([{ name: '017_account_role_limits.sql' }])

      await database.transaction(async (client) => {
        await client.query(
          `
          INSERT INTO users (id, display_name, status, created_at, updated_at)
          VALUES
            ($1, 'Role Limit Owner', 'active', now(), now()),
            ($2, 'Role Limit Second Owner', 'active', now(), now())
          `,
          [ownerUserId, secondOwnerUserId],
        )
        await client.query(
          `
          INSERT INTO tenants (id, name, status, created_by_user_id, created_at, updated_at)
          VALUES ($1, 'Role Limit Tenant', 'active', $2, now(), now())
          `,
          [tenantId, ownerUserId],
        )
        await client.query(
          `
          INSERT INTO tenant_memberships (
            id, tenant_id, user_id, roles, is_primary, status, created_at, updated_at
          )
          VALUES ($1, $2, $3, ARRAY['owner']::text[], true, 'active', now(), now())
          `,
          [ownerMembershipId, tenantId, ownerUserId],
        )
      })

      await expect(
        database.query(
          `
          INSERT INTO tenant_memberships (
            id, tenant_id, user_id, roles, is_primary, status, created_at, updated_at
          )
          VALUES ($1, $2, $3, ARRAY['owner']::text[], false, 'active', now(), now())
          `,
          [`membership-role-limit-second-owner-${suffix}`, tenantId, secondOwnerUserId],
        ),
      ).rejects.toMatchObject({ code: '23514' })

      const owners = await database.query<{ count: string }>(
        `
        SELECT count(DISTINCT m.user_id)::text AS count
        FROM tenant_memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.status = 'active'
          AND u.status = 'active'
          AND m.roles @> ARRAY['owner']::text[]
        `,
      )
      expect(owners.rows[0]).toEqual({ count: '1' })
    } finally {
      await database.close()
    }
  })

  it('marks and protects the internal system organization at the database layer', async () => {
    if (!postgres) throw new Error('Postgres fixture is not ready')
    await postgres.reset()
    const database = new AccountDatabase(postgres.connectionString)

    try {
      await database.query(
        `
        INSERT INTO tenants (id, name, status, is_system, organization_type, created_at, updated_at)
        VALUES ('tenant-seqora-demo', 'Seqora Local', 'active', true, 'system', now(), now())
        `,
      )
      const systemOrganization = await database.query<{
        id: string
        status: string
        is_system: boolean
        organization_type: string
      }>(
        `
        SELECT id, status, is_system, organization_type
        FROM tenants
        WHERE id = 'tenant-seqora-demo'
        `,
      )
      expect(systemOrganization.rows).toEqual([
        {
          id: 'tenant-seqora-demo',
          status: 'active',
          is_system: true,
          organization_type: 'system',
        },
      ])

      await expect(
        database.query(
          `
          UPDATE tenants
          SET status = 'disabled'
          WHERE id = 'tenant-seqora-demo'
          `,
        ),
      ).rejects.toMatchObject({ code: '23514' })

      await expect(
        database.query(
          `
          UPDATE tenants
          SET is_system = false
          WHERE id = 'tenant-seqora-demo'
          `,
        ),
      ).rejects.toMatchObject({ code: '23514' })

      await expect(
        database.query(
          `
          DELETE FROM tenants
          WHERE id = 'tenant-seqora-demo'
          `,
        ),
      ).rejects.toMatchObject({ code: '23514' })
    } finally {
      await database.close()
    }
  })

  it('rejects incompatible invitation scopes and organization types at the database layer', async () => {
    if (!postgres) throw new Error('Postgres fixture is not ready')
    await postgres.reset()
    const database = new AccountDatabase(postgres.connectionString)
    const suffix = uniqueSuffix()
    const actorUserId = `user-invitation-scope-${suffix}`
    const personalTenantId = `tenant-personal-${suffix}`
    const enterpriseTenantId = `tenant-enterprise-${suffix}`
    const systemTenantId = 'tenant-seqora-demo'

    async function insertInvitation(input: {
      id: string
      tenantId: string
      roles: string[]
      scope: string
    }) {
      return await database.query(
        `
        INSERT INTO tenant_invitations (
          id, tenant_id, email, roles, invitation_scope, invited_by_user_id,
          token_secret_hash, status, expires_at, accepted_at, revoked_at, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, 'pending', now() + interval '1 day', NULL, NULL, now(), now()
        )
        `,
        [
          input.id,
          input.tenantId,
          `${input.id}@example.com`,
          input.roles,
          input.scope,
          actorUserId,
          `hash-${input.id}`,
        ],
      )
    }

    try {
      await database.query(
        `
        INSERT INTO users (id, display_name, status, created_at, updated_at)
        VALUES ($1, 'Invitation Scope Actor', 'active', now(), now())
        `,
        [actorUserId],
      )
      await database.query(
        `
        INSERT INTO tenants (id, name, status, is_system, organization_type, created_by_user_id, created_at, updated_at)
        VALUES
          ($1, 'Personal Organization', 'active', false, 'personal', $4, now(), now()),
          ($2, 'Enterprise Organization', 'active', false, 'enterprise', $4, now(), now()),
          ($3, 'Seqora Local', 'active', true, 'system', $4, now(), now())
        `,
        [personalTenantId, enterpriseTenantId, systemTenantId, actorUserId],
      )

      await expect(
        insertInvitation({
          id: `invitation-valid-platform-${suffix}`,
          tenantId: personalTenantId,
          roles: ['member'],
          scope: 'platform_registration',
        }),
      ).resolves.toMatchObject({ rowCount: 1 })

      await expect(
        insertInvitation({
          id: `invitation-valid-organization-${suffix}`,
          tenantId: enterpriseTenantId,
          roles: ['organization_member'],
          scope: 'organization_membership',
        }),
      ).resolves.toMatchObject({ rowCount: 1 })

      await expect(
        insertInvitation({
          id: `invitation-valid-system-${suffix}`,
          tenantId: systemTenantId,
          roles: ['admin'],
          scope: 'system_account',
        }),
      ).resolves.toMatchObject({ rowCount: 1 })

      await expect(
        insertInvitation({
          id: `invitation-platform-on-enterprise-${suffix}`,
          tenantId: enterpriseTenantId,
          roles: ['member'],
          scope: 'platform_registration',
        }),
      ).rejects.toMatchObject({ code: '23514' })

      await expect(
        insertInvitation({
          id: `invitation-org-on-personal-${suffix}`,
          tenantId: personalTenantId,
          roles: ['organization_member'],
          scope: 'organization_membership',
        }),
      ).rejects.toMatchObject({ code: '23514' })

      await expect(
        insertInvitation({
          id: `invitation-system-on-enterprise-${suffix}`,
          tenantId: enterpriseTenantId,
          roles: ['admin'],
          scope: 'system_account',
        }),
      ).rejects.toMatchObject({ code: '23514' })

      await expect(
        insertInvitation({
          id: `invitation-member-org-scope-${suffix}`,
          tenantId: enterpriseTenantId,
          roles: ['member'],
          scope: 'organization_membership',
        }),
      ).rejects.toMatchObject({ code: '23514' })
    } finally {
      await database.close()
    }
  })
})

async function createDatabase(migrationsPath: string): Promise<AccountDatabase> {
  if (!postgres) throw new Error('Postgres fixture is not ready')
  return new AccountDatabase(postgres.connectionString, migrationsPath)
}

async function createMigrationDirectory(files: Record<string, string>): Promise<string> {
  const migrationsPath = await mkdtemp(join(tmpdir(), 'seqora-migrations-'))
  await Promise.all(
    Object.entries(files).map(([name, sql]) => writeFile(join(migrationsPath, name), sql, 'utf8')),
  )
  return migrationsPath
}

async function readProjectMigration(name: string): Promise<string> {
  return await import('node:fs/promises').then(({ readFile }) =>
    readFile(new URL(`./migrations/${name}`, import.meta.url), 'utf8'),
  )
}

function uniqueSuffix(): string {
  return randomUUID().replaceAll('-', '')
}
