import type {
  CreateAsset,
  CreateProject,
  CreateShot,
  Principal,
  UpdateAsset,
  UpdateProject,
  UpdateShot,
} from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import type { ProjectRepository } from './repository.js'

export class ProjectService {
  constructor(private readonly repository: ProjectRepository) {}

  list(principal: Principal) {
    return this.repository.list(principal)
  }

  workspace(projectId: string, principal: Principal) {
    const workspace = this.repository.workspace(projectId, principal)
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
    const workspace = this.workspace(projectId, principal)
    const paragraphs = workspace.project.script
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8)
    if (!paragraphs.length) throw new AppError(400, 'SCRIPT_REQUIRED', '请先填写剧本')

    const images = [
      '/demo/rain.jpg',
      '/demo/lin.jpg',
      '/demo/station.jpg',
      '/demo/zhou.jpg',
      '/demo/room.jpg',
    ]
    const shots: CreateShot[] = paragraphs.map((paragraph, index) => ({
      title: `镜头 ${String(index + 1).padStart(2, '0')}`,
      framing: index === 0 ? '大全景' : index % 3 === 0 ? '特写' : '中景',
      duration: Math.min(8, Math.max(3, Math.ceil(paragraph.length / 18))),
      prompt: paragraph,
      imageUrl: images[index % images.length] ?? null,
    }))
    return this.repository.replaceShots(projectId, shots, principal)
  }
}
