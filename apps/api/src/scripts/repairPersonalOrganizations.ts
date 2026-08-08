import 'dotenv/config'
import { loadConfig } from '../config.js'
import { AccountDatabase } from '../infra/postgres.js'
import { systemTenantId } from './bootstrapAccounts.js'

const config = loadConfig()

if (!config.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for pnpm --filter @seqora/api db:repair-personal-organizations',
  )
}

const dryRun = process.argv.includes('--dry-run')
const database = new AccountDatabase(config.DATABASE_URL)

try {
  if (config.NODE_ENV === 'production') {
    await database.ensureLatestMigrations()
  } else {
    await database.migrate()
  }

  const report = await repairPersonalOrganizations(database, { dryRun })
  process.stdout.write(formatReport(report, dryRun))
} finally {
  await database.close()
}

type RepairOptions = {
  dryRun?: boolean
}

type RepairTarget = {
  membershipId: string
  userId: string
  email: string
  displayName: string
  oldTenantId: string
  oldTenantName: string
  roles: string[]
}

type RepairTargetReport = {
  email: string
  userId: string
  sourceMembershipId: string
  oldTenantId: string
  newTenantId: string
  newTenantName: string
  otherMembershipsDisabled: number
  otherMembershipSessionsRevoked: number
  sessionsRevoked: number
  projectsMoved: number
  projectVersionsMoved: number
  assetsMoved: number
  shotsMoved: number
  generationTasksMoved: number
  mediaObjectsMoved: number
  aiJobsMoved: number
  billingLedgerEntriesMoved: number
  usageEventsMoved: number
  usageMinuteRollupsMoved: number
}

type RepairReport = {
  candidates: RepairTargetReport[]
  skipped: number
}

async function repairPersonalOrganizations(
  database: AccountDatabase,
  options: RepairOptions,
): Promise<RepairReport> {
  return await database.transaction(async (client) => {
    const targets = await client.query<RepairTarget>(
      `
      SELECT
        m.id AS "membershipId",
        m.user_id AS "userId",
        COALESCE(ai.email, '') AS email,
        COALESCE(u.display_name, '') AS "displayName",
        m.tenant_id AS "oldTenantId",
        t.name AS "oldTenantName",
        m.roles
      FROM tenant_memberships m
      JOIN users u ON u.id = m.user_id AND u.status = 'active'
      JOIN tenants t ON t.id = m.tenant_id
      LEFT JOIN LATERAL (
        SELECT email
        FROM auth_identities ai
        WHERE ai.user_id = u.id
          AND ai.provider = 'local'
          AND ai.status = 'active'
        ORDER BY ai.is_primary DESC, ai.created_at ASC
        LIMIT 1
      ) ai ON true
      WHERE m.status = 'active'
        AND m.tenant_id = $1
        AND t.is_system = true
        AND t.organization_type = 'system'
        AND m.roles = ARRAY['member']::text[]
      ORDER BY m.created_at ASC
      FOR UPDATE OF m, t
      `,
      [systemTenantId],
    )

    const reports: RepairTargetReport[] = []
    for (const target of targets.rows) {
      const report = await repairOneTarget(client, target, options)
      reports.push(report)
    }

    return { candidates: reports, skipped: 0 }
  })
}

