import type { Asset, GenerationTask, LedgerEntry, Project, Shot } from '@seqora/contracts'
import type { PoolClient } from 'pg'
import type { AppState, StoredMedia, StoredUser } from './store.js'
import { normalizeState } from './store.js'

type TenantRow = {
  id: string
}

type Identified = {
  id: string
}

export async function syncPostgresState(
  client: PoolClient,
  previousInput: AppState,
  nextInput: AppState,
): Promise<void> {
  const previous = normalizeState(previousInput)
  const next = normalizeState(nextInput)

  await deleteMissing(client, 'ledger_entries', missingIds(previous.ledger, next.ledger))
  await deleteMissing(client, 'generation_tasks', missingIds(previous.tasks, next.tasks))
  await deleteMissing(client, 'media', missingIds(previous.media, next.media))
  await deleteMissing(client, 'shots', missingIds(previous.shots, next.shots))
  await deleteMissing(client, 'assets', missingIds(previous.assets, next.assets))
  await deleteMissing(client, 'projects', missingIds(previous.projects, next.projects))
  await deleteMissing(client, 'users', missingIds(previous.users, next.users))
  await deleteMissing(client, 'tenants', missingIds(tenantRows(previous), tenantRows(next)))

  await upsertTenants(client, changedRows(tenantRows(previous), tenantRows(next)))
  await upsertUsers(client, changedRows(previous.users, next.users))
  await upsertProjects(client, changedRows(previous.projects, next.projects))
  await upsertAssets(client, changedRows(previous.assets, next.assets))
  await upsertShots(client, changedRows(previous.shots, next.shots))
  await upsertTasks(client, changedRows(previous.tasks, next.tasks))
  await upsertMedia(client, changedRows(previous.media, next.media))
  await upsertLedger(client, changedRows(previous.ledger, next.ledger))
}

async function deleteMissing(client: PoolClient, table: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await client.query(`delete from ${table} where id = any($1::text[])`, [ids])
}

async function upsertTenants(client: PoolClient, tenants: TenantRow[]): Promise<void> {
  const now = new Date().toISOString()
  for (const tenant of tenants) {
    await client.query(
      `
        insert into tenants (id, name, created_at, updated_at)
        values ($1, $2, $3, $3)
        on conflict (id) do update set
          name = excluded.name,
          updated_at = excluded.updated_at
      `,
      [tenant.id, tenant.id, now],
    )
  }
}

