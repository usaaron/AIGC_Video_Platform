import type { AppConfig } from '../config.js'
import { hashPassword } from '../core/auth/password.js'
import type { AccountDatabase } from '../infra/postgres.js'
import {
  bootstrapIdentityId,
  bootstrapMembershipId,
  createBootstrapAccounts,
  systemTenantId,
  type BootstrapAccount,
} from './bootstrapAccounts.js'

type Queryable = {
  query(text: string, params?: unknown[]): Promise<{ rowCount: number | null; rows: unknown[] }>
}

export type PreprodAnonymizationImpact = {
  table: string
  operation: 'delete' | 'update' | 'upsert'
  rows: number
}

export type PreprodProtectedEntities = {
  expectedBootstrapAccounts: number
  systemOrganizations: number
  bootstrapUsers: number
  bootstrapIdentities: number
  bootstrapMemberships: number
  activeOwnerUsers: number
  activeSuperAdminUsers: number
}

export type PreprodAnonymizationReport = {
  dryRun: boolean
  impacts: PreprodAnonymizationImpact[]
  protectedEntities: PreprodProtectedEntities
}

export async function anonymizePreprodDatabase(
  database: AccountDatabase,
  config: AppConfig,
  options: { dryRun?: boolean } = {},
): Promise<PreprodAnonymizationReport> {
  const bootstrapAccounts = createBootstrapAccounts(config)
  const impacts: PreprodAnonymizationImpact[] = []

  return await database.transaction(async (client) => {
    if (options.dryRun) {
      await collectDryRunImpacts(client, bootstrapAccounts, impacts)
      return {
        dryRun: true,
        impacts,
        protectedEntities: await collectProtectedEntities(client, bootstrapAccounts),
      }
    }

    await upsertSystemOrganization(client, impacts)
    await anonymizeAccountData(client, bootstrapAccounts, impacts)
    await anonymizeBillingData(client, impacts)
    await anonymizeProjectDomainData(client, impacts)
    await upsertBootstrapAccounts(client, bootstrapAccounts, impacts)

    const protectedEntities = await collectProtectedEntities(client, bootstrapAccounts)
    assertProtectedEntities(protectedEntities)
    return { dryRun: false, impacts, protectedEntities }
  })
}

export function formatPreprodAnonymizationReport(report: PreprodAnonymizationReport): string {
  const protectedLabel = report.dryRun ? 'protected state before changes' : 'protected state after changes'
  return [
    report.dryRun
      ? '[db:anonymize-preprod] dry run complete; no rows were changed'
      : '[db:anonymize-preprod] preprod data has been anonymized',
    `  ${protectedLabel}:`,
    `    system organizations: ${report.protectedEntities.systemOrganizations}`,
    `    bootstrap users: ${report.protectedEntities.bootstrapUsers}/${report.protectedEntities.expectedBootstrapAccounts}`,
    `    bootstrap identities: ${report.protectedEntities.bootstrapIdentities}/${report.protectedEntities.expectedBootstrapAccounts}`,
    `    bootstrap memberships: ${report.protectedEntities.bootstrapMemberships}/${report.protectedEntities.expectedBootstrapAccounts}`,
    `    active owners: ${report.protectedEntities.activeOwnerUsers}`,
    `    active super admins: ${report.protectedEntities.activeSuperAdminUsers}`,
    '  affected rows:',
    ...report.impacts.map((impact) => `    ${impact.operation} ${impact.table}: ${impact.rows}`),
  ].join('\n')
}

async function collectDryRunImpacts(
  client: Queryable,
  bootstrapAccounts: BootstrapAccount[],
  impacts: PreprodAnonymizationImpact[],
): Promise<void> {
  const bootstrapUserIds = bootstrapAccounts.map((account) => account.id)

  addImpact(impacts, 'tenants', 'upsert', 1)
  await addCountImpact(client, impacts, 'tenants', 'update', 'is_system = false')
  await addCountImpact(client, impacts, 'sessions', 'delete')
  await addCountImpact(client, impacts, 'password_reset_tokens', 'delete')
  await addCountImpact(client, impacts, 'email_verification_tokens', 'delete')
  await addCountImpact(client, impacts, 'tenant_invitations', 'delete')
  await addCountImpact(client, impacts, 'users', 'update')
  await addCountImpact(client, impacts, 'auth_identities', 'update', 'user_id <> ALL($1::text[])', [
    bootstrapUserIds,
  ])
  await addCountImpact(client, impacts, 'auth_identities', 'delete', 'user_id = ANY($1::text[])', [
    bootstrapUserIds,
  ])
  addImpact(impacts, 'users', 'upsert', bootstrapAccounts.length)
  addImpact(impacts, 'auth_identities', 'upsert', bootstrapAccounts.length)
  addImpact(impacts, 'tenant_memberships', 'upsert', bootstrapAccounts.length)
  addImpact(impacts, 'billing_accounts', 'upsert', bootstrapAccounts.length)

  for (const table of billingTables) {
    await addCountImpact(client, impacts, table, 'update')
  }

  for (const table of projectDomainTables) {
    await addCountImpact(client, impacts, table, 'update')
  }
}

