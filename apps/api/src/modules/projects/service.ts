import type {
  Asset,
  CreateAsset,
  CreateProject,
  CreateShot,
  GenerateScriptRequest,
  GenerateShotsRequest,
  Principal,
  ScriptCreativeDirection,
  ScriptAssetSuggestion,
  ScriptOutlineOption,
  ScriptStructureContent,
  UpdateAsset,
  UpdateProject,
  UpdateShot,
} from '@seqora/contracts'
import {
  SCRIPT_OPERATION_CREDITS,
  scriptOutlineOptionsContentSchema,
  scriptAssetSuggestionsContentSchema,
  scriptReviewContentSchema,
  scriptScenesContentSchema,
  scriptStructureContentSchema,
} from '@seqora/contracts'
import { z } from 'zod'
import { AppError } from '../../core/errors.js'
import type { TextGenerationProvider } from '../../core/generation/textProvider.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import type { ProjectRepository } from './repository.js'

export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly textProvider: TextGenerationProvider | null = null,
    private readonly creditLedger: CreditLedger | null = null,
  ) {}

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

  async generateScriptOutlines(
    projectId: string,
    idea: string,
    direction: ScriptCreativeDirection,
    count: number,
    clientRequestId: string,
    principal: Principal,
  ) {
    const workspace = this.workspace(projectId, principal)
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')
    const source = idea.trim()
    if (!source) throw new AppError(400, 'SCRIPT_IDEA_REQUIRED', '请先填写故事想法')

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n画面比例：${workspace.project.aspectRatio}\n已有故事简介：${workspace.project.synopsis || '暂无'}\n已有剧本摘要：${headExcerpt(workspace.project.script, 700) || '暂无'}\n创作方向（必须落地）：${directionSummary(direction)}\n已确认项目资产：${assetSummary(workspace.assets)}`
    return this.runBillableScriptOperation(
      principal,
      `script-outline-${clientRequestId}`,
      SCRIPT_OPERATION_CREDITS.outline,
      '生成剧本大纲候选',
      async () => {
        const response = await this.textProvider!.generate({
          systemPrompt: SCRIPT_OUTLINE_SYSTEM_PROMPT,
          userPrompt: `${projectContext}\n\n用户一句话想法：\n${source}\n\n请生成 ${count} 个差异明显的大纲候选。每个 summary 控制在 200 到 500 个中文字符，适合用户先比较方向，再进入详细剧情拆分。`,
          maxOutputTokens: SCRIPT_OUTLINE_MAX_TOKENS,
        })
        const result = parseProviderJson(response, scriptOutlineOptionsContentSchema, '大纲候选结果格式错误')
        return {
          outlines: result.outlines.slice(0, count),
          generatedAt: new Date().toISOString(),
        }
      },
    )
  }

  async generateScriptStructure(
    projectId: string,
    idea: string,
    outline: ScriptOutlineOption,
    direction: ScriptCreativeDirection,
    clientRequestId: string,
    principal: Principal,
  ) {
    const workspace = this.workspace(projectId, principal)
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n画面比例：${workspace.project.aspectRatio}\n一句话想法：${idea.trim() || workspace.project.synopsis || '暂无'}\n创作方向（必须落地）：${directionSummary(direction)}\n已确认项目资产：${assetSummary(workspace.assets)}`
    const outlineContext = [
      `标题：${outline.title}`,
      `一句话卖点：${outline.logline}`,
      `主角：${outline.protagonist}`,
      `核心冲突：${outline.conflict}`,
      `情绪基调：${outline.tone}`,
      `结局方向：${outline.ending}`,
      `预计时长：${outline.estimatedDuration}`,
      `故事大纲：${outline.summary}`,
    ].join('\n')

    return this.runBillableScriptOperation(
      principal,
      `script-structure-${clientRequestId}`,
      SCRIPT_OPERATION_CREDITS.structure,
      '生成剧情结构',
      async () => {
        const response = await this.textProvider!.generate({
          systemPrompt: SCRIPT_STRUCTURE_SYSTEM_PROMPT,
          userPrompt: `${projectContext}\n\n已选大纲：\n${outlineContext}\n\n请把已选大纲扩展成可继续生成详细剧情和剧本的剧情结构。`,
          maxOutputTokens: SCRIPT_STRUCTURE_MAX_TOKENS,
        })
        const structure = parseProviderJson(response, scriptStructureContentSchema, '剧情结构结果格式错误')
        return { ...structure, generatedAt: new Date().toISOString() }
      },
    )
  }

  async generateScriptScenes(
    projectId: string,
    idea: string,
    outline: ScriptOutlineOption,
    structure: ScriptStructureContent,
    direction: ScriptCreativeDirection,
    sceneCount: number,
    clientRequestId: string,
    principal: Principal,
  ) {
    const workspace = this.workspace(projectId, principal)
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n画面比例：${workspace.project.aspectRatio}\n一句话想法：${idea.trim() || workspace.project.synopsis || '暂无'}\n创作方向（必须落地）：${directionSummary(direction)}\n已确认项目资产：${assetSummary(workspace.assets)}`
    const outlineContext = [
      `标题：${outline.title}`,
      `一句话卖点：${outline.logline}`,
      `主角：${outline.protagonist}`,
      `核心冲突：${outline.conflict}`,
      `情绪基调：${outline.tone}`,
      `结局方向：${outline.ending}`,
      `故事大纲：${outline.summary}`,
    ].join('\n')
    const structureContext = [
      `结构标题：${structure.title}`,
      `故事前提：${structure.premise}`,
      `主线剧情：${structure.mainPlot}`,
      `剧情阶段：${structure.acts
        .map(
          (act) =>
            `${act.id}｜${act.title}｜${act.estimatedMinutes}分钟｜${act.summary}｜转折：${act.turningPoint}`,
        )
        .join('\n')}`,
      `副线：${structure.subplots.map((subplot) => `${subplot.title}：${subplot.arc}`).join('\n')}`,
      `角色弧光：${structure.characterArcs
        .map((arc) => `${arc.character}：${arc.desire} / ${arc.obstacle} / ${arc.change}`)
        .join('\n')}`,
      `视觉方向：${structure.visualDirection}`,
    ].join('\n')

    return this.runBillableScriptOperation(
      principal,
      `script-scenes-${clientRequestId}`,
      SCRIPT_OPERATION_CREDITS.scenes,
      '生成分场剧本',
      async () => {
        const response = await this.textProvider!.generate({
          systemPrompt: SCRIPT_SCENES_SYSTEM_PROMPT,
          userPrompt: `${projectContext}\n\n已选大纲：\n${outlineContext}\n\n剧情结构：\n${structureContext}\n\n请基于剧情结构生成 ${sceneCount} 场分场剧本。`,
          maxOutputTokens: SCRIPT_SCENES_MAX_TOKENS,
        })
        const scenes = parseProviderJson(
          response,
          scriptScenesContentSchema,
          '分场剧本结果格式错误',
          normalizeScriptScenesProviderContent,
        )
        return {
          ...scenes,
          scenes: scenes.scenes.slice(0, sceneCount),
          generatedAt: new Date().toISOString(),
        }
      },
    )
  }

  async suggestScriptAssets(
    projectId: string,
    script: string,
    direction: ScriptCreativeDirection,
    principal: Principal,
  ) {
    const workspace = this.workspace(projectId, principal)
    const source = script.trim()
    if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先填写剧本内容')

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n画面比例：${workspace.project.aspectRatio}\n创作方向（必须落地）：${directionSummary(direction)}\n已有资产：${assetSummary(workspace.assets)}`
    let warnings: string[] = []
    let result: { summary: string; assets: ScriptAssetSuggestion[] }

    if (!this.textProvider) {
      warnings = ['文本服务未配置，已根据剧本文本做基础资产建议']
      result = fallbackAssetSuggestions(source, direction)
    } else {
      try {
        const response = await this.textProvider.generate({
          systemPrompt: SCRIPT_ASSET_SUGGESTIONS_SYSTEM_PROMPT,
          userPrompt: `${projectContext}\n\n剧本：\n${headExcerpt(source, 30_000)}`,
          maxOutputTokens: SCRIPT_ASSET_SUGGESTIONS_MAX_TOKENS,
        })
        result = parseProviderJson(response, scriptAssetSuggestionsContentSchema, '资产建议结果格式错误')
      } catch {
        warnings = ['文本服务返回格式异常，已根据剧本文本做基础资产建议']
        result = fallbackAssetSuggestions(source, direction)
      }
    }

    return {
      summary: result.summary,
      assets: deduplicateAssetSuggestions(result.assets, workspace.assets).slice(0, 16),
      generatedAt: new Date().toISOString(),
      warnings,
    }
  }

  async generateScript(
    projectId: string,
    draft: string,
    direction: ScriptCreativeDirection,
    mode: GenerateScriptRequest['mode'],
    segment: GenerateScriptRequest['segment'],
    clientRequestId: string,
    principal: Principal,
  ) {
    const workspace = this.workspace(projectId, principal)
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')
    const source = draft.trim() || workspace.project.synopsis.trim()
    if (!source) throw new AppError(400, 'SCRIPT_SOURCE_REQUIRED', '请先填写故事梗概或剧本草稿')

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n画面比例：${workspace.project.aspectRatio}\n创作方向（必须落实）：${directionSummary(direction)}\n已确认项目资产：${assetSummary(workspace.assets)}`
    if (mode === 'quick' && isLongScript(source)) {
      const updated = await this.repository.update(projectId, { script: source }, principal)
      if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
      return {
        script: updated.script,
        mode: 'quick' as const,
        warnings: ['检测到长篇内容，已保存原稿；请使用“生成下一段”按段继续，不再一次性请求超长文本。'],
      }
    }
    return this.runBillableScriptOperation(
      principal,
      `script-generate-${clientRequestId}`,
      SCRIPT_OPERATION_CREDITS.generate,
      mode === 'segment' ? '生成长剧分段' : '快速生成剧本',
      async () => {
        if (mode === 'segment') {
          const segmentText = normalizeExpandedScript(
            await this.textProvider!.generate({
              systemPrompt: SCRIPT_SEGMENT_SYSTEM_PROMPT,
              userPrompt: `${projectContext}\n\n已有剧本或故事上下文：\n${scriptSegmentContext(source)}\n\n本段目标：${segment.goal || '顺着现有剧情自然推进下一段'}\n本段预计时长：约 ${segment.targetMinutes} 分钟\n\n请只生成下一段剧本正文，不要重写已有内容。`,
              maxOutputTokens: segmentMaxOutputTokens(segment.targetMinutes),
            }),
          )
          if (!segmentText) throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', '分段剧本为空')
          const script = appendScriptSegment(draft.trim() || workspace.project.script.trim(), segmentText)
          const updated = await this.repository.update(projectId, { script }, principal)
          if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
          return {
            script: updated.script,
            segment: segmentText,
            mode: 'segment' as const,
            warnings: segmentScriptIssues(segmentText),
          }
        }
        const candidate = normalizeExpandedScript(
          await this.textProvider!.generate({
            systemPrompt: QUICK_SCRIPT_SYSTEM_PROMPT,
            userPrompt: `${projectContext}\n\n请把以下素材改编成 15 到 30 秒视频可以直接使用的快速剧本骨架：\n${source}`,
            maxOutputTokens: QUICK_SCRIPT_MAX_TOKENS,
          }),
        )
        const script = candidate
        const warnings = quickScriptIssues(script)
        const updated = await this.repository.update(projectId, { script }, principal)
        if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
        return { script: updated.script, mode: 'quick' as const, warnings }
      },
    )
  }

  async enrichScript(
    projectId: string,
    script: string,
    direction: ScriptCreativeDirection,
    clientRequestId: string,
    principal: Principal,
  ) {
    const workspace = this.workspace(projectId, principal)
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')
    const source = script.trim() || workspace.project.script.trim()
    if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先生成或填写快速剧本')

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n画面比例：${workspace.project.aspectRatio}\n创作方向（必须落实）：${directionSummary(direction)}\n已确认项目资产：${assetSummary(workspace.assets)}`
    return this.runBillableScriptOperation(
      principal,
      `script-enrich-${clientRequestId}`,
      SCRIPT_OPERATION_CREDITS.enrich,
      '补齐剧本专业视觉细节',
      async () => {
        const candidate = normalizeExpandedScript(
          await this.textProvider!.generate({
            systemPrompt: SCRIPT_DETAIL_SYSTEM_PROMPT,
            userPrompt: `${projectContext}\n\n请在保留原有场景数量、剧情因果和对白的前提下，补齐以下快速剧本的专业视觉细节：\n${source}`,
            maxOutputTokens: isLongScript(source)
              ? longScriptMaxOutputTokens(source)
              : SCRIPT_DETAIL_MAX_TOKENS,
          }),
        )
        const preserved = isLongScript(source) && candidateIsTooShort(source, candidate)
        const enriched = preserved ? source : candidate
        const warnings = preserved
          ? ['检测到长篇原稿，AI 输出过短，系统已自动保留原稿，避免剧情被压缩。']
          : detailedScriptIssues(enriched)
        const updated = await this.repository.update(projectId, { script: enriched }, principal)
        if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
        return { script: updated.script, mode: 'detailed' as const, warnings }
      },
    )
  }

  async reviewScript(
    projectId: string,
    script: string,
    direction: ScriptCreativeDirection,
    clientRequestId: string,
    principal: Principal,
  ) {
    const workspace = this.workspace(projectId, principal)
    if (this.repository.planFor(principal) !== 'member') {
      throw new AppError(403, 'MEMBERSHIP_REQUIRED', '专业剧本审核仅对创作会员开放')
    }
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')
    const source = script.trim() || workspace.project.script.trim()
    if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先填写剧本后再进行专业审核')

    return this.runBillableScriptOperation(
      principal,
      `script-review-${clientRequestId}`,
      SCRIPT_OPERATION_CREDITS.review,
      '专业审核剧本',
      async () => {
        const response = await this.textProvider!.generate({
          systemPrompt:
            '你是漫剧公司的编导总监、摄影指导和剪辑指导。请只返回严格 JSON，不要 Markdown，不要代码块。必须包含 score（0到100整数）、verdict、dimensions、priorityActions。dimensions 必须覆盖 plot、character、dialogue、style、composition、lighting、camera，每项包含 key、score、finding、suggestion。评价要具体到可执行的剧本修改和画面执行，不要泛泛而谈。',
          userPrompt: `项目：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n画面比例：${workspace.project.aspectRatio}\n创作方向：${directionSummary(direction)}\n\n待审核剧本：\n${source}`,
          maxOutputTokens: 4_000,
        })
        const review = parseProviderJson(response, scriptReviewContentSchema, '专业审核结果格式错误')
        return { ...review, generatedAt: new Date().toISOString() }
      },
    )
  }

  private async runBillableScriptOperation<T>(
    principal: Principal,
    referenceId: string,
    credits: number,
    description: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!this.creditLedger) return operation()
    const reserved = await this.creditLedger.reserve(principal, credits, referenceId, description)
    if (!reserved) {
      throw new AppError(409, 'DUPLICATE_REQUEST', '该请求已处理，请勿重复提交')
    }
    try {
      return await operation()
    } catch (error) {
      await this.creditLedger.refundReservation(principal, referenceId, `${description} · 失败退款`)
      throw error
    }
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

  async generateShots(projectId: string, input: GenerateShotsRequest, principal: Principal) {
    const workspace = this.workspace(projectId, principal)
    const source = workspace.project.script.trim()
    if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先填写剧本')

    const paragraphs = source
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
    const shots =
      input.mode === 'beat'
        ? splitScriptIntoBeatShots(paragraphs, input.maxShots)
        : splitScriptIntoSceneShots(paragraphs, input.maxShots)
    return this.repository.replaceShots(projectId, shots, principal)
  }
}

