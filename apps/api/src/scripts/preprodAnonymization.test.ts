import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type AppConfig } from '../config.js'
import { AccountDatabase } from '../infra/postgres.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../testing/postgresAuth.js'
import {
  bootstrapIdentityId,
  bootstrapMembershipId,
  createBootstrapAccounts,
  systemTenantId,
} from './bootstrapAccounts.js'
import { anonymizePreprodDatabase } from './preprodAnonymization.js'

let postgres: PostgresAuthFixture | undefined

beforeAll(async () => {
  postgres = await startPostgresAuthFixture()
}, 120_000)

beforeEach(async () => {
  await postgres?.reset()
})

afterAll(async () => {
  await postgres?.close()
})

describe('preprod anonymization', { timeout: 45_000 }, () => {
  it('supports dry-run checks and redacts creative data without deleting protected accounts', async () => {
    await withDatabase(async (database) => {
      const config = localConfig()
      await seedSensitivePreprodSnapshot(database, config)
      const beforeDryRun = await sensitiveSnapshot(database)

      const dryRun = await anonymizePreprodDatabase(database, config, { dryRun: true })
      expect(dryRun.dryRun).toBe(true)
      expect(impactRows(dryRun.impacts, 'projects', 'update')).toBe(1)
      expect(impactRows(dryRun.impacts, 'sessions', 'delete')).toBe(1)
      expect(dryRun.protectedEntities).toMatchObject({
        systemOrganizations: 1,
        bootstrapUsers: 4,
        bootstrapIdentities: 4,
        bootstrapMemberships: 4,
        activeOwnerUsers: 1,
      })
      await expect(sensitiveSnapshot(database)).resolves.toEqual(beforeDryRun)

      const applied = await anonymizePreprodDatabase(database, config)
      expect(applied.dryRun).toBe(false)
      expect(applied.protectedEntities).toMatchObject({
        systemOrganizations: 1,
        bootstrapUsers: 4,
        bootstrapIdentities: 4,
        bootstrapMemberships: 4,
        activeOwnerUsers: 1,
      })
      expect(applied.protectedEntities.activeSuperAdminUsers).toBeGreaterThanOrEqual(1)
      expect(applied.protectedEntities.activeSuperAdminUsers).toBeLessThanOrEqual(5)

      const after = await sensitiveSnapshot(database)
      expect(after).toMatchObject({
        sessionCount: 0,
        projectName: expect.stringMatching(/^Project [a-f0-9]{8}$/),
        projectSynopsis: 'Redacted preprod project synopsis',
        projectScript: '',
        assetName: expect.stringMatching(/^Asset [a-f0-9]{8}$/),
        assetDescription: 'Redacted preprod asset',
        assetPrompt: '',
        assetImageUrl: null,
        assetAttributes: { type: 'character', redacted: true },
        shotTitle: 'Shot 1',
        shotPrompt: '',
        taskLabel: 'Redacted video task',
        taskPrompt: '',
        taskMetadata: { redacted: true },
        taskOutputs: [],
        mediaName: expect.stringMatching(/^Media [a-f0-9]{8}$/),
        mediaMetadata: { redacted: true },
        aiJobLabel: 'Redacted text job',
        aiJobInput: { redacted: true },
        aiJobOutput: { redacted: true },
        outboxLastError: 'Redacted preprod outbox error',
        novelDocumentName: expect.stringMatching(/^Novel Document [a-f0-9]{8}$/),
        novelChapterTitle: 'Chapter 1',
        novelChapterPreview: '',
        novelBoundaryTail: '',
        novelSummaryText: 'Redacted preprod chapter summary',
        novelQueueItemTitle: 'Chapter 1 Queue Item',
        novelStoryBibleTitle: expect.stringMatching(/^Redacted Story Bible [a-f0-9]{8}$/),
        novelStoryBibleSynopsis: '',
      })
    })
  })
})

function localConfig(): AppConfig {
  if (!postgres) throw new Error('Postgres fixture is not ready')
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: postgres.connectionString,
    DATA_FILE: ':memory:',
    AUTH_SECRET: 'test-secret-with-at-least-32-characters',
  })
}