async function upsertSystemOrganization(
  client: Queryable,
  impacts: PreprodAnonymizationImpact[],
): Promise<void> {
  await runMutation(
    client,
    impacts,
    'tenants',
    'upsert',
    `
    INSERT INTO tenants (id, name, status, is_system, organization_type, created_at, updated_at)
    VALUES ($1, 'Seqora Local', 'active', true, 'system', now(), now())
    ON CONFLICT (id) DO UPDATE
    SET is_system = true,
        organization_type = 'system',
        status = 'active',
        updated_at = now()
    `,
    [systemTenantId],
  )
  await runMutation(
    client,
    impacts,
    'tenants',
    'update',
    `
    UPDATE tenants
    SET name = CASE
          WHEN is_system THEN name
          ELSE 'Organization ' || substring(md5(id) from 1 for 8)
        END,
        updated_at = now()
    WHERE is_system = false
    `,
  )
}

async function anonymizeAccountData(
  client: Queryable,
  bootstrapAccounts: BootstrapAccount[],
  impacts: PreprodAnonymizationImpact[],
): Promise<void> {
  const bootstrapUserIds = bootstrapAccounts.map((account) => account.id)

  await runMutation(client, impacts, 'sessions', 'delete', 'DELETE FROM sessions')
  await runMutation(client, impacts, 'password_reset_tokens', 'delete', 'DELETE FROM password_reset_tokens')
  await runMutation(
    client,
    impacts,
    'email_verification_tokens',
    'delete',
    'DELETE FROM email_verification_tokens',
  )
  await runMutation(client, impacts, 'tenant_invitations', 'delete', 'DELETE FROM tenant_invitations')

  await runMutation(
    client,
    impacts,
    'audit_log_entries',
    'update',
    `
    UPDATE audit_log_entries
    SET ip_address = NULL,
        user_agent = NULL,
        metadata = jsonb_build_object('redacted', true)
    `,
  )

  await runMutation(
    client,
    impacts,
    'users',
    'update',
    `
    UPDATE users
    SET display_name = CASE
          WHEN id = ANY($1::text[]) THEN display_name
          ELSE 'User ' || substring(md5(id) from 1 for 8)
        END,
        password_reset_required = false,
        password_reset_required_at = NULL,
        password_reset_required_by_user_id = NULL,
        updated_at = now()
    `,
    [bootstrapUserIds],
  )

  await runMutation(
    client,
    impacts,
    'auth_identities',
    'update',
    `
    UPDATE auth_identities
    SET email = 'anon-' || substring(md5(id) from 1 for 12) || '@example.test',
        provider_subject = 'anon-' || substring(md5(id) from 1 for 12),
        password_hash = NULL,
        email_verified_at = COALESCE(email_verified_at, now()),
        email_verification_status = 'verified',
        last_used_at = NULL,
        updated_at = now()
    WHERE user_id <> ALL($1::text[])
    `,
    [bootstrapUserIds],
  )

  await runMutation(
    client,
    impacts,
    'auth_identities',
    'delete',
    'DELETE FROM auth_identities WHERE user_id = ANY($1::text[])',
    [bootstrapUserIds],
  )
}

async function anonymizeBillingData(client: Queryable, impacts: PreprodAnonymizationImpact[]): Promise<void> {
  await runMutation(
    client,
    impacts,
    'billing_ledger_entries',
    'update',
    `
    UPDATE billing_ledger_entries
    SET description = 'Redacted preprod ledger entry',
        metadata = jsonb_build_object('redacted', true),
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'billing_webhook_events',
    'update',
    `
    UPDATE billing_webhook_events
    SET payload = jsonb_build_object('redacted', true, 'provider', provider, 'eventType', event_type),
        metadata = jsonb_build_object('redacted', true),
        reference_id = NULL,
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'billing_payment_sessions',
    'update',
    `
    UPDATE billing_payment_sessions
    SET provider_customer_id = NULL,
        provider_subscription_id = NULL,
        provider_payment_intent_id = NULL,
        checkout_url = NULL,
        metadata = jsonb_build_object('redacted', true),
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'billing_payment_reconciliation_items',
    'update',
    `
    UPDATE billing_payment_reconciliation_items
    SET message = 'Redacted preprod reconciliation item',
        metadata = jsonb_build_object('redacted', true),
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'billing_reconciliation_alerts',
    'update',
    `
    UPDATE billing_reconciliation_alerts
    SET message = 'Redacted preprod reconciliation alert',
        metadata = jsonb_build_object('redacted', true),
        updated_at = now()
    `,
  )
}

