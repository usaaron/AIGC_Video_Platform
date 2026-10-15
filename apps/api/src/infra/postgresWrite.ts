import type { Asset, GenerationTask, LedgerEntry, Project, Shot } from '@seqora/contracts'
import type { PoolClient } from 'pg'
import type {
  AppState,
  StoredCheckoutSession,
  StoredMedia,
  StoredProjectComment,
  StoredProjectShare,
  StoredSubscription,
  StoredUser,
} from './store.js'
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

  await deleteMissing(client, 'project_comments', missingIds(previous.projectComments, next.projectComments))
  await deleteMissing(client, 'project_shares', missingIds(previous.projectShares, next.projectShares))
  await deleteMissing(
    client,
    'billing_checkout_sessions',
    missingIds(previous.checkoutSessions, next.checkoutSessions),
  )
  await deleteMissing(
    client,
    'billing_subscriptions',
    missingIds(subscriptionRows(previous), subscriptionRows(next)),
  )
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
  await upsertSubscriptions(client, changedRows(subscriptionRows(previous), subscriptionRows(next)))
  await upsertCheckoutSessions(client, changedRows(previous.checkoutSessions, next.checkoutSessions))
  await upsertProjectShares(client, changedRows(previous.projectShares, next.projectShares))
  await upsertProjectComments(client, changedRows(previous.projectComments, next.projectComments))
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
          "references", attributes, image_url, status, created_at, updated_at
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
          "references" = excluded."references",
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
          prompt, asset_ids, image_url, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        on conflict (id) do update set
          project_id = excluded.project_id,
          tenant_id = excluded.tenant_id,
          order_index = excluded.order_index,
          title = excluded.title,
          framing = excluded.framing,
          duration = excluded.duration,
          prompt = excluded.prompt,
          asset_ids = excluded.asset_ids,
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
        shot.assetIds,
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

async function upsertSubscriptions(client: PoolClient, subscriptions: StoredSubscription[]): Promise<void> {
  for (const subscription of subscriptions) {
    await client.query(
      `
        insert into billing_subscriptions (
          tenant_id, provider, package_id, status, billing_cycle, seat_limit,
          active_seats, watermark_required, commercial_license_enabled,
          starts_at, renews_at, updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9,
          $10, $11, $12
        )
        on conflict (tenant_id) do update set
          provider = excluded.provider,
          package_id = excluded.package_id,
          status = excluded.status,
          billing_cycle = excluded.billing_cycle,
          seat_limit = excluded.seat_limit,
          active_seats = excluded.active_seats,
          watermark_required = excluded.watermark_required,
          commercial_license_enabled = excluded.commercial_license_enabled,
          starts_at = excluded.starts_at,
          renews_at = excluded.renews_at,
          updated_at = excluded.updated_at
      `,
      [
        subscription.tenantId,
        subscription.provider,
        subscription.packageId,
        subscription.status,
        subscription.billingCycle,
        subscription.seatLimit,
        subscription.activeSeats,
        subscription.watermarkRequired,
        subscription.commercialLicenseEnabled,
        subscription.startsAt,
        subscription.renewsAt,
        subscription.updatedAt,
      ],
    )
  }
}

async function upsertCheckoutSessions(client: PoolClient, sessions: StoredCheckoutSession[]): Promise<void> {
  for (const session of sessions) {
    await client.query(
      `
        insert into billing_checkout_sessions (
          id, tenant_id, user_id, provider, package_id, status, amount_cents,
          currency, checkout_url, metadata, created_at, expires_at, updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10::jsonb, $11, $12, $13
        )
        on conflict (id) do update set
          tenant_id = excluded.tenant_id,
          user_id = excluded.user_id,
          provider = excluded.provider,
          package_id = excluded.package_id,
          status = excluded.status,
          amount_cents = excluded.amount_cents,
          currency = excluded.currency,
          checkout_url = excluded.checkout_url,
          metadata = excluded.metadata,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `,
      [
        session.id,
        session.tenantId,
        session.userId,
        session.provider,
        session.packageId,
        session.status,
        session.amountCents,
        session.currency,
        session.url,
        JSON.stringify({}),
        session.createdAt,
        session.expiresAt,
        session.updatedAt,
      ],
    )
  }
}

async function upsertProjectShares(client: PoolClient, shares: StoredProjectShare[]): Promise<void> {
  for (const share of shares) {
    await client.query(
      `
        insert into project_shares (
          id, project_id, tenant_id, shared_with_user_id, shared_with_email,
          permission, comment_approval_required, status, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (id) do update set
          project_id = excluded.project_id,
          tenant_id = excluded.tenant_id,
          shared_with_user_id = excluded.shared_with_user_id,
          shared_with_email = excluded.shared_with_email,
          permission = excluded.permission,
          comment_approval_required = excluded.comment_approval_required,
          status = excluded.status,
          updated_at = excluded.updated_at
      `,
      [
        share.id,
        share.projectId,
        share.tenantId,
        share.sharedWithUserId,
        share.sharedWithEmail,
        share.permission,
        share.commentApprovalRequired,
        share.status,
        share.createdAt,
        share.updatedAt,
      ],
    )
  }
}

async function upsertProjectComments(client: PoolClient, comments: StoredProjectComment[]): Promise<void> {
  for (const comment of comments) {
    await client.query(
      `
        insert into project_comments (
          id, project_id, tenant_id, target_type, target_id, author_user_id,
          author_name, body, status, reviewed_by_user_id, reviewed_at,
          created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        on conflict (id) do update set
          project_id = excluded.project_id,
          tenant_id = excluded.tenant_id,
          target_type = excluded.target_type,
          target_id = excluded.target_id,
          author_user_id = excluded.author_user_id,
          author_name = excluded.author_name,
          body = excluded.body,
          status = excluded.status,
          reviewed_by_user_id = excluded.reviewed_by_user_id,
          reviewed_at = excluded.reviewed_at,
          updated_at = excluded.updated_at
      `,
      [
        comment.id,
        comment.projectId,
        comment.tenantId,
        comment.targetType,
        comment.targetId,
        comment.authorUserId,
        comment.authorName,
        comment.body,
        comment.status,
        comment.reviewedByUserId,
        comment.reviewedAt,
        comment.createdAt,
        comment.updatedAt,
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
  for (const item of state.subscriptions) tenantIds.add(item.tenantId)
  for (const item of state.checkoutSessions) tenantIds.add(item.tenantId)
  for (const item of state.projectShares) tenantIds.add(item.tenantId)
  for (const item of state.projectComments) tenantIds.add(item.tenantId)
  return [...tenantIds].sort().map((id) => ({ id }))
}

function subscriptionRows(state: AppState): Array<StoredSubscription & { id: string }> {
  return state.subscriptions.map((subscription) => ({ ...subscription, id: subscription.tenantId }))
}