const SCRIPT_OUTLINE_SYSTEM_PROMPT = `你是中文影视项目的前期策划，负责把一句话想法扩展成多个可选择的大纲方向。
硬性规格：
1. 只返回严格 JSON，不要 Markdown，不要代码块，不要解释。
2. 顶层对象只包含 outlines 数组。
3. outlines 必须有 3 到 5 个候选，每个候选必须包含 id、title、logline、protagonist、conflict、tone、ending、summary、estimatedDuration。
4. id 使用 outline-1、outline-2 这样的稳定编号。
5. title 要短，logline 是一句话卖点，protagonist 写主角身份和核心欲望，conflict 写主要外部阻力和内心阻力，tone 写情绪基调，ending 写结局方向。
6. summary 必须是 200 到 500 个中文字符，写清开端、推进、转折、高潮和结局倾向；不要写成分镜、不要写台词、不要列要点。
7. 每个候选必须有明确差异：主角目标、冲突类型、情绪走向、结局气质至少有两项不同。
8. 不要出现真实影视作品名、真实明星名、水印、平台名或版权受限角色。
返回示例：
{"outlines":[{"id":"outline-1","title":"雨夜归人","logline":"一句话卖点","protagonist":"主角设定","conflict":"核心冲突","tone":"浪漫、悲怆","ending":"开放式悲剧","summary":"200 到 500 字大纲","estimatedDuration":"约100分钟"}]}`