async function seedSensitivePreprodSnapshot(database: AccountDatabase, config: AppConfig): Promise<void> {
  const accounts = createBootstrapAccounts(config)
  await database.transaction(async (client) => {
    await client.query(
      `
      INSERT INTO tenants (id, name, status, is_system, created_at, updated_at)
      VALUES ($1, 'Seqora Internal System', 'active', true, now(), now())
      `,
      [systemTenantId],
    )
    await client.query(
      `
      INSERT INTO tenants (id, name, status, is_system, created_at, updated_at)
      VALUES ('tenant-sensitive', 'Sensitive Customer Organization', 'active', false, now(), now())
      `,
    )

    for (const account of accounts) {
      await client.query(
        `
        INSERT INTO users (id, display_name, status, created_at, updated_at)
        VALUES ($1, $2, 'active', now(), now())
        `,
        [account.id, account.name],
      )
      await client.query(
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
        VALUES ($1, $2, 'local', $3, $3, 'existing-hash', true, 'active', now(), 'verified', now(), now())
        `,
        [bootstrapIdentityId(account.id), account.id, account.email.toLowerCase()],
      )
      await client.query(
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
        `,
        [bootstrapMembershipId(account.id), systemTenantId, account.id, account.roles],
      )
      await client.query(
        `
        INSERT INTO billing_accounts (membership_id, plan, credits, created_at, updated_at)
        VALUES ($1, $2, $3, now(), now())
        `,
        [bootstrapMembershipId(account.id), account.plan, account.credits],
      )
    }

    await client.query(
      `
      INSERT INTO users (id, display_name, status, created_at, updated_at)
      VALUES ('user-sensitive', 'Real Producer Name', 'active', now(), now())
      `,
    )
    await client.query(
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
      VALUES (
        'identity-sensitive',
        'user-sensitive',
        'local',
        'producer@example.com',
        'producer@example.com',
        'sensitive-password-hash',
        true,
        'active',
        now(),
        'verified',
        now(),
        now()
      )
      `,
    )
    await client.query(
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
      VALUES (
        'membership-sensitive',
        'tenant-sensitive',
        'user-sensitive',
        ARRAY['organization_member']::text[],
        true,
        'active',
        now(),
        now()
      )
      `,
    )
    await client.query(
      `
      INSERT INTO billing_accounts (membership_id, plan, credits, created_at, updated_at)
      VALUES ('membership-sensitive', 'member', 200, now(), now())
      `,
    )
    await client.query(
      `
      INSERT INTO sessions (
        id,
        membership_id,
        token_secret_hash,
        expires_at,
        created_at,
        last_seen_at,
        ip_address,
        user_agent,
        device_label
      )
      VALUES (
        'session-sensitive',
        'membership-sensitive',
        'sensitive-token-hash',
        now() + interval '1 day',
        now(),
        now(),
        '203.0.113.10',
        'Sensitive Browser',
        'Producer laptop'
      )
      `,
    )
    await client.query(
      `
      INSERT INTO projects (
        id,
        tenant_id,
        owner_user_id,
        name,
        content_type,
        aspect_ratio,
        status,
        synopsis,
        script,
        version,
        created_at,
        updated_at
      )
      VALUES (
        'project-sensitive',
        'tenant-sensitive',
        'user-sensitive',
        'Confidential Brand Launch',
        'short-drama',
        '9:16',
        'draft',
        'Confidential synopsis',
        'Sensitive script content',
        1,
        now(),
        now()
      )
      `,
    )
    await client.query(
      `
      INSERT INTO assets (
        id,
        project_id,
        tenant_id,
        kind,
        source_mode,
        name,
        description,
        prompt,
        prompt_mode,
        custom_prompt_mode,
        custom_prompt,
        negative_prompt,
        reference_items,
        attributes,
        image_url,
        status,
        created_at,
        updated_at
      )
      VALUES (
        'asset-sensitive',
        'project-sensitive',
        'tenant-sensitive',
        'character',
        'generate',
        'Confidential Character',
        'Sensitive character notes',
        'Sensitive character prompt',
        'standard',
        'append',
        'Sensitive custom prompt',
        'Sensitive negative prompt',
        '[{"name":"Reference Person","url":"https://example.com/private.png"}]'::jsonb,
        '{"type":"character","name":"Private Person"}'::jsonb,
        'https://assets.example/private.png',
        'draft',
        now(),
        now()
      )
      `,
    )
    await client.query(
      `
      INSERT INTO shots (
        id,
        project_id,
        tenant_id,
        shot_order,
        title,
        framing,
        duration_seconds,
        prompt,
        negative_prompt,
        image_url,
        continuity_mode,
        continuity_note,
        created_at,
        updated_at
      )
      VALUES (
        'shot-sensitive',
        'project-sensitive',
        'tenant-sensitive',
        1,
        'Confidential Opening Shot',
        'Sensitive framing',
        5,
        'Sensitive shot prompt',
        'Sensitive shot negative prompt',
        'https://assets.example/private-shot.png',
        'independent',
        'Sensitive continuity',
        now(),
        now()
      )
      `,
    )
    await client.query(
      `
      INSERT INTO project_versions (
        id,
        project_id,
        tenant_id,
        version,
        name,
        synopsis,
        script,
        project_snapshot,
        assets_snapshot,
        shots_snapshot,
        created_by_user_id,
        created_at
      )
      VALUES (
        'project-version-sensitive',
        'project-sensitive',
        'tenant-sensitive',
        1,
        'Sensitive Version',
        'Sensitive version synopsis',
        'Sensitive version script',
        '{"private":"project"}'::jsonb,
        '[{"private":"asset"}]'::jsonb,
        '[{"private":"shot"}]'::jsonb,
        'user-sensitive',
        now()
      )
      `,
    )
    await client.query(
      `
      INSERT INTO generation_tasks (
        id,
        client_request_id,
        project_id,
        tenant_id,
        user_id,
        membership_id,
        kind,
        label,
        prompt,
        negative_prompt,
        provider,
        model,
        tier,
        metadata,
        status,
        progress,
        estimated_credits,
        attempts,
        max_attempts,
        result_url,
        outputs,
        error,
        created_at,
        updated_at
      )
      VALUES (
        'generation-task-sensitive',
        'request-sensitive-task',
        'project-sensitive',
        'tenant-sensitive',
        'user-sensitive',
        'membership-sensitive',
        'video',
        'Sensitive video task',
        'Sensitive task prompt',
        'Sensitive task negative prompt',
        'provider',
        'model',
        'fast',
        '{"prompt":"sensitive metadata"}'::jsonb,
        'failed',
        50,
        12,
        1,
        3,
        'https://assets.example/task.mp4',
        '[{"url":"https://assets.example/output.mp4"}]'::jsonb,
        'Sensitive task error',
        now(),
        now()
      )
      `,
    )
    await client.query(
      `
      INSERT INTO media_objects (
        id,
        project_id,
        tenant_id,
        created_by_user_id,
        generation_task_id,
        asset_id,
        shot_id,
        media_type,
        purpose,
        name,
        content_type,
        size_bytes,
        storage_driver,
        storage_key,
        bucket,
        checksum_sha256,
        width,
        height,
        duration_seconds,
        metadata,
        status,
        created_at,
        updated_at
      )
      VALUES (
        'media-sensitive',
        'project-sensitive',
        'tenant-sensitive',
        'user-sensitive',
        'generation-task-sensitive',
        'asset-sensitive',
        'shot-sensitive',
        'image',
        'upload',
        'Private Production Still',
        'image/png',
        100,
        'local',
        'uploads/private.png',
        NULL,
        'sensitive-checksum',
        1024,
        768,
        NULL,
        '{"caption":"sensitive media metadata"}'::jsonb,
        'active',
        now(),
        now()
      )
      `,
    )
    await client.query(
      `
      INSERT INTO ai_jobs (
        id,
        client_request_id,
        project_id,
        tenant_id,
        user_id,
        membership_id,
        kind,
        label,
        provider,
        input,
        output,
        status,
        cost_credits,
        attempts,
        max_attempts,
        error,
        created_at,
        updated_at
      )
      VALUES (
        'ai-job-sensitive',
        'request-sensitive-ai-job',
        'project-sensitive',
        'tenant-sensitive',
        'user-sensitive',
        'membership-sensitive',
        'text',
        'Sensitive AI job',
        'text',
        '{"prompt":"sensitive AI input"}'::jsonb,
        '{"result":"sensitive AI output"}'::jsonb,
        'failed',
        2,
        1,
        3,
        'Sensitive AI error',
        now(),
        now()
      )
      `,
    )
    await client.query(
      `
      INSERT INTO outbox_events (
        id,
        tenant_id,
        event_type,
        aggregate_type,
        aggregate_id,
        dedupe_key,
        payload,
        status,
        attempts,
        max_attempts,
        next_attempt_at,
        last_error,
        created_at,
        updated_at
      )
      VALUES (
        'outbox-sensitive',
        'tenant-sensitive',
        'ai_job.dispatch',
        'ai_job',
        'ai-job-sensitive',
        'ai-job-sensitive:1',
        '{"jobId":"ai-job-sensitive"}'::jsonb,
        'failed',
        1,
        3,
        now(),
        'Sensitive outbox error',
        now(),
        now()
      )
      `,
    )
    await client.query(
      `
      INSERT INTO novel_documents (
        id,
        project_id,
        tenant_id,
        name,
        format,
        character_count,
        chapter_count,
        content_storage_key,
        content_sha256,
        client_request_id,
        created_at,
        updated_at
      )
      VALUES (
        'novel-document-sensitive',
        'project-sensitive',
        'tenant-sensitive',
        'Sensitive Novel',
        'txt',
        200,
        2,
        'novels/private.txt',
        'sensitive-sha',
        'request-sensitive-novel',
        now(),
        now()
      )
      `,
    )
    await client.query(
      `
      INSERT INTO novel_chapters (
        id,
        document_id,
        project_id,
        tenant_id,
        chapter_order,
        title,
        start_offset,
        end_offset,
        source_start_offset,
        source_end_offset,
        source_chapter_title,
        split_mode,
        character_count,
        preview,
        preview_truncated,
        created_at
      )
      VALUES
        (
          'novel-chapter-sensitive-1',
          'novel-document-sensitive',
          'project-sensitive',
          'tenant-sensitive',
          1,
          'Sensitive Chapter One',
          0,
          100,
          0,
          100,
          'Original Chapter One',
          'auto',
          100,
          'Sensitive chapter preview',
          false,
          now()
        ),
        (
          'novel-chapter-sensitive-2',
          'novel-document-sensitive',
          'project-sensitive',
          'tenant-sensitive',
          2,
          'Sensitive Chapter Two',
          101,
          200,
          101,
          200,
          'Original Chapter Two',
          'auto',
          99,
          'Sensitive second preview',
          false,
          now()
        )
      `,
    )
    await client.query(
      `
      INSERT INTO novel_boundaries (
        id,
        document_id,
        project_id,
        tenant_id,
        previous_chapter_id,
        next_chapter_id,
        previous_order,
        next_order,
        status,
        severity,
        issues,
        previous_tail,
        next_head,
        note,
        created_at,
        updated_at
      )
      VALUES (
        'novel-boundary-sensitive',
        'novel-document-sensitive',
        'project-sensitive',
        'tenant-sensitive',
        'novel-chapter-sensitive-1',
        'novel-chapter-sensitive-2',
        1,
        2,
        'pending',
        'medium',
        '[{"issue":"sensitive"}]'::jsonb,
        'Sensitive previous tail',
        'Sensitive next head',
        'Sensitive note',
        now(),
        now()
      )
      `,
    )
    await client.query(
      `
      INSERT INTO novel_chapter_summaries (
        id,
        document_id,
        chapter_id,
        project_id,
        tenant_id,
        chapter_order,
        title,
        summary,
        key_events,
        characters,
        locations,
        timeline,
        key_props,
        foreshadowing,
        world_rules,
        adaptation_notes,
        created_at,
        updated_at
      )
      VALUES (
        'novel-summary-sensitive',
        'novel-document-sensitive',
        'novel-chapter-sensitive-1',
        'project-sensitive',
        'tenant-sensitive',
        1,
        'Sensitive Summary Title',
        'Sensitive summary',
        '[{"event":"private"}]'::jsonb,
        '[{"name":"private"}]'::jsonb,
        '[{"location":"private"}]'::jsonb,
        '[{"time":"private"}]'::jsonb,
        '[{"prop":"private"}]'::jsonb,
        '[{"hint":"private"}]'::jsonb,
        '[{"rule":"private"}]'::jsonb,
        'Sensitive adaptation notes',
        now(),
        now()
      )
      `,
    )
    await client.query(
      `
      INSERT INTO novel_summary_queues (
        id,
        document_id,
        project_id,
        tenant_id,
        status,
        batch_size,
        force,
        total_items,
        pending_count,
        running_count,
        completed_count,
        failed_count,
        skipped_count,
        client_request_id,
        created_at,
        updated_at
      )
      VALUES (
        'novel-queue-sensitive',
        'novel-document-sensitive',
        'project-sensitive',
        'tenant-sensitive',
        'completed',
        2,
        false,
        1,
        0,
        0,
        1,
        0,
        0,
        'request-sensitive-queue',
        now(),
        now()
      )
      `,
    )
    await client.query(
      `
      INSERT INTO novel_summary_queue_items (
        id,
        queue_id,
        document_id,
        chapter_id,
        project_id,
        tenant_id,
        chapter_order,
        title,
        status,
        attempts,
        max_attempts,
        character_count,
        source_start_offset,
        source_end_offset,
        source_chapter_title,
        crosses_chapter_boundary,
        summary_id,
        result,
        error_message,
        locked_at,
        created_at,
        updated_at
      )
      VALUES (
        'novel-queue-item-sensitive',
        'novel-queue-sensitive',
        'novel-document-sensitive',
        'novel-chapter-sensitive-1',
        'project-sensitive',
        'tenant-sensitive',
        1,
        'Sensitive Queue Item',
        'completed',
        1,
        3,
        100,
        0,
        100,
        'Original Chapter One',
        false,
        'novel-summary-sensitive',
        '{"summary":"sensitive queued result"}'::jsonb,
        'Sensitive queue item error',
        now(),
        now(),
        now()
      )
      `,
    )
    await client.query(
      `
      INSERT INTO novel_story_bibles (
        id,
        document_id,
        project_id,
        tenant_id,
        title,
        logline,
        premise,
        synopsis,
        themes,
        characters,
        locations,
        timeline,
        key_props,
        foreshadowing,
        world_rules,
        adaptation_strategy,
        risks,
        next_step,
        source_summary_count,
        chapter_count,
        created_at,
        updated_at
      )
      VALUES (
        'novel-story-bible-sensitive',
        'novel-document-sensitive',
        'project-sensitive',
        'tenant-sensitive',
        'Sensitive Story Bible',
        'Sensitive logline',
        'Sensitive premise',
        'Sensitive story synopsis',
        '[{"theme":"private"}]'::jsonb,
        '[{"character":"private"}]'::jsonb,
        '[{"location":"private"}]'::jsonb,
        '[{"timeline":"private"}]'::jsonb,
        '[{"prop":"private"}]'::jsonb,
        '[{"hint":"private"}]'::jsonb,
        '[{"rule":"private"}]'::jsonb,
        'Sensitive adaptation strategy',
        '[{"risk":"private"}]'::jsonb,
        'Sensitive next step',
        1,
        2,
        now(),
        now()
      )
      `,
    )
  })
}

