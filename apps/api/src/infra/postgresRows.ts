import type {
  Asset,
  CheckoutSession,
  GenerationTask,
  LedgerEntry,
  Project,
  ProjectComment,
  ProjectShare,
  Role,
  Shot,
  SubscriptionSummary,
} from '@seqora/contracts'
import type { QueryResultRow } from 'pg'
import type { StoredMedia, StoredUser } from './store.js'

export type UserRow = QueryResultRow & {
  id: string
  email: string
  name: string
  passwordHash: string
  tenantId: string
  roles: Role[]
  plan: StoredUser['plan']
  credits: number
}

export type ProjectRow = QueryResultRow &
  Omit<Project, 'contentType' | 'aspectRatio' | 'createdAt' | 'updatedAt'> & {
    contentType: Project['contentType']
    aspectRatio: Project['aspectRatio']
    createdAt: Date | string
    updatedAt: Date | string
  }

export type AssetRow = QueryResultRow &
  Omit<
    Asset,
    | 'sourceMode'
    | 'promptMode'
    | 'customPromptMode'
    | 'references'
    | 'attributes'
    | 'imageUrl'
    | 'createdAt'
    | 'updatedAt'
  > & {
    sourceMode: Asset['sourceMode']
    promptMode: Asset['promptMode']
    customPromptMode: Asset['customPromptMode']
    references: unknown
    attributes: unknown
    imageUrl: string | null
    createdAt: Date | string
    updatedAt: Date | string
  }

export type ShotRow = QueryResultRow &
  Omit<Shot, 'order' | 'assetIds' | 'createdAt' | 'updatedAt'> & {
    order: number
    assetIds: string[] | null
    createdAt: Date | string
    updatedAt: Date | string
  }

export type TaskRow = QueryResultRow &
  Omit<
    GenerationTask,
    | 'clientRequestId'
    | 'negativePrompt'
    | 'estimatedCredits'
    | 'resultUrl'
    | 'metadata'
    | 'outputs'
    | 'createdAt'
    | 'updatedAt'
  > & {
    clientRequestId: string
    negativePrompt: string
    estimatedCredits: number
    resultUrl: string | null
    metadata: unknown
    outputs: unknown
    createdAt: Date | string
    updatedAt: Date | string
  }

export type LedgerRow = QueryResultRow & Omit<LedgerEntry, 'createdAt'> & { createdAt: Date | string }

export type MediaRow = QueryResultRow &
  Omit<StoredMedia, 'contentType' | 'storageKey' | 'createdAt'> & {
    contentType: string
    storageKey: string
    createdAt: Date | string
  }

export type SubscriptionRow = QueryResultRow &
  Omit<SubscriptionSummary, 'billingCycle' | 'startsAt' | 'renewsAt' | 'updatedAt'> & {
    billingCycle: SubscriptionSummary['billingCycle']
    startsAt: Date | string
    renewsAt: Date | string | null
    updatedAt: Date | string
  }

export type CheckoutSessionRow = QueryResultRow &
  Omit<CheckoutSession, 'amountCents' | 'createdAt' | 'expiresAt' | 'updatedAt'> & {
    amountCents: number
    createdAt: Date | string
    expiresAt: Date | string
    updatedAt: Date | string
  }

export type ProjectShareRow = QueryResultRow &
  Omit<
    ProjectShare,
    'sharedWithUserId' | 'sharedWithEmail' | 'commentApprovalRequired' | 'createdAt' | 'updatedAt'
  > & {
    sharedWithUserId: string | null
    sharedWithEmail: string | null
    commentApprovalRequired: boolean
    createdAt: Date | string
    updatedAt: Date | string
  }

export type ProjectCommentRow = QueryResultRow &
  Omit<ProjectComment, 'authorUserId' | 'reviewedByUserId' | 'reviewedAt' | 'createdAt' | 'updatedAt'> & {
    authorUserId: string | null
    reviewedByUserId: string | null
    reviewedAt: Date | string | null
    createdAt: Date | string
    updatedAt: Date | string
  }

export const USER_COLUMNS = `
  id, email, name, password_hash as "passwordHash", tenant_id as "tenantId",
  roles, plan, credits
`

export const PROJECT_COLUMNS = `
  id, tenant_id as "tenantId", owner_id as "ownerId", name,
  content_type as "contentType", aspect_ratio as "aspectRatio", status,
  synopsis, script, version, created_at as "createdAt", updated_at as "updatedAt"
`

export const ASSET_COLUMNS = `
  id, project_id as "projectId", tenant_id as "tenantId", kind,
  source_mode as "sourceMode", name, description, prompt,
  prompt_mode as "promptMode", custom_prompt_mode as "customPromptMode",
  custom_prompt as "customPrompt", negative_prompt as "negativePrompt",
  "references", attributes, image_url as "imageUrl", status,
  created_at as "createdAt", updated_at as "updatedAt"
`