const SCRIPT_OUTLINE_MAX_TOKENS = 5_000

const SCRIPT_STRUCTURE_SYSTEM_PROMPT = `你是中文影视项目的剧情统筹，负责把用户选定的大纲拆成可继续写详细剧情和剧本的结构。
硬性规格：
1. 只返回严格 JSON，不要 Markdown，不要代码块，不要解释。
2. 顶层对象必须包含 title、premise、mainPlot、acts、subplots、characterArcs、visualDirection、nextStep。
3. acts 必须有 3 到 5 段，每段包含 id、title、purpose、summary、keyBeats、turningPoint、estimatedMinutes；keyBeats 必须有 3 到 6 条。
4. subplots 必须有 1 到 4 条，每条包含 id、title、characters、arc、payoff。
5. characterArcs 必须覆盖主要人物，每条包含 character、desire、obstacle、change。
6. mainPlot 写清主线因果链：触发事件、阶段目标、主要阻力、中点转折、低谷、高潮选择和结局结果。
7. acts 不要写成镜头，不要写台词；要写剧情段落功能、关键事件和转折。
8. visualDirection 只写对后续资产、分镜和视频生成有用的风格方向，不要泛泛说“电影感”。
9. nextStep 写清下一阶段应如何扩展详细剧情：先补哪些人物关系、哪些关键场景、哪些情绪递进。
10. 不要加入真实影视作品名、真实明星名、水印、平台名或版权受限角色。
返回示例：
{"title":"雪夜归剑","premise":"一句话前提","mainPlot":"主线因果链","acts":[{"id":"act-1","title":"第一幕","purpose":"建立人物和目标","summary":"剧情段落摘要","keyBeats":["节拍1","节拍2","节拍3"],"turningPoint":"幕末转折","estimatedMinutes":25}],"subplots":[{"id":"subplot-1","title":"情感副线","characters":["主角","药师"],"arc":"副线推进","payoff":"回收方式"}],"characterArcs":[{"character":"主角","desire":"外在欲望","obstacle":"阻力","change":"变化"}],"visualDirection":"视觉方向","nextStep":"下一步写作建议"}`

const SCRIPT_STRUCTURE_MAX_TOKENS = 6_000

const SCRIPT_SCENES_SYSTEM_PROMPT = `你是中文影视项目的分场编剧，负责把剧情结构拆成可继续扩写成完整剧本和分镜的分场剧本。
硬性规格：
1. 只返回严格 JSON，不要 Markdown，不要代码块，不要解释。
2. 顶层对象必须包含 title、sourceStructureTitle、scenes、continuityNotes、nextStep。
3. scenes 必须有 6 到 24 场，每场必须包含 id、order、actId、title、location、timeOfDay、characters、purpose、conflict、plot、action、dialogue、visualNotes、transition、estimatedMinutes。
4. order 从 1 开始递增；actId 必须对应剧情结构里的 act id，例如 act-1。
5. 每场 plot 写清本场开端、推进、转折和结果；action 只写能被镜头看到的动作和空间调度；dialogue 写 0 到 8 条短对白，格式建议“人物：台词”。
6. 每场都要服务主线或副线，不要空泛氛围场；相邻场之间必须有明确因果、时间、地点、物件或情绪衔接。
7. visualNotes 要写对资产、分镜、光影和运镜有用的提示，但不要写成最终视频提示词。
8. transition 写本场如何承接上一场或引出下一场。
9. continuityNotes 写全片连续性注意事项：人物状态、关键物件、地点关系、时间推进、情绪递进。
10. 不要加入真实影视作品名、真实明星名、水印、平台名或版权受限角色。
返回示例：
{"title":"雪夜归剑分场剧本","sourceStructureTitle":"雪夜归剑","scenes":[{"id":"scene-1","order":1,"actId":"act-1","title":"雪夜婚约","location":"边城药铺","timeOfDay":"夜","characters":["女剑客","药师"],"purpose":"建立隐居愿望","conflict":"旧身份与新生活冲突","plot":"本场剧情","action":"可见动作","dialogue":["女剑客：明日之后，我不再握剑。"],"visualNotes":"室内暖灯与窗外雪夜形成对比","transition":"窗外马蹄声引出下一场","estimatedMinutes":5}],"continuityNotes":"连续性注意事项","nextStep":"下一步扩写建议"}`

const SCRIPT_SCENES_MAX_TOKENS = 6_000

