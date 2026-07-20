import type { PoolClient } from 'pg'
import type { AppState } from './store.js'
import { normalizeState } from './store.js'

export async function replacePostgresState(client: PoolClient, input: AppState): Promise<void> {
  const state = normalizeState(input)
  await client.query(
    'truncate table ledger_entries, generation_tasks, media, shots, assets, projects, users, tenants',
  )

  const now = new Date().toISOString()
  await insertTenants(client, state, now)
  await insertUsers(client, state, now)
  await insertProjects(client, state)
  await insertAssets(client, state)
  await insertShots(client, state)
  await insertTasks(client, state)
  await insertLedger(client, state)
  await insertMedia(client, state)
}

async function insertTenants(client: PoolClient, state: AppState, now: string): Promise<void> {
  for (const tenantId of collectTenantIds(state)) {
    await client.query(
      `
        insert into tenants (id, name, created_at, updated_at)
        values ($1, $2, $3, $3)
      `,
      [tenantId, tenantId, now],
    )
  }
}

async function insertUsers(client: PoolClient, state: AppState, now: string): Promise<void> {
  for (const user of state.users) {
    await client.query(
      `
        insert into users (id, tenant_id, email, name, password_hash, roles, plan, credits, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      `,
      [
        user.id,
        user.tenantId,
        user.email.toLowerCase(),
        user.name,
        user.passwordHash,
        user.roles,
        user.plan,
        user.credits,
        now,
      ],
    )
  }
}

async function insertProjects(client: PoolClient, state: AppState): Promise<void> {
  for (const project of state.projects) {
    await client.query(
      `
        insert into projects (
          id, tenant_id, owner_id, name, content_type, aspect_ratio, status,
          synopsis, script, version, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        project.id,
        project.tenantId,
        project.ownerId,
        project.name,
        project.contentType,
        project.aspectRatio,
        project.status,
        project.synopsis,
        project.script,
        project.version,
        project.createdAt,
        project.updatedAt,
      ],
    )
  }
}

async function insertAssets(client: PoolClient, state: AppState): Promise<void> {
  for (const asset of state.assets) {
    await client.query(
      `
        insert into assets (
          id, project_id, tenant_id, kind, source_mode, name, description, prompt,
          prompt_mode, custom_prompt_mode, custom_prompt, negative_prompt,
          references, attributes, image_url, status, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15, $16, $17, $18)
      `,
      [
        asset.id,
        asset.projectId,
        asset.tenantId,
        asset.kind,
        asset.sourceMode,
        asset.name,
        asset.description,
        asset.prompt,
        asset.promptMode,
        asset.customPromptMode,
        asset.customPrompt,
        asset.negativePrompt,
        JSON.stringify(asset.references),
        JSON.stringify(asset.attributes),
        asset.imageUrl,
        asset.status,
        asset.createdAt,
        asset.updatedAt,
      ],
    )
  }
}

async function insertShots(client: PoolClient, state: AppState): Promise<void> {
  for (const shot of state.shots) {
    await client.query(
      `
        insert into shots (
          id, project_id, tenant_id, order_index, title, framing, duration,
          prompt, image_url, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        shot.id,
        shot.projectId,
        shot.tenantId,
        shot.order,
        shot.title,
        shot.framing,
        shot.duration,
        shot.prompt,
        shot.imageUrl,
        shot.createdAt,
        shot.updatedAt,
      ],
    )
  }
}

async function insertTasks(client: PoolClient, state: AppState): Promise<void> {
  for (const task of state.tasks) {
    await client.query(
      `
        insert into generation_tasks (
          id, client_request_id, project_id, tenant_id, user_id, kind, label,
          prompt, negative_prompt, provider, model, metadata, status, progress,
          estimated_credits, result_url, outputs, error, created_at, updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12::jsonb, $13, $14, $15, $16, $17::jsonb, $18, $19, $20
        )
      `,
      [
        task.id,
        task.clientRequestId,
        task.projectId,
        task.tenantId,
        task.userId,
        task.kind,
        task.label,
        task.prompt,
        task.negativePrompt,
        task.provider,
        task.model,
        JSON.stringify(task.metadata),
        task.status,
        task.progress,
        task.estimatedCredits,
        task.resultUrl,
        JSON.stringify(task.outputs),
        task.error,
        task.createdAt,
        task.updatedAt,
      ],
    )
  }
}

async function insertLedger(client: PoolClient, state: AppState): Promise<void> {
  for (const entry of state.ledger) {
    await client.query(
      `
        insert into ledger_entries (id, user_id, tenant_id, amount, balance, type, description, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        entry.id,
        entry.userId,
        entry.tenantId,
        entry.amount,
        entry.balance,
        entry.type,
        entry.description,
        entry.createdAt,
      ],
    )
  }
}

async function insertMedia(client: PoolClient, state: AppState): Promise<void> {
  for (const item of state.media) {
    await client.query(
      `
        insert into media (id, project_id, tenant_id, kind, name, content_type, size, storage_key, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        item.id,
        item.projectId,
        item.tenantId,
        item.kind,
        item.name,
        item.contentType,
        item.size,
        item.storageKey,
        item.createdAt,
      ],
    )
  }
}

function collectTenantIds(state: AppState): string[] {
  const tenantIds = new Set<string>()
  for (const user of state.users) tenantIds.add(user.tenantId)
  for (const project of state.projects) tenantIds.add(project.tenantId)
  for (const asset of state.assets) tenantIds.add(asset.tenantId)
  for (const shot of state.shots) tenantIds.add(shot.tenantId)
  for (const task of state.tasks) tenantIds.add(task.tenantId)
  for (const entry of state.ledger) tenantIds.add(entry.tenantId)
  for (const item of state.media) tenantIds.add(item.tenantId)
  return [...tenantIds].sort()
}