async function repairOneTarget(
  client: {
    query<T extends { [key: string]: unknown } = { [key: string]: unknown }>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[]; rowCount?: number | null }>
  },
  target: RepairTarget,
  options: RepairOptions,
): Promise<RepairTargetReport> {
  const newTenantId = personalTenantId(target.userId)
  const newTenantName = personalOrganizationName(target.displayName, target.email)

  if (!options.dryRun) {
    await upsertPersonalTenant(client, {
      tenantId: newTenantId,
      tenantName: newTenantName,
      createdByUserId: target.userId,
    })
  }

  const projectIds = await fetchProjectIds(client, target.userId, target.oldTenantId)

  let otherMembershipsDisabled = 0
  let otherMembershipSessionsRevoked = 0
  let sessionsRevoked = 0
  let projectsMoved = 0
  let projectVersionsMoved = 0
  let assetsMoved = 0
  let shotsMoved = 0
  let generationTasksMoved = 0
  let mediaObjectsMoved = 0
  let aiJobsMoved = 0
  let billingLedgerEntriesMoved = 0
  let usageEventsMoved = 0
  let usageMinuteRollupsMoved = 0

  if (!options.dryRun) {
    await client.query(
      `
      UPDATE tenant_memberships
      SET is_primary = false,
          updated_at = now()
      WHERE user_id = $1
      `,
      [target.userId],
    )

    const updatedMembership = await client.query(
      `
      UPDATE tenant_memberships
      SET tenant_id = $2,
          roles = ARRAY['member']::text[],
          is_primary = true,
          status = 'active',
          updated_at = now()
      WHERE id = $1
      `,
      [target.membershipId, newTenantId],
    )
    if ((updatedMembership.rowCount ?? 0) === 0) {
      throw new Error(`Could not update membership ${target.membershipId} for ${target.email}`)
    }

    const disabledMemberships = await client.query<{ id: string }>(
      `
      SELECT m.id
      FROM tenant_memberships m
      JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = $1
        AND m.id <> $2
        AND m.status = 'active'
        AND t.organization_type <> 'personal'
      FOR UPDATE OF m, t
      `,
      [target.userId, target.membershipId],
    )

    for (const membership of disabledMemberships.rows) {
      otherMembershipsDisabled += 1
      await client.query(
        `
        UPDATE tenant_memberships
        SET status = 'disabled',
            updated_at = now()
        WHERE id = $1
        `,
        [membership.id],
      )
      const revoked = await client.query(
        `
        UPDATE sessions
        SET revoked_at = now()
        WHERE membership_id = $1
          AND revoked_at IS NULL
        `,
        [membership.id],
      )
      otherMembershipSessionsRevoked += revoked.rowCount ?? 0
    }

    const movedProjects = await client.query<{ id: string }>(
      `
      UPDATE projects
      SET tenant_id = $2,
          updated_at = now()
      WHERE tenant_id = $3
        AND owner_user_id = $1
      RETURNING id
      `,
      [target.userId, newTenantId, target.oldTenantId],
    )
    projectsMoved = movedProjects.rowCount ?? 0

    if (projectIds.length) {
      const projectVersionUpdate = await client.query(
        `
        UPDATE project_versions
        SET tenant_id = $2
        WHERE project_id = ANY($1::text[])
        `,
        [projectIds, newTenantId],
      )
      projectVersionsMoved = projectVersionUpdate.rowCount ?? 0

      const assetsUpdate = await client.query(
        `
        UPDATE assets
        SET tenant_id = $2,
            updated_at = now()
        WHERE project_id = ANY($1::text[])
        `,
        [projectIds, newTenantId],
      )
      assetsMoved = assetsUpdate.rowCount ?? 0

      const shotsUpdate = await client.query(
        `
        UPDATE shots
        SET tenant_id = $2,
            updated_at = now()
        WHERE project_id = ANY($1::text[])
        `,
        [projectIds, newTenantId],
      )
      shotsMoved = shotsUpdate.rowCount ?? 0
    }

    const generationTasksUpdate = await client.query(
      `
      UPDATE generation_tasks
      SET tenant_id = $2,
          updated_at = now()
      WHERE user_id = $1
         OR project_id = ANY($3::text[])
      `,
      [target.userId, newTenantId, projectIds],
    )
    generationTasksMoved = generationTasksUpdate.rowCount ?? 0

    const mediaObjectsUpdate = await client.query(
      `
      UPDATE media_objects
      SET tenant_id = $2,
          updated_at = now()
      WHERE created_by_user_id = $1
         OR project_id = ANY($3::text[])
      `,
      [target.userId, newTenantId, projectIds],
    )
    mediaObjectsMoved = mediaObjectsUpdate.rowCount ?? 0

    const aiJobsUpdate = await client.query(
      `
      UPDATE ai_jobs
      SET tenant_id = $2,
          updated_at = now()
      WHERE user_id = $1
         OR project_id = ANY($3::text[])
      `,
      [target.userId, newTenantId, projectIds],
    )
    aiJobsMoved = aiJobsUpdate.rowCount ?? 0

    const ledgerUpdate = await client.query(
      `
      UPDATE billing_ledger_entries
      SET tenant_id = $2,
          updated_at = now()
      WHERE membership_id = $1
      `,
      [target.membershipId, newTenantId],
    )
    billingLedgerEntriesMoved = ledgerUpdate.rowCount ?? 0

    const usageEventsUpdate = await client.query(
      `
      UPDATE usage_events
      SET tenant_id = $2,
          organization_id = $2
      WHERE user_id = $1
         OR membership_id = $3
      `,
      [target.userId, newTenantId, target.membershipId],
    )
    usageEventsMoved = usageEventsUpdate.rowCount ?? 0

    const usageRollupsUpdate = await client.query(
      `
      UPDATE usage_minute_rollups
      SET tenant_id = $2,
          organization_id = $2,
          tenant_key = $2,
          organization_key = $2,
          updated_at = now()
      WHERE user_id = $1
      `,
      [target.userId, newTenantId],
    )
    usageMinuteRollupsMoved = usageRollupsUpdate.rowCount ?? 0

    const revokedTargetSessions = await client.query(
      `
      UPDATE sessions
      SET revoked_at = now()
      WHERE membership_id = $1
        AND revoked_at IS NULL
      `,
      [target.membershipId],
    )
    sessionsRevoked = revokedTargetSessions.rowCount ?? 0
  }

  return {
    email: target.email,
    userId: target.userId,
    sourceMembershipId: target.membershipId,
    oldTenantId: target.oldTenantId,
    newTenantId,
    newTenantName,
    otherMembershipsDisabled,
    otherMembershipSessionsRevoked,
    sessionsRevoked,
    projectsMoved,
    projectVersionsMoved,
    assetsMoved,
    shotsMoved,
    generationTasksMoved,
    mediaObjectsMoved,
    aiJobsMoved,
    billingLedgerEntriesMoved,
    usageEventsMoved,
    usageMinuteRollupsMoved,
  }
}