const SCRIPT_ASSET_SUGGESTIONS_SYSTEM_PROMPT = `你是中文 AI 视频项目的资产制片和美术统筹，负责从剧本中提取后续生成必须保持一致的核心资产。
硬性规格：
1. 只返回严格 JSON，不要 Markdown，不要代码块，不要解释。
2. 顶层对象必须包含 summary、assets。
3. assets 只允许包含 character、scene、prop、costume 四类，不要包含 audio。
4. 每个资产必须包含 kind、name、description、prompt、negativePrompt、reason、priority、attributes。
5. priority 是 1 到 5 的整数，5 表示最高优先级。
6. 角色只保留推动主线或多次出现的人物，建议 1 到 4 个；场景只保留复用率高或制作成本高的地点，建议 1 到 4 个；道具只保留重要且会多次出现或承载剧情转折的物件，建议 1 到 5 个；服装只保留角色一致性需要的核心服装，建议 1 到 4 个。
7. 不要把一次性群众、背景摆件、普通环境装饰列成资产；不要重复已有资产。
8. prompt 必须是可直接进入资产生成的中文视觉描述；场景 prompt 必须是空场景并预留表演空间；服装 prompt 只描述服装本身，不写脸；道具 prompt 只描述物件本身。
9. 所有 attributes 必须严格使用下列枚举：
character.subjectType human/animal；gender male/female/unspecified；ageGroup child/teen/young/middle/senior；visualStyle photorealistic/cinematic-cg/chinese-3d/chinese-2d/anime/storybook；framing portrait/half/full；bodyType slim/balanced/athletic/full；background solid/transparent/environment；faceStatus pending；bodyStatus pending；portraitSource ai-virtual；turnaroundLayout sheet/separate。
scene.space interior/exterior；sceneType city/street/residential/commercial/nature/ancient/industrial/fantasy；era ancient/recent/modern/future；time dawn/day/sunset/night；weather clear/cloudy/rain/snow/fog；mood warm/tense/mystery/romantic/epic/desolate；camera eye-level/overhead/low-angle/aerial/wide。
prop.category weapon/vehicle/furniture/electronics/jewelry/food/daily/other；material wood/metal/glass/fabric/leather/ceramic/mixed；condition new/used/aged/damaged；view front/side/turnaround；background solid/transparent/environment。
costume.audience male/female/unisex；category daily/formal/professional/uniform/ancient/ceremonial/fantasy/armor；season spring-summer/autumn-winter/all-season；design minimal/luxury/retro/future/chinese；presentation flat/model/worn。
返回示例：
{"summary":"建议先建立主角、核心场景、关键道具和主服装，保障后续分镜一致性。","assets":[{"kind":"character","name":"女剑客","description":"贯穿主线的退隐女剑客。","prompt":"退隐女剑客，清晰五官，古风武侠，全身造型统一。","negativePrompt":"","reason":"主角多次出现，需要保持身份和面部一致。","priority":5,"attributes":{"type":"character","subjectType":"human","gender":"female","ageGroup":"young","exactAge":null,"species":"","anthropomorphic":false,"visualStyle":"cinematic-cg","framing":"full","bodyType":"balanced","background":"solid","faceStatus":"pending","bodyStatus":"pending","faceReference":null,"bodyReference":null,"portraitSource":"ai-virtual","trustedPortrait":null,"legStretch":false,"turnaround":false,"turnaroundLayout":"sheet"}}]}`

const SCRIPT_ASSET_SUGGESTIONS_MAX_TOKENS = 6_000

const QUICK_SCRIPT_SYSTEM_PROMPT = `你是中文漫剧的快速编剧。你的任务不是写长篇小说，而是把用户素材整理成 15 到 30 秒视频可以直接进入分镜的故事骨架。

硬性规格：
1. 输出 4 到 6 个场景，总长度约 800 到 1600 个中文字符。
2. 每个场景必须单独占一行，场景之间换行；不要输出标题、解释、Markdown 或分析。
3. 每行只使用这 6 个基础字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：。
4. 剧情必须有明确目标、阻力、变化和结果；不要写空泛的“氛围感”“电影感”。
5. 动作必须是可以被摄像机看见的连续动作，明确谁在什么位置做什么；不要只写心理活动。
6. 对白要短、口语化并推动冲突；没有对白时写“无台词”，同时写清人物反应。
7. 场景之间必须保持人物、地点、时间、服装和关键物件连续；每一场都要推动主线。
8. 结尾留下一个清晰的悬念、决定或下一步动作，方便后续补齐专业视觉细节。

只输出 4 到 6 行剧本正文。`

const SCRIPT_DETAIL_SYSTEM_PROMPT = `你是中文漫剧的视觉导演和分镜前置编剧。请把快速剧本补齐为可直接用于资产设计、分镜和视频生成的制作级剧本。

硬性规格：
1. 保留原剧本的场景数量、人物、地点、关键物件、剧情因果和对白，不要另起炉灶，不要扩展成新的长故事。
2. 每个场景必须单独占一行，场景之间换行；不要输出标题、解释、Markdown 或分析。
3. 在原有基础字段后补齐：风格：｜构图：｜光影：｜运镜：｜衔接：。
4. 剧情写清本场目标、阻力、转折和结果；动作写清起势、过程、结束姿态以及与环境或物件的互动。
5. 风格必须落实项目选择的视觉类型、材质和色彩；构图必须写景别、主体位置、前中后景和画面重心。
6. 光影必须写主光来源、方向、软硬、色温和明暗关系；运镜必须写机位、运动方式、速度、运动对象和结束画面。
7. 衔接必须说明承接上一场的时间、动作、视线、人物位置或物件状态，并给下一场留下明确动作接点。
8. 所有视觉内容必须服务于原剧情，禁止添加新的角色、道具、回忆、梦境或突然转场。

只输出补齐后的剧本正文。`

const QUICK_SCRIPT_MAX_TOKENS = 2_400
const SCRIPT_DETAIL_MAX_TOKENS = 4_000
const LONG_SCRIPT_PRESERVE_THRESHOLD = 2_000
const LONG_SCRIPT_MAX_TOKENS = 16_000

const SCRIPT_SEGMENT_SYSTEM_PROMPT = `你是中文长剧和漫剧的分段编剧。你的任务是基于已有剧本继续写下一段，而不是一次性生成整部长篇。
硬性规则：
1. 只输出“下一段剧本正文”，不要标题解释、Markdown、JSON 或分析。
2. 不要重写、总结、改写已有剧本；只顺着已有内容继续推进。
3. 输出 2 到 6 个连续场次，每个场次单独一行。
4. 每行使用字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：。
5. 剧情必须承接上一段的时间、地点、人物状态和关键物件；本段结尾留下清晰的下一步动作或悬念。
6. 不要为了拉长篇幅写空泛氛围；每个场次都要有目标、阻力、变化和结果。
7. 不要在本段一次性解决全剧大结局，除非本段目标明确要求收尾。`

const QUICK_SCRIPT_FIELDS = ['场次', '剧情', '场景', '角色', '动作', '对白']
const SCRIPT_SCENE_FIELDS = [
  '场次',
  '剧情',
  '场景',
  '角色',
  '动作',
  '对白',
  '风格',
  '构图',
  '光影',
  '运镜',
  '衔接',
]
const SCRIPT_ASSET_FIELD_BOUNDARIES = [
  '场次',
  '剧情',
  '场景',
  '角色',
  '人物',
  '主角',
  '动作',
  '对白',
  '风格',
  '构图',
  '光影',
  '运镜',
  '衔接',
  '关键物件',
  '关键道具',
  '物件',
  '道具',
  '服装',
  '衣装',
  '外观',
]
const SCRIPT_ASSET_STOP_WORDS = new Set(SCRIPT_ASSET_FIELD_BOUNDARIES)

