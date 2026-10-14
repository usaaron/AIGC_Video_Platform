import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  imageProviderCompletionReceiptSchema,
  type Asset,
  type GenerationTask,
  type Shot,
} from '@seqora/contracts'
import type { AppState, AppStore } from '../../infra/store.js'

type Fields = Record<string, { present: boolean; value: unknown }>
type Target = { kind: 'asset' | 'appearance' | 'shot'; id: string; variantId?: string }
type Patch = { target: Target; before: Fields; after: Fields }
type Snapshot = { target: Target; fields: Fields; object: Record<string, unknown> }
// Store ownership supplies lifecycle cleanup; no TTL can silently discard a pending rollback.
const journals = new WeakMap<AppStore, Map<string, Patch[]>>()

function keyFor(task: GenerationTask): string | null {
  const receipt = task.metadata.providerCompletionReceipt
  if (!receipt || typeof receipt !== 'object') return null
  return createHash('sha256').update(JSON.stringify(receipt)).digest('hex')
}

function fieldsFor(object: Record<string, unknown>, names: string[]): Fields {
  return Object.fromEntries(
    names.map((name) => [
      name,
      { present: Object.hasOwn(object, name), value: structuredClone(object[name]) },
    ]),
  )
}

/** Capture only fields image completion can change, with appearance variants addressed by identity. */
export function captureImageWorkspaceWriteback(task: GenerationTask, asset?: Asset, shot?: Shot): Snapshot[] {
  const snapshots: Snapshot[] = []
  const add = (target: Target, object: object, groups: string[][]) => {
    for (const names of groups) {
      const record = object as Record<string, unknown>
      snapshots.push({ target, object: record, fields: fieldsFor(record, names) })
    }
  }
  if (asset && asset.tenantId === task.tenantId) {
    add({ kind: 'asset', id: asset.id }, asset, [['imageUrl'], ['updatedAt']])
    const attributes = task.metadata.attributes as Record<string, unknown> | undefined
    if (asset.attributes.type === 'character') {
      const variant = asset.attributes.appearanceVariants.find(
        (item) => item.id === attributes?.activeAppearanceVariantId,
      )
      if (variant)
        add({ kind: 'appearance', id: asset.id, variantId: variant.id }, variant, [
          ['bodyReference'],
          ['turnaroundReferences'],
          ['updatedAt'],
        ])
    }
  }
  if (shot && shot.tenantId === task.tenantId)
    add({ kind: 'shot', id: shot.id }, shot, [['imageUrl', 'selectedImageTaskId'], ['updatedAt']])
  return snapshots
}

export function recordImageWorkspaceWriteback(
  store: AppStore,
  task: GenerationTask,
  before: Snapshot[],
): void {
  if (!store.usesDatabaseRuntime) return
  const key = keyFor(task)
  if (!key) return
  const patches = before
    .map((snapshot) => ({
      target: snapshot.target,
      before: snapshot.fields,
      after: fieldsFor(snapshot.object, Object.keys(snapshot.fields)),
    }))
    .filter((patch) => !isDeepStrictEqual(patch.before, patch.after))
  if (!patches.length) return
  const journal = journals.get(store) ?? new Map<string, Patch[]>()
  journal.set(key, patches)
  journals.set(store, journal)
}

/** Restore only this rejected write's unchanged fields; later edits or selections always win. */
export function restoreRejectedImageWorkspaceWriteback(
  store: AppStore,
  state: AppState,
  task: GenerationTask,
): void {
  const key = keyFor(task)
  const patches = key ? journals.get(store)?.get(key) : undefined
  if (!patches) return
  const currentTask = state.tasks.find(
    (item) => item.id === task.id && item.projectId === task.projectId && item.tenantId === task.tenantId,
  )
  // Output URLs are task-scoped, so a later completed attempt can legitimately reuse every visible value.
  const currentReceipt = imageProviderCompletionReceiptSchema.safeParse(
    currentTask?.metadata.providerCompletionReceipt,
  )
  if (
    currentTask?.status === 'completed' &&
    (currentTask.attempts ?? 0) >= (task.attempts ?? 0) &&
    currentReceipt.success &&
    currentReceipt.data.taskId === currentTask.id &&
    currentReceipt.data.tenantId === currentTask.tenantId &&
    currentReceipt.data.projectId === currentTask.projectId &&
    currentReceipt.data.attempts === currentTask.attempts &&
    currentReceipt.data.requestId === currentTask.metadata.providerIdempotencyKey &&
    !isDeepStrictEqual(
      currentTask.metadata.providerCompletionReceipt,
      task.metadata.providerCompletionReceipt,
    )
  )
    return
  for (const patch of patches) {
    const target = patch.target
    const row =
      target.kind === 'shot'
        ? state.shots.find(
            (item) =>
              item.id === target.id && item.projectId === task.projectId && item.tenantId === task.tenantId,
          )
        : state.assets.find(
            (item) =>
              item.id === target.id && item.projectId === task.projectId && item.tenantId === task.tenantId,
          )
    const asset = target.kind === 'appearance' ? (row as Asset | undefined) : undefined
    const object =
      target.kind === 'appearance'
        ? asset?.attributes.type === 'character'
          ? asset.attributes.appearanceVariants.find((item) => item.id === target.variantId)
          : undefined
        : row
    if (!object) continue
    const record = object as Record<string, unknown>
    if (!isDeepStrictEqual(fieldsFor(record, Object.keys(patch.after)), patch.after)) continue
    for (const [name, field] of Object.entries(patch.before)) {
      if (field.present) record[name] = structuredClone(field.value)
      else delete record[name]
    }
  }
}

export function clearImageWorkspaceWriteback(store: AppStore, task: GenerationTask): void {
  const key = keyFor(task)
  if (key) journals.get(store)?.delete(key)
}
