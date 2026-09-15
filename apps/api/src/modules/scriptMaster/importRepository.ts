import { createHash } from 'node:crypto'
import type { Principal, ScriptMasterImportRequest, ScriptMasterImportReceipt } from '@seqora/contracts'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppStore } from '../../infra/store.js'
import { AppError } from '../../core/errors.js'
import {
  assetColumns,
  assetFromRow,
  type AssetRow,
  projectColumns,
  projectFromRow,
  type ProjectRow,
  scriptEpisodeColumns,
  scriptEpisodeFromRow,
  type ScriptEpisodeRow,
  shotColumns,
  shotFromRow,
  type ShotRow,
} from '../projects/repositoryData.js'
import { refreshProjectWorkspaceRuntimeCache } from '../projects/runtimeCache.js'
import { planImport, type ImportWorkspace } from './importPlan.js'
import { writeImportEntities } from './importPersistence.js'

type StoredReceipt = {
  hash: string
  revision: number
  source: string
  target: string
  receipt: ScriptMasterImportReceipt
}

export class ScriptMasterImportRepository {
  private readonly receipts = new Map<string, StoredReceipt>()
  constructor(
    private readonly store: AppStore,
    private readonly database: AccountDatabase | null = null,
  ) {}

  async import(input: ScriptMasterImportRequest, principal: Principal) {
    const key = JSON.stringify([principal.tenantId, principal.userId, input.idempotencyKey])
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const result = this.database
      ? await this.importDatabase(input, principal, key, hash)
      : await this.importMemory(input, principal, key, hash)
    // A failed cache refresh must not convert a committed import into a failed delivery.
    if (this.database)
      await refreshProjectWorkspaceRuntimeCache(this.database, this.store, {
        projectIds: [input.targetProjectId],
        merge: true,
      }).catch(() => {})
    return result
  }