function normalizeExpandedScript(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function isLongScript(script: string): boolean {
  return contentLength(script) > LONG_SCRIPT_PRESERVE_THRESHOLD
}

function candidateIsTooShort(source: string, candidate: string): boolean {
  return contentLength(candidate) < Math.floor(contentLength(source) * 0.85)
}

function longScriptMaxOutputTokens(source: string): number {
  return Math.min(LONG_SCRIPT_MAX_TOKENS, Math.max(6_000, Math.ceil(contentLength(source) * 1.6)))
}

function segmentMaxOutputTokens(targetMinutes: number): number {
  return Math.min(5_500, Math.max(2_400, targetMinutes * 650))
}

function contentLength(value: string): number {
  return value.replace(/\s/g, '').length
}

function scriptSegmentContext(source: string): string {
  if (source.length <= 8_000) return source
  return [
    source.slice(0, 2_500),
    '',
    '[中间已有剧本已省略，生成下一段时不得改写前文]',
    '',
    source.slice(-5_500),
  ].join('\n')
}

function appendScriptSegment(currentScript: string, segment: string): string {
  if (!currentScript.trim()) return segment.trim()
  return `${currentScript.trim()}\n\n${segment.trim()}`
}

function segmentScriptIssues(segment: string): string[] {
  const issues: string[] = []
  const scenes = scriptScenes(segment)
  if (scenes.length < 2 || scenes.length > 6)
    issues.push(`本段生成 ${scenes.length} 个场次，建议保持 2 到 6 个`)
  for (const field of QUICK_SCRIPT_FIELDS) {
    const missing = scenes.filter((scene) => !new RegExp(`${field}[：:]`).test(scene)).length
    if (missing) issues.push(`${missing} 个场次缺少“${field}”字段`)
  }
  if (contentLength(segment) < 500) issues.push('本段内容偏短，可继续生成下一段或补充段落目标')
  return issues
}

function fallbackAssetSuggestions(
  script: string,
  direction: ScriptCreativeDirection,
): { summary: string; assets: ScriptAssetSuggestion[] } {
  const visualStyle = suggestionVisualStyle(direction)
  const characters = extractAssetNames(script, ['角色', '人物', '主角'], ['主角'], 4)
  const scenes = extractAssetNames(script, ['场景', '地点'], ['核心场景'], 4)
  const props = extractAssetNames(script, ['关键物件', '关键道具', '物件', '道具'], [], 5)
  const costumes = extractAssetNames(script, ['服装', '衣装', '外观'], [], 4)
  const assets: ScriptAssetSuggestion[] = [
    ...characters.map((name): ScriptAssetSuggestion => {
      const subjectType = inferScriptCharacterSubjectType(name)
      const gender = subjectType === 'animal' ? 'unspecified' : inferScriptCharacterGender(name)
      const ageGroup = inferScriptCharacterAge(name)
      const exactAge = inferScriptCharacterExactAge(name, script)
      const identityTags = inferScriptCharacterIdentityTags(name)
      const profile = [
        gender === 'male' ? '男性' : gender === 'female' ? '女性' : '',
        scriptAgeLabel(ageGroup),
        exactAge ? `${exactAge}岁` : '',
        ...identityTags,
      ].filter(Boolean)
      const profileText = profile.length ? profile.join('，') : '中文 AI 视频人物设定'
      return {
        kind: 'character',
        name,
        description: `从剧本中提取的主要角色：${name}${profile.length ? `（${profileText}）` : ''}`,
        prompt: `${name}，${profileText}，中文 AI 视频人物设定，面部清晰，造型统一，符合剧本风格，适合后续保持角色一致性。`,
        negativePrompt: '',
        reason: '角色在剧本中出现，需要先建立可复用的人物资产。',
        priority: 5,
        attributes: {
          type: 'character',
          subjectType,
          gender,
          ageGroup,
          exactAge,
          species: subjectType === 'animal' ? name : '',
          anthropomorphic: subjectType === 'animal',
          visualStyle,
          framing: 'full',
          bodyType: ageGroup === 'senior' ? 'balanced' : 'balanced',
          background: 'solid',
          faceStatus: 'pending',
          bodyStatus: 'pending',
          faceReference: null,
          bodyReference: null,
          portraitSource: 'ai-virtual',
          trustedPortrait: null,
          legStretch: false,
          turnaround: false,
          turnaroundLayout: 'sheet',
        },
      }
    }),
    ...scenes.map((name): ScriptAssetSuggestion => ({
      kind: 'scene',
      name,
      description: `从剧本中提取的核心场景：${name}`,
      prompt: `${name}，空场景，中文 AI 视频美术设定，空间层次清晰，预留人物表演和运镜空间，不出现人物。`,
      negativePrompt: '',
      reason: '场景会承载多个镜头，需要先统一空间和美术设定。',
      priority: 4,
      attributes: {
        type: 'scene',
        space: inferSceneSpace(name),
        sceneType: inferSceneType(name),
        era: inferEra(name),
        time: inferSceneTime(name),
        weather: inferWeather(script),
        mood: 'mystery',
        camera: 'wide',
        visualStyle,
        emptyScene: true,
        activitySpace: true,
      },
    })),
    ...props.map((name): ScriptAssetSuggestion => ({
      kind: 'prop',
      name,
      description: `从剧本中提取的关键道具：${name}`,
      prompt: `${name}，关键道具单品展示，材质细节清晰，形状稳定，纯色背景，适合后续多镜头复用。`,
      negativePrompt: '',
      reason: '该物件承载剧情信息或多次出现，需要保持外观连续。',
      priority: 4,
      attributes: {
        type: 'prop',
        category: inferPropCategory(name),
        material: inferPropMaterial(name),
        condition: 'used',
        view: 'front',
        background: 'solid',
        visualStyle,
      },
    })),
    ...costumes.map((name): ScriptAssetSuggestion => ({
      kind: 'costume',
      name,
      description: `从剧本中提取的核心服装：${name}`,
      prompt: `${name}，服装平铺展示，完整轮廓，材质和配色清晰，不出现人物脸部，适合保持角色造型一致。`,
      negativePrompt: '',
      reason: '服装影响角色跨镜头一致性，需要作为独立资产确认。',
      priority: 4,
      attributes: {
        type: 'costume',
        audience: 'unisex',
        category: inferCostumeCategory(name),
        season: inferCostumeSeason(name),
        design: inferCostumeDesign(name),
        presentation: 'flat',
        visualStyle,
        turnaround: false,
      },
    })),
  ]
  return {
    summary: '已根据剧本文本提取角色、场景、关键道具和核心服装建议，建议先确认高优先级资产。',
    assets,
  }
}

function extractAssetNames(script: string, fields: string[], fallback: string[], limit: number): string[] {
  const values: string[] = []
  const fieldBoundaries = SCRIPT_ASSET_FIELD_BOUNDARIES.map(escapeRegExp).join('|')
  for (const field of fields) {
    const pattern = new RegExp(
      `${escapeRegExp(field)}[：:]([\\s\\S]*?)(?=(?:${fieldBoundaries})[：:]|\\n|\\||｜|$)`,
      'gu',
    )
    for (const match of script.matchAll(pattern)) {
      values.push(...splitAssetNameList(match[1] || ''))
    }
  }
  const uniqueValues = [...new Set(values.map(cleanAssetName).filter(Boolean))].filter(
    (value) => !SCRIPT_ASSET_STOP_WORDS.has(value),
  )
  return (uniqueValues.length ? uniqueValues : fallback).slice(0, limit)
}

function splitAssetNameList(value: string): string[] {
  return value
    .split(/[、，,；;和与]/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function cleanAssetName(value: string): string {
  const cleaned = value
    .replace(/^[\s·\-—]+/u, '')
    .replace(
      /^(?:一位|一名|一个|这位|那位|该|某)?(?:[零〇一二三四五六七八九十百两\d]+岁(?:的)?|年迈的|年老的|老年的|少年的|少女的|年轻的|中年的|儿童的)/u,
      '',
    )
    .split(/[（(。.!！?？]/u)[0]!
    .split(/——|--|：|:/u)[0]!
    .trim()
  if (cleaned.length < 2) return ''
  return cleaned.length > 24 ? cleaned.slice(0, 24) : cleaned
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function inferScriptCharacterSubjectType(text: string): 'human' | 'animal' {
  return /狗|猫|牛|马|羊|猪|鸡|鸭|鹅|鸟|鱼|狼|虎|熊|鹿|猴|犬/u.test(text) ? 'animal' : 'human'
}

function inferScriptCharacterGender(text: string): 'male' | 'female' | 'unspecified' {
  if (/老船夫|船夫|祖父|爷爷|爷|父亲|男人|男性|哥哥|弟弟|少爷|他\b/u.test(text)) return 'male'
  if (/翠翠|孙女|外孙女|女性|少女|姑娘|女孩|母亲|娘|妻|小姐|她\b/u.test(text)) return 'female'
  return 'unspecified'
}

function inferScriptCharacterAge(text: string): 'child' | 'teen' | 'young' | 'middle' | 'senior' {
  if (/老船夫|船夫|年迈|祖父|爷爷|老人|老年|晚年|七十|六十|五十/u.test(text)) return 'senior'
  if (/儿童|孩子|小孩|幼/u.test(text)) return 'child'
  if (/翠翠|少年|少女|十几|十三|十四|十五|十六|十七|十八/u.test(text)) return 'teen'
  if (/中年|三十|四十/u.test(text)) return 'middle'
  return 'young'
}

function inferScriptCharacterExactAge(name: string, script: string): number | null {
  const exactFromContext = exactAgeNearCharacterName(name, script)
  if (exactFromContext) return exactFromContext
  return exactAgeFromText(name)
}

function exactAgeNearCharacterName(name: string, script: string): number | null {
  const escapedName = escapeRegExp(name)
  const ageToken = '[0-9零〇一二三四五六七八九十百两]{1,4}'
  const patterns = [
    new RegExp(`(${ageToken})岁(?:的)?[^\\n|｜。；;，,、]{0,12}${escapedName}`, 'u'),
    new RegExp(`${escapedName}[^\\n|｜。；;，,、]{0,12}(${ageToken})岁`, 'u'),
  ]
  for (const pattern of patterns) {
    const match = script.match(pattern)
    const parsed = match ? parseAgeToken(match[1] || '') : null
    if (parsed) return parsed
  }
  return null
}

function exactAgeFromText(text: string): number | null {
  const digitMatch = text.match(/(\d{1,3})岁/u)
  if (digitMatch) return parseAgeToken(digitMatch[1] || '')
  const chineseMatch = text.match(/([零〇一二三四五六七八九十百两]+)岁/u)
  if (!chineseMatch) return null
  return parseAgeToken(chineseMatch[1] || '')
}

function parseAgeToken(value: string): number | null {
  const parsed = /^\d+$/u.test(value) ? Number(value) : parseChineseAge(value)
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 120 ? parsed : null
}

function parseChineseAge(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return NaN
  const digitMap: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  let total = 0
  let current = 0
  let hasUnit = false
  for (const char of trimmed) {
    if (char === '百') {
      total += (current || 1) * 100
      current = 0
      hasUnit = true
      continue
    }
    if (char === '十') {
      total += (current || 1) * 10
      current = 0
      hasUnit = true
      continue
    }
    const digit = digitMap[char]
    if (digit === undefined) return NaN
    current = digit
  }
  return hasUnit ? total + current : current
}

function inferScriptCharacterIdentityTags(text: string): string[] {
  const tags = [
    /船夫|摆渡|渡船/u.test(text) ? '船夫/摆渡人' : '',
    /翠翠|少女|姑娘|女孩/u.test(text) ? '湘西少女' : '',
    /祖父|爷爷|老人/u.test(text) ? '长辈' : '',
    /黄狗|狗|犬/u.test(text) ? '家犬' : '',
  ].filter(Boolean)
  return [...new Set(tags)]
}

function scriptAgeLabel(ageGroup: 'child' | 'teen' | 'young' | 'middle' | 'senior'): string {
  return {
    child: '儿童',
    teen: '少年/少女',
    young: '青年',
    middle: '中年',
    senior: '老年',
  }[ageGroup]
}

function suggestionVisualStyle(
  direction: ScriptCreativeDirection,
): Exclude<ScriptCreativeDirection['style'], 'auto'> {
  return direction.style === 'auto' ? 'cinematic-cg' : direction.style
}

function inferSceneSpace(name: string): 'interior' | 'exterior' {
  return /室内|屋|房|店|铺|工厂|车厢|房间|大厅|暗房|药铺/u.test(name) ? 'interior' : 'exterior'
}

function inferSceneType(
  name: string,
): 'city' | 'street' | 'residential' | 'commercial' | 'nature' | 'ancient' | 'industrial' | 'fantasy' {
  if (/古|宫|城门|边城|药铺|江湖|门派/u.test(name)) return 'ancient'
  if (/工厂|车间|管线|工业|暗房/u.test(name)) return 'industrial'
  if (/森林|山|河|雪坡|荒野/u.test(name)) return 'nature'
  if (/商店|市场|餐厅|药铺/u.test(name)) return 'commercial'
  if (/街|路|站台|车站/u.test(name)) return 'street'
  if (/住宅|家|卧室/u.test(name)) return 'residential'
  if (/浮空|魔法|神殿/u.test(name)) return 'fantasy'
  return 'city'
}

function inferEra(name: string): 'ancient' | 'recent' | 'modern' | 'future' {
  if (/古|剑|宫|江湖|门派|药铺/u.test(name)) return 'ancient'
  if (/未来|赛博|浮空|企业霓虹|机器人/u.test(name)) return 'future'
  if (/民国|旧式|老式/u.test(name)) return 'recent'
  return 'modern'
}

function inferSceneTime(name: string): 'dawn' | 'day' | 'sunset' | 'night' {
  if (/黎明|清晨|晨/u.test(name)) return 'dawn'
  if (/黄昏|傍晚|日落/u.test(name)) return 'sunset'
  if (/夜|午夜|暗/u.test(name)) return 'night'
  return 'day'
}

function inferWeather(script: string): 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog' {
  if (/雪/u.test(script)) return 'snow'
  if (/雨/u.test(script)) return 'rain'
  if (/雾|霾/u.test(script)) return 'fog'
  if (/阴|云/u.test(script)) return 'cloudy'
  return 'clear'
}

function inferPropCategory(
  name: string,
): 'weapon' | 'vehicle' | 'furniture' | 'electronics' | 'jewelry' | 'food' | 'daily' | 'other' {
  if (/刀|剑|枪|弓|矛|武器/u.test(name)) return 'weapon'
  if (/车|船|机/u.test(name)) return 'vehicle'
  if (/桌|椅|柜|床/u.test(name)) return 'furniture'
  if (/手机|电脑|芯片|相机|胶片|屏/u.test(name)) return 'electronics'
  if (/戒指|项链|玉|首饰/u.test(name)) return 'jewelry'
  if (/饭|茶|酒|食物/u.test(name)) return 'food'
  return 'daily'
}

function inferPropMaterial(
  name: string,
): 'wood' | 'metal' | 'glass' | 'fabric' | 'leather' | 'ceramic' | 'mixed' {
  if (/刀|剑|枪|金属|铁|铜|银/u.test(name)) return 'metal'
  if (/木|桌|椅|柜/u.test(name)) return 'wood'
  if (/玻璃|镜/u.test(name)) return 'glass'
  if (/布|帕|衣/u.test(name)) return 'fabric'
  if (/皮|革/u.test(name)) return 'leather'
  if (/瓷|碗|杯/u.test(name)) return 'ceramic'
  return 'mixed'
}

function inferCostumeCategory(
  name: string,
): 'daily' | 'formal' | 'professional' | 'uniform' | 'ancient' | 'ceremonial' | 'fantasy' | 'armor' {
  if (/战甲|盔甲|护甲/u.test(name)) return 'armor'
  if (/古|剑客|侠|汉服|衣装/u.test(name)) return 'ancient'
  if (/制服|校服|军装/u.test(name)) return 'uniform'
  if (/礼服|婚服/u.test(name)) return 'ceremonial'
  if (/职业|工装/u.test(name)) return 'professional'
  if (/魔法|奇幻/u.test(name)) return 'fantasy'
  return 'daily'
}

function inferCostumeSeason(name: string): 'spring-summer' | 'autumn-winter' | 'all-season' {
  if (/雪|冬|厚|披风|风衣/u.test(name)) return 'autumn-winter'
  if (/夏|薄|短袖/u.test(name)) return 'spring-summer'
  return 'all-season'
}

function inferCostumeDesign(name: string): 'minimal' | 'luxury' | 'retro' | 'future' | 'chinese' {
  if (/古|国风|汉服|剑客|侠/u.test(name)) return 'chinese'
  if (/未来|赛博|机能/u.test(name)) return 'future'
  if (/旧|复古|民国/u.test(name)) return 'retro'
  if (/华丽|礼服|宫廷/u.test(name)) return 'luxury'
  return 'minimal'
}

function deduplicateAssetSuggestions(
  suggestions: ScriptAssetSuggestion[],
  existingAssets: readonly Pick<Asset, 'kind' | 'name'>[],
): ScriptAssetSuggestion[] {
  const seen = new Set(existingAssets.map(assetSuggestionKey))
  const result: ScriptAssetSuggestion[] = []
  for (const suggestion of [...suggestions].sort((left, right) => right.priority - left.priority)) {
    const key = assetSuggestionKey(suggestion)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(suggestion)
  }
  return result
}

function assetSuggestionKey(asset: Pick<Asset, 'kind' | 'name'>): string {
  return `${asset.kind}:${asset.name.trim().toLocaleLowerCase('zh-CN')}`
}

function scriptScenes(script: string): string[] {
  return script
    .split(/\n+/)
    .map((scene) => scene.trim())
    .filter(Boolean)
}

function quickScriptIssues(script: string): string[] {
  const issues: string[] = []
  const characterCount = script.replace(/\s/g, '').length
  const scenes = scriptScenes(script)

  if (characterCount < 700) issues.push(`内容仅 ${characterCount} 字，建议补充到 800 字左右`)
  if (scenes.length < 4 || scenes.length > 6) issues.push(`当前 ${scenes.length} 个场景，建议保持 4 到 6 个`)
  for (const field of QUICK_SCRIPT_FIELDS) {
    const missing = scenes.filter((scene) => !new RegExp(`${field}[：:]`).test(scene)).length
    if (missing) issues.push(`${missing} 个场景缺少“${field}”字段`)
  }
  const shortScenes = scenes.filter((scene) => scene.replace(/\s/g, '').length < 90).length
  if (shortScenes) issues.push(`${shortScenes} 个场景内容过短`)
  return issues
}

function detailedScriptIssues(script: string): string[] {
  const issues: string[] = []
  const scenes = scriptScenes(script)
  if (scenes.length < 4 || scenes.length > 6)
    issues.push(`当前 ${scenes.length} 个场景，建议保持与快速剧本一致`)
  for (const field of SCRIPT_SCENE_FIELDS) {
    const missing = scenes.filter((scene) => !new RegExp(`${field}[：:]`).test(scene)).length
    if (missing) issues.push(`${missing} 个场景缺少“${field}”字段`)
  }
  return issues
}

const SHOT_FIELD_NAMES = [
  '场次',
  '剧情',
  '场景',
  '角色',
  '动作',
  '对白',
  '风格',
  '构图',
  '光影',
  '运镜',
  '衔接',
] as const

function splitScriptIntoBeatShots(paragraphs: string[], maxShots: number): CreateShot[] {
  const shots: CreateShot[] = []
  for (const [sceneIndex, paragraph] of paragraphs.entries()) {
    const fields = parseShotFields(paragraph)
    const beats = splitFieldBeats(fields.动作 || fields.剧情 || paragraph).slice(0, 4)
    const dialogueBeats = splitFieldBeats(fields.对白 || '')
    const sceneNumber = fields.场次 || String(sceneIndex + 1)
    for (const [beatIndex, beat] of beats.entries()) {
      if (shots.length >= maxShots) return shots
      shots.push({
        title: `场次 ${sceneNumber} · 动作 ${beatIndex + 1}`,
        framing: beatFraming(fields.构图, beatIndex, beats.length),
        duration: beat.length > 90 ? 6 : 5,
        prompt: compactShotPrompt(fields, beat, dialogueBeats[beatIndex]),
        negativePrompt: '',
        imageUrl: null,
        continuityMode: beatIndex === 0 ? 'independent' : 'continue',
        continuityNote: continuityNoteFor(
          beatIndex > 0 ? beats[beatIndex - 1] || '' : paragraphs[sceneIndex - 1] || '',
          beat,
          beatIndex > 0 ? '上一镜' : '上一场',
        ),
      })
    }
  }
  return shots
}

function splitScriptIntoSceneShots(paragraphs: string[], maxShots: number): CreateShot[] {
  return paragraphs.slice(0, Math.min(8, maxShots)).map((paragraph, index) => ({
    title: `镜头 ${String(index + 1).padStart(2, '0')}`,
    framing: index === 0 ? '大全景' : index % 3 === 0 ? '特写' : '中景',
    duration: Math.min(8, Math.max(4, Math.ceil(paragraph.length / 18))),
    prompt: paragraph,
    negativePrompt: '',
    imageUrl: null,
    continuityMode: 'independent' as const,
    continuityNote: continuityNoteFor(paragraphs[index - 1] || '', paragraph, '上一场'),
  }))
}

function continuityNoteFor(previous: string, current: string, previousLabel: '上一场' | '上一镜'): string {
  if (!previous.trim()) return ''
  const previousFields = parseShotFields(previous)
  const currentFields = parseShotFields(current)
  const previousSource = [previousFields.动作, previousFields.对白, previousFields.衔接]
    .filter(Boolean)
    .join('；')
  const currentSource = currentFields.动作 || currentFields.剧情 || current
  return [
    `${previousLabel}收束：${tailExcerpt(previousSource || previous, 320)}`,
    `本镜开场：${headExcerpt(currentSource, 180)}`,
    '保持人物位置、动作方向、服装、关键物品和光线状态连续；只承接已发生内容，不重复演上一场。',
  ].join('\n')
}

function tailExcerpt(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : normalized.slice(-limit)
}

function headExcerpt(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : normalized.slice(0, limit)
}

function parseShotFields(paragraph: string): Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>> {
  const fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>> = {}
  for (const segment of paragraph.split('｜')) {
    const match = segment.trim().match(/^([^：:]+)[：:]([\s\S]*)$/)
    const key = match?.[1]?.trim() as (typeof SHOT_FIELD_NAMES)[number] | undefined
    if (key && SHOT_FIELD_NAMES.includes(key)) fields[key] = match?.[2]?.trim() || ''
  }
  return fields
}

function splitFieldBeats(value: string): string[] {
  const text = value.trim()
  if (!text) return []
  const semicolonBeats = text
    .split(/[；;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  if (semicolonBeats.length > 1) return semicolonBeats
  return text
    .split(/(?<=[。！？!?])/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function compactShotPrompt(
  fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>>,
  beat: string,
  dialogue?: string,
): string {
  return [
    fieldPart('场次', fields.场次, 24),
    fieldPart('场景', fields.场景, 180),
    fieldPart('角色', fields.角色, 180),
    fieldPart('动作', beat, 240),
    fieldPart('对白', dialogue, 140),
    fieldPart('风格', fields.风格, 120),
    fieldPart('构图', fields.构图, 140),
    fieldPart('光影', fields.光影, 120),
    fieldPart('运镜', fields.运镜, 120),
    fieldPart('衔接', fields.衔接, 120),
  ]
    .filter(Boolean)
    .join('｜')
}

function fieldPart(label: string, value: string | undefined, limit: number): string {
  const text = String(value || '').trim()
  return text ? `${label}：${text.slice(0, limit)}` : ''
}

function beatFraming(composition: string | undefined, beatIndex: number, beatCount: number): string {
  if (beatIndex === 0) {
    return (
      ['大全景', '全景', '广角', '俯拍', '中景', '中近景', '近景', '特写'].find((framing) =>
        composition?.includes(framing),
      ) || '大全景'
    )
  }
  if (beatIndex === beatCount - 1) return '特写'
  return '中景'
}

function assetSummary(assets: Asset[]): string {
  if (!assets.length) return '暂无，请根据原始素材建立一致的人物、场景和道具设定'
  return assets
    .slice(0, 20)
    .map((asset) => `${asset.kind}:${asset.name}${asset.description ? `（${asset.description}）` : ''}`)
    .join('；')
}

const directionLabels: Record<keyof ScriptCreativeDirection, Record<string, string>> = {
  style: {
    auto: '由 AI 根据题材自动选择',
    photorealistic: '仿真人电影感',
    'cinematic-cg': '电影级 CG',
    'chinese-3d': '国漫三维',
    'chinese-2d': '国漫二维',
    anime: '日系动画',
    storybook: '绘本风格',
  },
  composition: {
    auto: '由 AI 根据题材自动选择',
    'rule-of-thirds': '三分法构图',
    centered: '中心构图',
    symmetry: '对称构图',
    'negative-space': '留白构图',
    dynamic: '动态斜线构图',
  },
  lighting: {
    auto: '由 AI 根据题材自动选择',
    'natural-soft': '自然柔光',
    'high-contrast': '高反差硬光',
    'low-key': '低调暗光',
    backlight: '逆光轮廓光',
    neon: '霓虹彩光',
  },
  camera: {
    auto: '由 AI 根据题材自动选择',
    restrained: '克制稳定运镜',
    immersive: '沉浸跟随运镜',
    dynamic: '动态动作运镜',
    documentary: '纪录片手持感',
    suspense: '悬疑压迫运镜',
  },
  focus: {
    balanced: '剧情、人物和对白均衡',
    scene: '优先展开场景与空间',
    character: '优先展开人物动作与情绪',
    dialogue: '优先展开对白与表演反应',
  },
}

function directionSummary(direction: ScriptCreativeDirection): string {
  return [
    `风格：${directionLabels.style[direction.style] || direction.style}`,
    `构图：${directionLabels.composition[direction.composition] || direction.composition}`,
    `光影：${directionLabels.lighting[direction.lighting] || direction.lighting}`,
    `运镜：${directionLabels.camera[direction.camera] || direction.camera}`,
    `扩写重点：${directionLabels.focus[direction.focus] || direction.focus}`,
  ].join('；')
}

function normalizeScriptScenesProviderContent(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    ...value,
    title: normalizeProviderText(value.title, 120) || '分场剧本',
    sourceStructureTitle: normalizeProviderText(value.sourceStructureTitle, 120) || '剧情结构',
    scenes: Array.isArray(value.scenes)
      ? value.scenes.map((scene, index) => normalizeScriptSceneProviderItem(scene, index))
      : value.scenes,
    continuityNotes: normalizeProviderText(value.continuityNotes, 1_000) || '连续性待后续确认',
    nextStep: normalizeProviderText(value.nextStep, 500) || '继续扩写镜头和资产引用',
  }
}

function normalizeScriptSceneProviderItem(value: unknown, index: number): unknown {
  if (!isRecord(value)) {
    const text = normalizeProviderText(value, 1_200)
    return {
      id: `scene-${index + 1}`,
      order: index + 1,
      actId: 'act-1',
      title: `场次 ${index + 1}`,
      location: '待定地点',
      timeOfDay: '待定时间',
      characters: ['待定人物'],
      purpose: text || '场景目标待后续确认',
      conflict: '场景冲突待后续确认',
      plot: text || '剧情待后续确认',
      action: text || '动作待后续确认',
      dialogue: [],
      visualNotes: '视觉提示待后续确认',
      transition: '衔接待后续确认',
      estimatedMinutes: 1,
    }
  }

  return {
    ...value,
    id: normalizeProviderText(value.id, 80) || `scene-${index + 1}`,
    order: normalizeProviderInteger(value.order, index + 1, 1, 200),
    actId: normalizeProviderText(value.actId, 80) || 'act-1',
    title: normalizeProviderText(value.title, 120) || `场次 ${index + 1}`,
    location: normalizeProviderText(value.location, 160) || '待定地点',
    timeOfDay: normalizeProviderText(value.timeOfDay, 80) || '待定时间',
    characters: normalizeProviderTextList(value.characters, 8, 80, ['待定人物']),
    purpose: normalizeProviderText(value.purpose, 400) || '场景目标待后续确认',
    conflict: normalizeProviderText(value.conflict, 400) || '场景冲突待后续确认',
    plot: normalizeProviderText(value.plot, 1_200) || '剧情待后续确认',
    action: normalizeProviderText(value.action, 1_000) || '动作待后续确认',
    dialogue: normalizeProviderTextList(value.dialogue, 8, 300, []),
    visualNotes: normalizeProviderText(value.visualNotes, 700) || '视觉提示待后续确认',
    transition: normalizeProviderText(value.transition, 300) || '衔接待后续确认',
    estimatedMinutes: normalizeProviderInteger(value.estimatedMinutes, 1, 1, 30),
  }
}

function normalizeProviderTextList(
  value: unknown,
  maxItems: number,
  maxLength: number,
  fallback: string[],
): string[] {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  const normalized = items
    .map((item) => normalizeProviderText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems)
  return normalized.length ? normalized : fallback
}

function normalizeProviderText(value: unknown, maxLength: number): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return cleanProviderText(value, maxLength)
  if (typeof value === 'number' || typeof value === 'boolean')
    return cleanProviderText(String(value), maxLength)
  if (Array.isArray(value)) {
    return cleanProviderText(
      value
        .map((item) => normalizeProviderText(item, maxLength))
        .filter(Boolean)
        .join('、'),
      maxLength,
    )
  }
  return ''
}

function normalizeProviderInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  const rounded = Number.isFinite(numeric) ? Math.round(numeric) : fallback
  return Math.min(max, Math.max(min, rounded))
}

function cleanProviderText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseProviderJson<T>(
  raw: string,
  schema: z.ZodType<T>,
  errorMessage: string,
  normalize: (value: unknown) => unknown = (value) => value,
): T {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((index) => index >= 0)
  const start = starts.length ? Math.min(...starts) : -1
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
  if (start < 0 || end < start) throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', errorMessage)
  try {
    return schema.parse(normalize(JSON.parse(text.slice(start, end + 1))))
  } catch {
    throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', errorMessage)
  }
}