async function sensitiveSnapshot(database: AccountDatabase): Promise<Record<string, unknown>> {
  const result = await database.query<Record<string, unknown>>(
    `
    SELECT
      (SELECT count(*)::int FROM sessions) AS "sessionCount",
      (SELECT name FROM projects WHERE id = 'project-sensitive') AS "projectName",
      (SELECT synopsis FROM projects WHERE id = 'project-sensitive') AS "projectSynopsis",
      (SELECT script FROM projects WHERE id = 'project-sensitive') AS "projectScript",
      (SELECT name FROM assets WHERE id = 'asset-sensitive') AS "assetName",
      (SELECT description FROM assets WHERE id = 'asset-sensitive') AS "assetDescription",
      (SELECT prompt FROM assets WHERE id = 'asset-sensitive') AS "assetPrompt",
      (SELECT image_url FROM assets WHERE id = 'asset-sensitive') AS "assetImageUrl",
      (SELECT attributes FROM assets WHERE id = 'asset-sensitive') AS "assetAttributes",
      (SELECT title FROM shots WHERE id = 'shot-sensitive') AS "shotTitle",
      (SELECT prompt FROM shots WHERE id = 'shot-sensitive') AS "shotPrompt",
      (SELECT label FROM generation_tasks WHERE id = 'generation-task-sensitive') AS "taskLabel",
      (SELECT prompt FROM generation_tasks WHERE id = 'generation-task-sensitive') AS "taskPrompt",
      (SELECT metadata FROM generation_tasks WHERE id = 'generation-task-sensitive') AS "taskMetadata",
      (SELECT outputs FROM generation_tasks WHERE id = 'generation-task-sensitive') AS "taskOutputs",
      (SELECT name FROM media_objects WHERE id = 'media-sensitive') AS "mediaName",
      (SELECT metadata FROM media_objects WHERE id = 'media-sensitive') AS "mediaMetadata",
      (SELECT label FROM ai_jobs WHERE id = 'ai-job-sensitive') AS "aiJobLabel",
      (SELECT input FROM ai_jobs WHERE id = 'ai-job-sensitive') AS "aiJobInput",
      (SELECT output FROM ai_jobs WHERE id = 'ai-job-sensitive') AS "aiJobOutput",
      (SELECT last_error FROM outbox_events WHERE id = 'outbox-sensitive') AS "outboxLastError",
      (SELECT name FROM novel_documents WHERE id = 'novel-document-sensitive') AS "novelDocumentName",
      (SELECT title FROM novel_chapters WHERE id = 'novel-chapter-sensitive-1') AS "novelChapterTitle",
      (SELECT preview FROM novel_chapters WHERE id = 'novel-chapter-sensitive-1') AS "novelChapterPreview",
      (SELECT previous_tail FROM novel_boundaries WHERE id = 'novel-boundary-sensitive') AS "novelBoundaryTail",
      (SELECT summary FROM novel_chapter_summaries WHERE id = 'novel-summary-sensitive') AS "novelSummaryText",
      (SELECT title FROM novel_summary_queue_items WHERE id = 'novel-queue-item-sensitive') AS "novelQueueItemTitle",
      (SELECT title FROM novel_story_bibles WHERE id = 'novel-story-bible-sensitive') AS "novelStoryBibleTitle",
      (SELECT synopsis FROM novel_story_bibles WHERE id = 'novel-story-bible-sensitive') AS "novelStoryBibleSynopsis"
    `,
  )
  return result.rows[0] ?? {}
}

function impactRows(
  impacts: Array<{ table: string; operation: string; rows: number }>,
  table: string,
  operation: string,
): number {
  return impacts.find((impact) => impact.table === table && impact.operation === operation)?.rows ?? 0
}

async function withDatabase(operation: (database: AccountDatabase) => Promise<void>): Promise<void> {
  if (!postgres) throw new Error('Postgres fixture is not ready')
  const database = new AccountDatabase(postgres.connectionString)
  try {
    await operation(database)
  } finally {
    await database.close()
  }
}