export const SHOT_COLUMNS = `
  id, project_id as "projectId", tenant_id as "tenantId",
  order_index as "order", title, framing, duration, prompt,
  asset_ids as "assetIds", image_url as "imageUrl",
  created_at as "createdAt", updated_at as "updatedAt"
`

export const TASK_COLUMNS = `
  id, client_request_id as "clientRequestId", project_id as "projectId",
  tenant_id as "tenantId", user_id as "userId", kind, label, prompt,
  negative_prompt as "negativePrompt", provider, model, metadata, status,
  progress, estimated_credits as "estimatedCredits", result_url as "resultUrl",
  outputs, error, created_at as "createdAt", updated_at as "updatedAt"
`

export const LEDGER_COLUMNS = `
  id, user_id as "userId", tenant_id as "tenantId", amount, balance,
  type, description, created_at as "createdAt"
`

export const MEDIA_COLUMNS = `
  id, project_id as "projectId", tenant_id as "tenantId", kind, name,
  content_type as "contentType", size, storage_key as "storageKey",
  created_at as "createdAt"
`

export const SUBSCRIPTION_COLUMNS = `
  tenant_id as "tenantId", provider, package_id as "packageId", status,
  billing_cycle as "billingCycle", seat_limit as "seatLimit",
  active_seats as "activeSeats", watermark_required as "watermarkRequired",
  commercial_license_enabled as "commercialLicenseEnabled",
  starts_at as "startsAt", renews_at as "renewsAt", updated_at as "updatedAt"
`

export const CHECKOUT_SESSION_COLUMNS = `
  id, tenant_id as "tenantId", user_id as "userId", provider,
  package_id as "packageId", status, amount_cents as "amountCents",
  currency, checkout_url as "url", created_at as "createdAt",
  expires_at as "expiresAt", updated_at as "updatedAt"
`

export const PROJECT_SHARE_COLUMNS = `
  id, project_id as "projectId", tenant_id as "tenantId",
  shared_with_user_id as "sharedWithUserId", shared_with_email as "sharedWithEmail",
  permission, comment_approval_required as "commentApprovalRequired",
  status, created_at as "createdAt", updated_at as "updatedAt"
`

export const PROJECT_COMMENT_COLUMNS = `
  id, project_id as "projectId", tenant_id as "tenantId",
  target_type as "targetType", target_id as "targetId",
  author_user_id as "authorUserId", author_name as "authorName",
  body, status, reviewed_by_user_id as "reviewedByUserId",
  reviewed_at as "reviewedAt", created_at as "createdAt", updated_at as "updatedAt"
`

export function userFromRow(user: UserRow): StoredUser {
  return { ...user, email: user.email.toLowerCase() }
}

export function projectFromRow(project: ProjectRow): Project {
  return {
    ...project,
    createdAt: iso(project.createdAt),
    updatedAt: iso(project.updatedAt),
  }
}

export function assetFromRow(asset: AssetRow): Asset {
  return {
    ...asset,
    references: array<Asset['references'][number]>(asset.references),
    attributes: record(asset.attributes) as Asset['attributes'],
    createdAt: iso(asset.createdAt),
    updatedAt: iso(asset.updatedAt),
  }
}

export function shotFromRow(shot: ShotRow): Shot {
  return {
    ...shot,
    assetIds: shot.assetIds ?? [],
    createdAt: iso(shot.createdAt),
    updatedAt: iso(shot.updatedAt),
  }
}

export function taskFromRow(task: TaskRow): GenerationTask {
  return {
    ...task,
    metadata: record(task.metadata),
    outputs: array<GenerationTask['outputs'][number]>(task.outputs),
    createdAt: iso(task.createdAt),
    updatedAt: iso(task.updatedAt),
  }
}

export function ledgerFromRow(entry: LedgerRow): LedgerEntry {
  return { ...entry, createdAt: iso(entry.createdAt) }
}

export function mediaFromRow(media: MediaRow): StoredMedia {
  return { ...media, createdAt: iso(media.createdAt) }
}

export function subscriptionFromRow(subscription: SubscriptionRow): SubscriptionSummary {
  return {
    ...subscription,
    startsAt: iso(subscription.startsAt),
    renewsAt: isoNullable(subscription.renewsAt),
    updatedAt: iso(subscription.updatedAt),
  }
}

export function checkoutSessionFromRow(session: CheckoutSessionRow): CheckoutSession {
  return {
    ...session,
    createdAt: iso(session.createdAt),
    expiresAt: iso(session.expiresAt),
    updatedAt: iso(session.updatedAt),
  }
}

export function projectShareFromRow(share: ProjectShareRow): ProjectShare {
  return {
    ...share,
    createdAt: iso(share.createdAt),
    updatedAt: iso(share.updatedAt),
  }
}

export function projectCommentFromRow(comment: ProjectCommentRow): ProjectComment {
  return {
    ...comment,
    reviewedAt: isoNullable(comment.reviewedAt),
    createdAt: iso(comment.createdAt),
    updatedAt: iso(comment.updatedAt),
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function isoNullable(value: Date | string | null): string | null {
  return value === null ? null : iso(value)
}

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
