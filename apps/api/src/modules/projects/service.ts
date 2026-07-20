import type {
  CreateAsset,
  CreateProject,
  CreateShot,
  Principal,
  UpdateAsset,
  UpdateProject,
  UpdateShot,
} from '@seqora/contracts'
import { analyzeScriptForProduction } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import type { ProjectStore } from './repository.js'

export class ProjectService {
  constructor(private readonly repository: ProjectStore) {}

  list(principal: Principal) {
    return this.repository.list(principal)
  }

  async workspace(projectId: string, principal: Principal) {
    const workspace = await this.repository.workspace(projectId, principal)
    if (!workspace) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权访问')
    return workspace
  }

  create(input: CreateProject, principal: Principal) {
    return this.repository.create(input, principal)
  }

  async update(projectId: string, input: UpdateProject, principal: Principal) {
    const project = await this.repository.update(projectId, input, principal)
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
    return project
  }

  async saveVersion(projectId: string, principal: Principal) {
    const project = await this.repository.saveVersion(projectId, principal)
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
    return project
  }

  async createAsset(projectId: string, input: CreateAsset, principal: Principal) {
    const asset = await this.repository.createAsset(projectId, input, principal)
    if (!asset) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
    return asset
  }

  async updateAsset(projectId: string, assetId: string, input: UpdateAsset, principal: Principal) {
    const asset = await this.repository.updateAsset(projectId, assetId, input, principal)
    if (!asset) throw new AppError(404, 'ASSET_NOT_FOUND', '资产不存在或无权修改')
    return asset
  }

  async deleteAsset(projectId: string, assetId: string, principal: Principal) {
    if (!(await this.repository.deleteAsset(projectId, assetId, principal))) {
      throw new AppError(404, 'ASSET_NOT_FOUND', '资产不存在或无权删除')
    }
  }

  async createShot(projectId: string, input: CreateShot, principal: Principal) {
    const shot = await this.repository.createShot(projectId, input, principal)
    if (!shot) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
    return shot
  }

  async updateShot(projectId: string, shotId: string, input: UpdateShot, principal: Principal) {
    const shot = await this.repository.updateShot(projectId, shotId, input, principal)
    if (!shot) throw new AppError(404, 'SHOT_NOT_FOUND', '分镜不存在或无权修改')
    return shot
  }

  async generateShots(projectId: string, principal: Principal) {
    const workspace = await this.workspace(projectId, principal)
    const analysis = analyzeScriptForProduction(workspace.project.script, workspace.assets)
    if (!analysis.shots.length) throw new AppError(400, 'SCRIPT_REQUIRED', '请先填写剧本')

    const shots: CreateShot[] = analysis.shots.map((shot) => ({
      title: shot.title,
      framing: shot.framing,
      duration: shot.duration,
      prompt: shot.prompt,
      assetIds: shot.assetIds,
      imageUrl: shot.imageUrl,
    }))
    const created = await this.repository.replaceShots(projectId, shots, principal)
    if (!created) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权生成分镜')
    return created
  }
}