  private async importDatabase(
    input: ScriptMasterImportRequest,
    principal: Principal,
    key: string,
    hash: string,
  ) {
    return this.database!.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key])
      const projectResult = await client.query<ProjectRow>(
        `SELECT ${projectColumns} FROM projects WHERE id=$1 AND tenant_id=$2 AND owner_user_id=$3 FOR UPDATE`,
        [input.targetProjectId, principal.tenantId, principal.userId],
      )
      const project = projectResult.rows[0] ? projectFromRow(projectResult.rows[0]) : null
      if (!project || project.status === 'archived')
        throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
      const stored = await client.query<{ payload_hash: string; receipt: ScriptMasterImportReceipt }>(
        'SELECT payload_hash, receipt FROM script_master_imports WHERE tenant_id=$1 AND actor_id=$2 AND idempotency_key=$3',
        [principal.tenantId, principal.userId, input.idempotencyKey],
      )
      if (stored.rows[0]) {
        this.assertHash(stored.rows[0].payload_hash, hash)
        return stored.rows[0].receipt
      }
      const revision = await client.query<{ revision: number | null }>(
        'SELECT max(source_revision) AS revision FROM script_master_imports WHERE tenant_id=$1 AND actor_id=$2 AND target_project_id=$3 AND source_project_id=$4',
        [principal.tenantId, principal.userId, input.targetProjectId, input.sourceProjectId],
      )
      this.assertRevision(input.sourceRevision, revision.rows[0]?.revision ?? 0)
      const active = await client.query(
        "SELECT 1 FROM generation_tasks WHERE project_id=$1 AND tenant_id=$2 AND status IN ('queued','paused','running') LIMIT 1",
        [project.id, principal.tenantId],
      )
      if (active.rowCount)
        throw new AppError(409, 'IMPORT_TASK_ACTIVE', '目标项目仍有生成任务，请等待完成后导入')
      const params = [project.id, principal.tenantId]
      const episodes = await client.query<ScriptEpisodeRow>(
        `SELECT ${scriptEpisodeColumns} FROM script_episodes WHERE project_id=$1 AND tenant_id=$2 FOR UPDATE`,
        params,
      )
      const assets = await client.query<AssetRow>(
        `SELECT ${assetColumns} FROM assets WHERE project_id=$1 AND tenant_id=$2 FOR UPDATE`,
        params,
      )
      const shots = await client.query<ShotRow>(
        `SELECT ${shotColumns} FROM shots WHERE project_id=$1 AND tenant_id=$2 ORDER BY shot_order FOR UPDATE`,
        params,
      )
      const plan = planImport(
        {
          project,
          scriptEpisodes: episodes.rows.map(scriptEpisodeFromRow),
          assets: assets.rows.map(assetFromRow),
          shots: shots.rows.map(shotFromRow),
        },
        input,
        principal.userId,
      )
      await writeImportEntities(client, plan)
      await client.query('UPDATE projects SET script=$3, updated_at=$4 WHERE id=$1 AND tenant_id=$2', [
        project.id,
        principal.tenantId,
        plan.project.script,
        plan.project.updatedAt,
      ])
      await client.query(
        `INSERT INTO script_master_imports (tenant_id, actor_id, idempotency_key, target_project_id, source_project_id, source_revision, payload_hash, receipt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          principal.tenantId,
          principal.userId,
          input.idempotencyKey,
          project.id,
          input.sourceProjectId,
          input.sourceRevision,
          hash,
          JSON.stringify(plan.receipt),
        ],
      )
      return plan.receipt
    })
  }

  private async importMemory(
    input: ScriptMasterImportRequest,
    principal: Principal,
    key: string,
    hash: string,
  ) {
    return this.store.mutate((state) => {
      const project = state.projects.find(
        (p) =>
          p.id === input.targetProjectId &&
          p.tenantId === principal.tenantId &&
          p.ownerId === principal.userId &&
          p.status !== 'archived',
      )
      if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
      const stored = this.receipts.get(key)
      if (stored) {
        this.assertHash(stored.hash, hash)
        return stored.receipt
      }
      const revision = Math.max(
        0,
        ...[...this.receipts.entries()]
          .filter(
            ([k, r]) =>
              k.startsWith(JSON.stringify([principal.tenantId, principal.userId]).slice(0, -1) + ',') &&
              r.target === project.id &&
              r.source === input.sourceProjectId,
          )
          .map(([, r]) => r.revision),
      )
      this.assertRevision(input.sourceRevision, revision)
      if (
        state.tasks.some(
          (t) =>
            t.projectId === project.id &&
            t.tenantId === principal.tenantId &&
            ['queued', 'paused', 'running'].includes(t.status),
        )
      )
        throw new AppError(409, 'IMPORT_TASK_ACTIVE', '目标项目仍有生成任务，请等待完成后导入')
      const belongs = (item: { projectId: string; tenantId: string }) =>
        item.projectId === project.id && item.tenantId === principal.tenantId
      const workspace: ImportWorkspace = {
        project,
        scriptEpisodes: state.scriptEpisodes.filter(belongs),
        assets: state.assets.filter(belongs),
        shots: state.shots.filter(belongs),
      }
      const plan = planImport(workspace, input, principal.userId)
      mergeImported(state.scriptEpisodes, plan.episodes)
      mergeImported(state.assets, plan.assets)
      mergeImported(state.shots, plan.shots)
      Object.assign(project, plan.project)
      this.receipts.set(key, {
        hash,
        revision: input.sourceRevision,
        source: input.sourceProjectId,
        target: project.id,
        receipt: plan.receipt,
      })
      return plan.receipt
    })
  }

  private assertHash(stored: string, hash: string) {
    if (stored !== hash)
      throw new AppError(409, 'IMPORT_IDEMPOTENCY_CONFLICT', '该导入标识已用于另一份内容，请重新读取后导入')
  }
  private assertRevision(incoming: number, latest: number) {
    if (incoming < latest)
      throw new AppError(409, 'IMPORT_STALE_REVISION', '主项目已导入更高版本，请刷新剧本大师后重试')
  }
}

function mergeImported<T extends { id: string }>(collection: T[], changes: T[]) {
  for (const item of changes) {
    const index = collection.findIndex((existing) => existing.id === item.id)
    if (index < 0) collection.push(item)
    else collection[index] = item
  }
}