async function upsertPersonalTenant(
  client: {
    query<T extends { [key: string]: unknown } = { [key: string]: unknown }>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[]; rowCount?: number | null }>
  },
  input: {
    tenantId: string
    tenantName: string
    createdByUserId: string
  },
): Promise<void> {
  await client.query(
    `
    INSERT INTO tenants (
      id,
      name,
      status,
      is_system,
      organization_type,
      created_by_user_id,
      created_at,
      updated_at
    )
    VALUES ($1, $2, 'active', false, 'personal', $3, now(), now())
    ON CONFLICT (id)
    DO UPDATE SET
      name = EXCLUDED.name,
      status = 'active',
      is_system = false,
      organization_type = 'personal',
      created_by_user_id = EXCLUDED.created_by_user_id,
      updated_at = now()
    `,
    [input.tenantId, input.tenantName, input.createdByUserId],
  )
}

async function fetchProjectIds(
  client: {
    query<T extends { [key: string]: unknown } = { [key: string]: unknown }>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[]; rowCount?: number | null }>
  },
  userId: string,
  tenantId: string,
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `
    SELECT id
    FROM projects
    WHERE tenant_id = $1
      AND owner_user_id = $2
    ORDER BY created_at ASC
    `,
    [tenantId, userId],
  )
  return result.rows.map((row) => row.id)
}

function personalTenantId(userId: string): string {
  return `tenant-personal-${userId}`
}

function personalOrganizationName(displayName: string, email: string): string {
  const base = sanitizeName(displayName) || sanitizeName(email.split('@')[0] ?? '') || '用户'
  return `${base} 的个人空间`
}

function sanitizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function formatReport(report: RepairReport, dryRun: boolean): string {
  const lines = [
    dryRun
      ? '[db:repair-personal-organizations] dry run complete'
      : '[db:repair-personal-organizations] repair complete',
    `  candidates: ${report.candidates.length}`,
  ]
  for (const item of report.candidates) {
    lines.push(
      `  - ${item.email} -> ${item.newTenantId}`,
      `    membership: ${item.sourceMembershipId}`,
      `    sessions revoked: ${item.sessionsRevoked}`,
      `    other memberships disabled: ${item.otherMembershipsDisabled}, sessions revoked there: ${item.otherMembershipSessionsRevoked}`,
      `    projects: ${item.projectsMoved}, versions: ${item.projectVersionsMoved}, assets: ${item.assetsMoved}, shots: ${item.shotsMoved}`,
      `    generation tasks: ${item.generationTasksMoved}, media objects: ${item.mediaObjectsMoved}, ai jobs: ${item.aiJobsMoved}`,
      `    billing ledger entries: ${item.billingLedgerEntriesMoved}`,
      `    usage events: ${item.usageEventsMoved}, usage rollups: ${item.usageMinuteRollupsMoved}`,
    )
  }
  if (!report.candidates.length) {
    lines.push('  no active system-tenant member accounts were found')
  }
  return `${lines.join('\n')}\n`
}