async function anonymizeProjectDomainData(
  client: Queryable,
  impacts: PreprodAnonymizationImpact[],
): Promise<void> {
  await runMutation(
    client,
    impacts,
    'projects',
    'update',
    `
    UPDATE projects
    SET name = 'Project ' || substring(md5(id) from 1 for 8),
        synopsis = 'Redacted preprod project synopsis',
        script = '',
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'project_versions',
    'update',
    `
    UPDATE project_versions
    SET name = 'Project Version ' || version::text || ' ' || substring(md5(id) from 1 for 8),
        synopsis = 'Redacted preprod project version synopsis',
        script = '',
        project_snapshot = jsonb_build_object('redacted', true),
        assets_snapshot = '[]'::jsonb,
        shots_snapshot = '[]'::jsonb
    `,
  )
  await runMutation(
    client,
    impacts,
    'assets',
    'update',
    `
    UPDATE assets
    SET name = 'Asset ' || substring(md5(id) from 1 for 8),
        description = 'Redacted preprod asset',
        prompt = '',
        custom_prompt = '',
        negative_prompt = '',
        reference_items = '[]'::jsonb,
        attributes = jsonb_build_object('type', kind, 'redacted', true),
        image_url = NULL,
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'shots',
    'update',
    `
    UPDATE shots
    SET title = 'Shot ' || shot_order::text,
        framing = '',
        prompt = '',
        negative_prompt = '',
        image_url = NULL,
        continuity_note = '',
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'generation_tasks',
    'update',
    `
    UPDATE generation_tasks
    SET label = 'Redacted ' || kind || ' task',
        prompt = '',
        negative_prompt = '',
        metadata = jsonb_build_object('redacted', true),
        result_url = NULL,
        outputs = '[]'::jsonb,
        error = CASE WHEN error IS NULL THEN NULL ELSE 'Redacted preprod task error' END,
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'media_objects',
    'update',
    `
    UPDATE media_objects
    SET name = 'Media ' || substring(md5(id) from 1 for 8),
        checksum_sha256 = NULL,
        metadata = jsonb_build_object('redacted', true),
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'ai_jobs',
    'update',
    `
    UPDATE ai_jobs
    SET label = 'Redacted ' || kind || ' job',
        input = jsonb_build_object('redacted', true),
        output = CASE WHEN output IS NULL THEN NULL ELSE jsonb_build_object('redacted', true) END,
        error = CASE WHEN error IS NULL THEN NULL ELSE 'Redacted preprod AI job error' END,
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'outbox_events',
    'update',
    `
    UPDATE outbox_events
    SET last_error = CASE WHEN last_error IS NULL THEN NULL ELSE 'Redacted preprod outbox error' END,
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'novel_documents',
    'update',
    `
    UPDATE novel_documents
    SET name = 'Novel Document ' || substring(md5(id) from 1 for 8),
        client_request_id = NULL,
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'novel_chapters',
    'update',
    `
    UPDATE novel_chapters
    SET title = 'Chapter ' || chapter_order::text,
        source_chapter_title = NULL,
        preview = '',
        preview_truncated = false
    `,
  )
  await runMutation(
    client,
    impacts,
    'novel_boundaries',
    'update',
    `
    UPDATE novel_boundaries
    SET issues = '[]'::jsonb,
        previous_tail = '',
        next_head = '',
        note = NULL,
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'novel_chapter_summaries',
    'update',
    `
    UPDATE novel_chapter_summaries
    SET title = 'Chapter ' || chapter_order::text || ' Summary',
        summary = 'Redacted preprod chapter summary',
        key_events = '[]'::jsonb,
        characters = '[]'::jsonb,
        locations = '[]'::jsonb,
        timeline = '[]'::jsonb,
        key_props = '[]'::jsonb,
        foreshadowing = '[]'::jsonb,
        world_rules = '[]'::jsonb,
        adaptation_notes = '',
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'novel_summary_queues',
    'update',
    `
    UPDATE novel_summary_queues
    SET client_request_id = NULL,
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'novel_summary_queue_items',
    'update',
    `
    UPDATE novel_summary_queue_items
    SET title = 'Chapter ' || chapter_order::text || ' Queue Item',
        source_chapter_title = NULL,
        result = CASE WHEN result IS NULL THEN NULL ELSE jsonb_build_object('redacted', true) END,
        error_message = CASE WHEN error_message IS NULL THEN NULL ELSE 'Redacted preprod queue item error' END,
        updated_at = now()
    `,
  )
  await runMutation(
    client,
    impacts,
    'novel_story_bibles',
    'update',
    `
    UPDATE novel_story_bibles
    SET title = 'Redacted Story Bible ' || substring(md5(id) from 1 for 8),
        logline = '',
        premise = '',
        synopsis = '',
        themes = '[]'::jsonb,
        characters = '[]'::jsonb,
        locations = '[]'::jsonb,
        timeline = '[]'::jsonb,
        key_props = '[]'::jsonb,
        foreshadowing = '[]'::jsonb,
        world_rules = '[]'::jsonb,
        adaptation_strategy = '',
        risks = '[]'::jsonb,
        next_step = '',
        updated_at = now()
    `,
  )
}

async function upsertBootstrapAccounts(
  client: Queryable,
  bootstrapAccounts: BootstrapAccount[],
  impacts: PreprodAnonymizationImpact[],
): Promise<void> {
  for (const account of bootstrapAccounts) {
    const normalizedEmail = account.email.toLowerCase()
    const membershipId = bootstrapMembershipId(account.id)
    await runMutation(
      client,
      impacts,
      'users',
      'upsert',
      `
      INSERT INTO users (id, display_name, status, created_at, updated_at)
      VALUES ($1, $2, 'active', now(), now())
      ON CONFLICT (id) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          status = 'active',
          updated_at = now()
      `,
      [account.id, account.name],
    )
    await runMutation(
      client,
      impacts,
      'auth_identities',
      'upsert',
      `
      INSERT INTO auth_identities (
        id,
        user_id,
        provider,
        provider_subject,
        email,
        password_hash,
        is_primary,
        status,
        email_verified_at,
        email_verification_status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, 'local', $3, $3, $4, true, 'active', now(), 'verified', now(), now())
      ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          provider = EXCLUDED.provider,
          provider_subject = EXCLUDED.provider_subject,
          email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash,
          is_primary = true,
          status = 'active',
          email_verified_at = EXCLUDED.email_verified_at,
          email_verification_status = EXCLUDED.email_verification_status,
          updated_at = now()
      `,
      [bootstrapIdentityId(account.id), account.id, normalizedEmail, hashPassword(account.password)],
    )
    await client.query(
      `
      UPDATE tenant_memberships
      SET is_primary = false,
          updated_at = now()
      WHERE user_id = $1
      `,
      [account.id],
    )
    await runMutation(
      client,
      impacts,
      'tenant_memberships',
      'upsert',
      `
      INSERT INTO tenant_memberships (
        id,
        tenant_id,
        user_id,
        roles,
        is_primary,
        status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, true, 'active', now(), now())
      ON CONFLICT (id) DO UPDATE
      SET tenant_id = EXCLUDED.tenant_id,
          user_id = EXCLUDED.user_id,
          roles = EXCLUDED.roles,
          is_primary = true,
          status = 'active',
          updated_at = now()
      `,
      [membershipId, systemTenantId, account.id, account.roles],
    )
    await runMutation(
      client,
      impacts,
      'billing_accounts',
      'upsert',
      `
      INSERT INTO billing_accounts (membership_id, plan, credits, created_at, updated_at)
      VALUES ($1, $2, $3, now(), now())
      ON CONFLICT (membership_id) DO UPDATE
      SET plan = EXCLUDED.plan,
          credits = EXCLUDED.credits,
          updated_at = now()
      `,
      [membershipId, account.plan, account.credits],
    )
  }
}

async function collectProtectedEntities(
  client: Queryable,
  bootstrapAccounts: BootstrapAccount[],
): Promise<PreprodProtectedEntities> {
  const bootstrapUserIds = bootstrapAccounts.map((account) => account.id)
  const bootstrapIdentityIds = bootstrapAccounts.map((account) => bootstrapIdentityId(account.id))
  const bootstrapMembershipIds = bootstrapAccounts.map((account) => bootstrapMembershipId(account.id))
  const result = await client.query(
    `
    SELECT
      (SELECT count(*)::int FROM tenants WHERE id = $2 AND is_system = true AND status = 'active') AS system_organizations,
      (SELECT count(*)::int FROM users WHERE id = ANY($1::text[]) AND status = 'active') AS bootstrap_users,
      (
        SELECT count(*)::int
        FROM auth_identities
        WHERE id = ANY($3::text[])
          AND user_id = ANY($1::text[])
          AND provider = 'local'
          AND status = 'active'
      ) AS bootstrap_identities,
      (
        SELECT count(*)::int
        FROM tenant_memberships
        WHERE id = ANY($4::text[])
          AND tenant_id = $2
          AND user_id = ANY($1::text[])
          AND status = 'active'
      ) AS bootstrap_memberships,
      (
        SELECT count(DISTINCT m.user_id)::int
        FROM tenant_memberships m
        JOIN users u ON u.id = m.user_id
        WHERE u.status = 'active'
          AND m.status = 'active'
          AND m.roles @> ARRAY['owner']::text[]
      ) AS active_owner_users,
      (
        SELECT count(DISTINCT m.user_id)::int
        FROM tenant_memberships m
        JOIN users u ON u.id = m.user_id
        WHERE u.status = 'active'
          AND m.status = 'active'
          AND m.roles @> ARRAY['super_admin']::text[]
      ) AS active_super_admin_users
    `,
    [bootstrapUserIds, systemTenantId, bootstrapIdentityIds, bootstrapMembershipIds],
  )
  const row = result.rows[0] as Record<string, number> | undefined
  return {
    expectedBootstrapAccounts: bootstrapAccounts.length,
    systemOrganizations: Number(row?.system_organizations ?? 0),
    bootstrapUsers: Number(row?.bootstrap_users ?? 0),
    bootstrapIdentities: Number(row?.bootstrap_identities ?? 0),
    bootstrapMemberships: Number(row?.bootstrap_memberships ?? 0),
    activeOwnerUsers: Number(row?.active_owner_users ?? 0),
    activeSuperAdminUsers: Number(row?.active_super_admin_users ?? 0),
  }
}

function assertProtectedEntities(report: PreprodProtectedEntities): void {
  if (report.systemOrganizations !== 1) {
    throw new Error('Preprod anonymization guard failed: expected exactly one active system organization')
  }
  if (report.bootstrapUsers !== report.expectedBootstrapAccounts) {
    throw new Error('Preprod anonymization guard failed: bootstrap users were not preserved')
  }
  if (report.bootstrapIdentities !== report.expectedBootstrapAccounts) {
    throw new Error('Preprod anonymization guard failed: bootstrap identities were not preserved')
  }
  if (report.bootstrapMemberships !== report.expectedBootstrapAccounts) {
    throw new Error('Preprod anonymization guard failed: bootstrap memberships were not preserved')
  }
  if (report.activeOwnerUsers !== 1) {
    throw new Error('Preprod anonymization guard failed: expected exactly one active owner')
  }
  if (report.activeSuperAdminUsers < 1 || report.activeSuperAdminUsers > 5) {
    throw new Error('Preprod anonymization guard failed: active super admin count is outside 1..5')
  }
}

async function runMutation(
  client: Queryable,
  impacts: PreprodAnonymizationImpact[],
  table: string,
  operation: PreprodAnonymizationImpact['operation'],
  sql: string,
  params: unknown[] = [],
): Promise<void> {
  const result = await client.query(sql, params)
  addImpact(impacts, table, operation, result.rowCount ?? 0)
}

async function addCountImpact(
  client: Queryable,
  impacts: PreprodAnonymizationImpact[],
  table: string,
  operation: PreprodAnonymizationImpact['operation'],
  where = 'true',
  params: unknown[] = [],
): Promise<void> {
  const result = await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${where}`, params)
  const row = result.rows[0] as { count?: number } | undefined
  addImpact(impacts, table, operation, Number(row?.count ?? 0))
}

function addImpact(
  impacts: PreprodAnonymizationImpact[],
  table: string,
  operation: PreprodAnonymizationImpact['operation'],
  rows: number,
): void {
  const existing = impacts.find((impact) => impact.table === table && impact.operation === operation)
  if (existing) {
    existing.rows += rows
    return
  }
  impacts.push({ table, operation, rows })
}

const billingTables = [
  'billing_ledger_entries',
  'billing_webhook_events',
  'billing_payment_sessions',
  'billing_payment_reconciliation_items',
  'billing_reconciliation_alerts',
]

const projectDomainTables = [
  'projects',
  'project_versions',
  'assets',
  'shots',
  'generation_tasks',
  'media_objects',
  'ai_jobs',
  'outbox_events',
  'novel_documents',
  'novel_chapters',
  'novel_boundaries',
  'novel_chapter_summaries',
  'novel_summary_queues',
  'novel_summary_queue_items',
  'novel_story_bibles',
]