async function upsertUsers(client: PoolClient, users: StoredUser[]): Promise<void> {
  const now = new Date().toISOString()
  for (const user of users) {
    await client.query(
      `
        insert into users (
          id, tenant_id, email, name, password_hash, roles, plan, credits, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        on conflict (id) do update set
          tenant_id = excluded.tenant_id,
          email = excluded.email,
          name = excluded.name,
          password_hash = excluded.password_hash,
          roles = excluded.roles,
          plan = excluded.plan,
          credits = excluded.credits,
          updated_at = excluded.updated_at
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

async function upsertProjects(client: PoolClient, projects: Project[]): Promise<void> {
  for (const project of projects) {
    await client.query(
      `
        insert into projects (
          id, tenant_id, owner_id, name, content_type, aspect_ratio, status,
          synopsis, script, version, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        on conflict (id) do update set
          tenant_id = excluded.tenant_id,
          owner_id = excluded.owner_id,
          name = excluded.name,
          content_type = excluded.content_type,
          aspect_ratio = excluded.aspect_ratio,
          status = excluded.status,
          synopsis = excluded.synopsis,
          script = excluded.script,
          version = excluded.version,
          updated_at = excluded.updated_at
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

async function upsertAssets(client: PoolClient, assets: Asset[]): Promise<void> {
  for (const asset of assets) {
    await client.query(
      `
        insert into assets (
          id, project_id, tenant_id, kind, source_mode, name, description, prompt,
          prompt_mode, custom_prompt_mode, custom_prompt, negative_prompt,
          references, attributes, image_url, status, created_at, updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13::jsonb, $14::jsonb, $15, $16, $17, $18
        )
        on conflict (id) do update set
          project_id = excluded.project_id,
          tenant_id = excluded.tenant_id,
          kind = excluded.kind,
          source_mode = excluded.source_mode,
          name = excluded.name,
          description = excluded.description,
          prompt = excluded.prompt,
          prompt_mode = excluded.prompt_mode,
          custom_prompt_mode = excluded.custom_prompt_mode,
          custom_prompt = excluded.custom_prompt,
          negative_prompt = excluded.negative_prompt,
          references = excluded.references,
          attributes = excluded.attributes,
          image_url = excluded.image_url,
          status = excluded.status,
          updated_at = excluded.updated_at
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

async function upsertShots(client: PoolClient, shots: Shot[]): Promise<void> {
  for (const shot of shots) {
    await client.query(
      `
        insert into shots (
          id, project_id, tenant_id, order_index, title, framing, duration,
          prompt, image_url, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        on conflict (id) do update set
          project_id = excluded.project_id,
          tenant_id = excluded.tenant_id,
          order_index = excluded.order_index,
          title = excluded.title,
          framing = excluded.framing,
          duration = excluded.duration,
          prompt = excluded.prompt,
          image_url = excluded.image_url,
          updated_at = excluded.updated_at
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

async function upsertTasks(client: PoolClient, tasks: GenerationTask[]): Promise<void> {
  for (const task of tasks) {
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
        on conflict (id) do update set
          client_request_id = excluded.client_request_id,
          project_id = excluded.project_id,
          tenant_id = excluded.tenant_id,
          user_id = excluded.user_id,
          kind = excluded.kind,
          label = excluded.label,
          prompt = excluded.prompt,
          negative_prompt = excluded.negative_prompt,
          provider = excluded.provider,
          model = excluded.model,
          metadata = excluded.metadata,
          status = excluded.status,
          progress = excluded.progress,
          estimated_credits = excluded.estimated_credits,
          result_url = excluded.result_url,
          outputs = excluded.outputs,
          error = excluded.error,
          updated_at = excluded.updated_at
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

async function upsertMedia(client: PoolClient, media: StoredMedia[]): Promise<void> {
  for (const item of media) {
    await client.query(
      `
        insert into media (id, project_id, tenant_id, kind, name, content_type, size, storage_key, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (id) do update set
          project_id = excluded.project_id,
          tenant_id = excluded.tenant_id,
          kind = excluded.kind,
          name = excluded.name,
          content_type = excluded.content_type,
          size = excluded.size,
          storage_key = excluded.storage_key
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

async function upsertLedger(client: PoolClient, ledger: LedgerEntry[]): Promise<void> {
  for (const entry of ledger) {
    await client.query(
      `
        insert into ledger_entries (id, user_id, tenant_id, amount, balance, type, description, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (id) do update set
          user_id = excluded.user_id,
          tenant_id = excluded.tenant_id,
          amount = excluded.amount,
          balance = excluded.balance,
          type = excluded.type,
          description = excluded.description
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

function changedRows<T extends Identified>(previous: T[], next: T[]): T[] {
  const previousById = byId(previous)
  return next.filter((item) => JSON.stringify(previousById.get(item.id)) !== JSON.stringify(item))
}

function missingIds<T extends Identified>(previous: T[], next: T[]): string[] {
  const nextIds = new Set(next.map((item) => item.id))
  return previous.map((item) => item.id).filter((id) => !nextIds.has(id))
}

function byId<T extends Identified>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

function tenantRows(state: AppState): TenantRow[] {
  const tenantIds = new Set<string>()
  for (const user of state.users) tenantIds.add(user.tenantId)
  for (const project of state.projects) tenantIds.add(project.tenantId)
  for (const asset of state.assets) tenantIds.add(asset.tenantId)
  for (const shot of state.shots) tenantIds.add(shot.tenantId)
  for (const task of state.tasks) tenantIds.add(task.tenantId)
  for (const entry of state.ledger) tenantIds.add(entry.tenantId)
  for (const item of state.media) tenantIds.add(item.tenantId)
  return [...tenantIds].sort().map((id) => ({ id }))
}
