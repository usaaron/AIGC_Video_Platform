import type {
  Asset,
  AutoSplitShotsRequest,
  CreateAsset,
  CreateProject,
  CreateShot,
  GenerateScriptRequest,
  GenerateShotsRequest,
  Principal,
  ScriptCreativeDirection,
  ScriptAssetSuggestion,
  ScriptEpisode,
  ScriptModel,
  UpdateAsset,
  UpdateProject,
  UpdateShot,
} from '@seqora/contracts'
import {
  DEFAULT_SCRIPT_MODEL,
  FORCE_EPISODE_BREAK_MARKER,
  FORCE_SHOT_BREAK_MARKER,
  SCRIPT_OPERATION_CREDITS,
  scriptAssetSuggestionsContentSchema,
  scriptReviewContentSchema,
} from '@seqora/contracts'
import { jsonrepair } from 'jsonrepair'
import { z } from 'zod'
import { AppError } from '../../core/errors.js'
import type { TextGenerationProvider, TextGenerationTiming } from '../../core/generation/textProvider.js'
import { traceMetadata } from '../../core/observability/trace.js'
import type { SessionMetadata } from '../auth/accounts.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import type { ProjectRepository } from './repository.js'

type ScriptBillingMode = 'direct' | 'prepaid'
type ProjectVisualStyle = Exclude<ScriptCreativeDirection['style'], 'auto'>
type ScriptContentMode = 'web-series' | 'advertisement' | 'short-film' | 'short-video'

export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly textProvider: TextGenerationProvider | null = null,
    private readonly creditLedger: CreditLedger | null = null,
  ) {}

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

  async saveScriptEpisode(
    projectId: string,
    episodeId: string | null,
    content: string,
    principal: Principal,
    title?: string,
  ) {
    const workspace = await this.workspace(projectId, principal)
    if (workspace.project.contentType !== 'short-drama') {
      throw new AppError(400, 'SCRIPT_EPISODES_NOT_SUPPORTED', '只有网剧项目支持分集保存')
    }
    const episode = await this.repository.saveScriptEpisode(projectId, episodeId, content, principal, title)
    if (!episode) throw new AppError(404, 'SCRIPT_EPISODE_NOT_FOUND', '剧集不存在或无权修改')
    return episode
  }

  async deleteLastScriptEpisode(projectId: string, episodeId: string, principal: Principal) {
    const outcome = await this.repository.deleteLastScriptEpisode(projectId, episodeId, principal)
    if (outcome === 'active') {
      throw new AppError(409, 'SCRIPT_EPISODE_TASK_ACTIVE', '该集仍有生成任务运行，请先停止或等待任务完成')
    }
    if (outcome === 'not_last') {
      throw new AppError(409, 'SCRIPT_EPISODE_NOT_LAST', '只能删除最后一集；如需删除中间集，请从末集依次删回')
    }
    if (outcome === 'not_found') {
      throw new AppError(404, 'SCRIPT_EPISODE_NOT_FOUND', '剧集不存在或无权删除')
    }
  }

  async clearScriptEpisodes(projectId: string, principal: Principal) {
    const outcome = await this.repository.clearScriptEpisodes(projectId, principal)
    if (outcome === 'active') {
      throw new AppError(409, 'SCRIPT_EPISODE_TASK_ACTIVE', '项目仍有生成任务运行，请先停止或等待任务完成')
    }
    if (outcome === 'not_found') {
      throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
    }
  }

  async archive(projectId: string, principal: Principal, metadata?: SessionMetadata) {
    if (!(await this.repository.archive(projectId, principal))) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权删除')
    }
    await this.repository.recordAuditLog({
      tenantId: principal.tenantId,
      userId: principal.userId,
      actorUserId: principal.userId,
      action: 'project.archived',
      resourceType: 'project',
      resourceId: projectId,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      metadata: traceMetadata({ status: 'archived' }, metadata?.traceId ?? null),
    })
  }

  async saveVersion(projectId: string, principal: Principal) {
    const project = await this.repository.saveVersion(projectId, principal)
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
    return project
  }

  async suggestScriptAssets(
    projectId: string,
    script: string,
    direction: ScriptCreativeDirection,
    principal: Principal,
    model: ScriptModel = DEFAULT_SCRIPT_MODEL,
  ) {
    const workspace = await this.workspace(projectId, principal)
    const source = script.trim()
    if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先填写剧本内容')

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n项目视觉风格：${projectVisualStyleLabel(workspace.project.visualStyle)}（后续所有资产必须继承，不要让用户再次选择）\n画面比例：${workspace.project.aspectRatio}\n创作方向（必须落地）：${directionSummary(direction)}\n已有资产：${assetSummary(workspace.assets)}`
    const fallbackResult = fallbackAssetSuggestions(
      source,
      direction,
      workspace.project.visualStyle ?? 'cinematic-cg',
    )
    const assetEvidence = buildScriptAssetEvidence(source)
    let warnings: string[] = []
    let result: { summary: string; assets: ScriptAssetSuggestion[] }

    if (!this.textProvider) {
      warnings = ['文本服务未配置，已根据剧本文本做基础资产建议']
      result = fallbackResult
    } else {
      try {
        const response = await this.textProvider.generate({
          systemPrompt: SCRIPT_ASSET_SUGGESTIONS_SYSTEM_PROMPT,
          userPrompt: `${projectContext}\n\n全剧资产证据（已覆盖开头、中段和结尾；只基于这些证据筛选核心资产）：\n${assetEvidence.text}`,
          maxOutputTokens: scriptAssetSuggestionMaxTokens(assetEvidence.candidateCount),
          responseFormat: 'json',
          model,
          usageContext: usageContextForPrincipal(principal),
        })
        result = parseProviderJson(
          response,
          scriptAssetSuggestionsContentSchema,
          '资产建议结果格式错误',
          normalizeScriptAssetSuggestionPayload,
        )
      } catch (error) {
        warnings = [assetSuggestionWarning(error)]
        result = fallbackResult
      }
    }

    const sourceNames = extractScriptAssetNameIndex(source)
    const normalizedAssets = result.assets.flatMap((suggestion) => {
      const normalized = normalizeScriptAssetSuggestion(
        suggestion,
        sourceNames,
        source,
        workspace.project.visualStyle ?? 'cinematic-cg',
      )
      return normalized ? [normalized] : []
    })
    const normalizedFallbackAssets = fallbackResult.assets.flatMap((suggestion) => {
      const normalized = normalizeScriptAssetSuggestion(
        suggestion,
        sourceNames,
        source,
        workspace.project.visualStyle ?? 'cinematic-cg',
      )
      return normalized ? [normalized] : []
    })
    const representedAssets = new Set(normalizedAssets.map(assetSuggestionKey))
    if (!normalizedAssets.length && !warnings.length) {
      warnings = ['模型未返回可用资产，已根据全剧结构化字段补齐基础资产建议']
    }

    return {
      summary: result.summary,
      assets: deduplicateAssetSuggestions(
        [
          ...normalizedAssets,
          ...normalizedFallbackAssets.filter(
            (suggestion) => !representedAssets.has(assetSuggestionKey(suggestion)),
          ),
        ],
        workspace.assets,
      ).slice(0, 16),
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
    productionMode: GenerateScriptRequest['productionMode'],
    episodeMinutes: GenerateScriptRequest['episodeMinutes'],
    clientRequestId: string,
    principal: Principal,
    model: ScriptModel = DEFAULT_SCRIPT_MODEL,
    revisionNote = '',
    billingMode: ScriptBillingMode = 'direct',
    episodeDurationSeconds = episodeMinutes * 60,
    onTextProgress?: (text: string, stage?: string) => void,
    onTextTiming?: (timing: TextGenerationTiming) => void,
    episodeId?: string,
  ) {
    const workspace = await this.workspace(projectId, principal)
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')
    const scriptMode = resolveScriptContentMode(workspace.project.contentType, productionMode)
    const hasEpisodeWorkspace = Array.isArray(workspace.scriptEpisodes)
    const scriptEpisodes = workspace.scriptEpisodes ?? []
    const targetEpisode =
      scriptMode === 'web-series' && episodeId
        ? scriptEpisodes.find((episode) => episode.id === episodeId)
        : undefined
    if (hasEpisodeWorkspace && scriptMode === 'web-series' && episodeId && !targetEpisode) {
      throw new AppError(404, 'SCRIPT_EPISODE_NOT_FOUND', '当前剧集不存在，请刷新后重试')
    }
    const source =
      draft.trim() ||
      targetEpisode?.draftContent.trim() ||
      targetEpisode?.content.trim() ||
      workspace.project.synopsis.trim() ||
      `用户尚未提供完整剧本正文。请根据项目《${workspace.project.name}》和已有资产构思一个可制作的故事。`
    const sourceLength = contentLength(source)
    const episodeSeconds = normalizeScriptDurationSeconds(
      episodeDurationSeconds,
      episodeMinutes * 60,
      scriptMode,
    )
    const structuredSource = hasStructuredSceneRows(source)
    const sourceStructuredSceneCount = countStructuredScenes(source)
    const sourceHasStructuredScene = sourceStructuredSceneCount >= 2
    const shouldExpandFromIdea = sourceLength < SCRIPT_INITIAL_EXPANSION_THRESHOLD && !structuredSource
    const enforceWebSeriesSceneBudget =
      scriptMode === 'web-series' && mode !== 'segment' && !sourceHasStructuredScene
    const sceneBudget = webSeriesSceneBudget(episodeSeconds)

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n项目简介：${workspace.project.synopsis.trim() || '未填写'}\n画面比例：${workspace.project.aspectRatio}\n制作模式：${scriptModeContext(scriptMode, episodeSeconds)}\n当前选择模型：${model}\n创作方向（兼容已有设置）：${directionSummary(direction)}\n已确认项目资产：${assetSummary(workspace.assets)}\n本次改写要求：${revisionNote.trim() || '无，按默认制作规范处理'}`
    if (mode === 'quick' && sourceLength >= SINGLE_REWRITE_MAX_LENGTH) {
      if (hasEpisodeWorkspace && scriptMode === 'web-series') {
        const episode = await this.repository.writeScriptEpisodeDraft(
          projectId,
          episodeId ?? null,
          source,
          principal,
        )
        if (!episode) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
        return {
          script: source,
          episode,
          mode: 'quick' as const,
          warnings: ['检测到超过 1 万字的内容，已保留为本集草稿；请拆分后再生成。'],
        }
      }
      const updated = await this.repository.update(projectId, { script: source }, principal)
      if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
      return {
        script: updated.script,
        mode: 'quick' as const,
        warnings: ['检测到超过 1 万字的长篇内容，已保护原稿；请使用“生成下一段”按段续写或进入小说模块。'],
      }
    }
    const generationInstruction = scriptGenerationInstruction({
      scriptMode,
      sourceLength,
      shouldExpandFromIdea,
      episodeSeconds,
      sourceHasStructuredScene,
      sceneBudget,
    })
    const generationSystemPrompt = scriptGenerationSystemPrompt(scriptMode, shouldExpandFromIdea)
    return this.runBillableScriptOperation(
      principal,
      `script-generate-${clientRequestId}`,
      SCRIPT_OPERATION_CREDITS.generate,
      mode === 'segment'
        ? scriptSegmentOperationLabel(scriptMode)
        : scriptGenerationOperationLabel(scriptMode),
      async () => {
        if (mode === 'segment') {
          const savedEpisodes = scriptEpisodes.filter((episode) => episode.status === 'saved')
          if (
            hasEpisodeWorkspace &&
            scriptMode === 'web-series' &&
            scriptEpisodes.some((episode) => episode.status === 'draft')
          ) {
            throw new AppError(409, 'SCRIPT_EPISODE_DRAFT_EXISTS', '请先保存当前剧集，再继续生成下一集')
          }
          if (hasEpisodeWorkspace && scriptMode === 'web-series' && !savedEpisodes.length) {
            throw new AppError(400, 'SCRIPT_EPISODE_REQUIRED', '请先保存第 1 集')
          }
          const segmentSource =
            hasEpisodeWorkspace && scriptMode === 'web-series'
              ? episodeContinuationContext(savedEpisodes)
              : source
          const segmentSeconds = segment.targetSeconds ?? segment.targetMinutes * 60
          let segmentText = await ensureChineseScriptOutput(
            this.textProvider!,
            await this.textProvider!.generate({
              systemPrompt: withChineseScriptRules(scriptSegmentSystemPrompt(scriptMode)),
              userPrompt: scriptSegmentUserPrompt(
                scriptMode,
                projectContext,
                segmentSource,
                segment.goal,
                segmentSeconds,
              ),
              maxOutputTokens: segmentMaxOutputTokens(segmentSeconds, scriptMode),
              model,
              usageContext: usageContextForPrincipal(principal),
              ...(onTextProgress ? { onTextProgress } : {}),
              ...(onTextTiming ? { onTextTiming, timingLabel: 'next-episode' } : {}),
            }),
            model,
            onTextTiming,
            onTextProgress ? (text: string) => onTextProgress(text, 'language-repair') : undefined,
          )
          if (!segmentText) throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', '分段剧本为空')
          segmentText = completeWebSeriesSpokenContent(segmentText, scriptMode)
          assertWebSeriesDialogueCoverage(segmentText, scriptMode)
          if (hasEpisodeWorkspace && scriptMode === 'web-series') {
            const episode = await this.repository.writeScriptEpisodeDraft(
              projectId,
              null,
              segmentText,
              principal,
              { createNext: true },
            )
            if (!episode) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
            return {
              script: segmentText,
              segment: segmentText,
              episode,
              mode: 'segment' as const,
              warnings: segmentScriptIssues(segmentText, scriptMode),
            }
          }
          const script = appendScriptSegment(draft.trim() || workspace.project.script.trim(), segmentText)
          const updated = await this.repository.update(projectId, { script }, principal)
          if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
          return {
            script: updated.script,
            segment: segmentText,
            mode: 'segment' as const,
            warnings: segmentScriptIssues(segmentText, scriptMode),
          }
        }
        const generatedCandidate = await ensureChineseScriptOutput(
          this.textProvider!,
          await this.textProvider!.generate({
            systemPrompt: withChineseScriptRules(generationSystemPrompt),
            userPrompt: scriptGenerationUserPrompt(scriptMode, projectContext, generationInstruction, source),
            maxOutputTokens: scriptGenerationMaxOutputTokens(
              scriptMode,
              episodeSeconds,
              shouldExpandFromIdea,
              source,
            ),
            model,
            usageContext: usageContextForPrincipal(principal),
            ...(onTextProgress ? { onTextProgress } : {}),
            ...(onTextTiming ? { onTextTiming, timingLabel: 'first-draft' } : {}),
          }),
          model,
          onTextTiming,
          onTextProgress ? (text: string) => onTextProgress(text, 'language-repair') : undefined,
        )
        let candidate = structuredSource
          ? alignEnrichedSceneRows(source, generatedCandidate)
          : generatedCandidate
        if (enforceWebSeriesSceneBudget && countStructuredScenes(candidate) < sceneBudget.minimum) {
          const existingCandidate = candidate
          const existingSceneCount = countStructuredScenes(existingCandidate)
          const missingMinimum = Math.max(1, sceneBudget.minimum - existingSceneCount)
          const missingTarget = Math.max(missingMinimum, sceneBudget.target - existingSceneCount)
          const missingMaximum = Math.max(missingTarget, sceneBudget.maximum - existingSceneCount)
          const continuation = await this.textProvider!.generate({
            systemPrompt: withChineseScriptRules(WEB_SERIES_SCRIPT_SYSTEM_PROMPT),
            userPrompt: `${projectContext}\n\n首轮已经生成 ${existingSceneCount} 个可识别场次，低于单集最低 ${sceneBudget.minimum} 场。保留首轮内容，不要重复或改写；请从其动作终点继续，只输出后续 ${missingMinimum} 到 ${missingMaximum} 个新场次，建议 ${missingTarget} 个，使本集达到 ${sceneBudget.minimum} 到 ${sceneBudget.maximum} 场并在最后形成明确钩子。新场次逐行完整包含场次、剧情、场景、角色、动作、对白、风格、构图、光影、运镜、衔接字段。\n\n用户原始素材：\n${source}\n\n已经生成的首轮内容：\n${existingCandidate}`,
            maxOutputTokens: Math.min(webSeriesMaxOutputTokens(), Math.max(600, missingTarget * 220)),
            model,
            usageContext: usageContextForPrincipal(principal),
            ...(onTextProgress
              ? {
                  onTextProgress: (text: string) =>
                    onTextProgress(appendScriptSegment(existingCandidate, text), 'scene-completion'),
                }
              : {}),
            ...(onTextTiming ? { onTextTiming, timingLabel: 'scene-completion' } : {}),
          })
          const normalizedContinuation = await ensureChineseScriptOutput(
            this.textProvider!,
            continuation,
            model,
            onTextTiming,
            onTextProgress
              ? (text: string) =>
                  onTextProgress(appendScriptSegment(existingCandidate, text), 'language-repair')
              : undefined,
          )
          candidate = appendScriptSegment(existingCandidate, normalizedContinuation)
        }
        const contentSceneBudget = scriptContentSceneBudget(scriptMode, episodeSeconds)
        const shouldRepairContentStructure =
          shouldExpandFromIdea &&
          scriptMode !== 'web-series' &&
          scriptMode !== 'short-video' &&
          countStructuredScenes(candidate) < contentSceneBudget.minimum
        if (shouldRepairContentStructure) {
          const repaired = await this.textProvider!.generate({
            systemPrompt: withChineseScriptRules(scriptGenerationSystemPrompt(scriptMode, true)),
            userPrompt: scriptStructureRepairPrompt(
              scriptMode,
              projectContext,
              source,
              candidate,
              episodeSeconds,
              contentSceneBudget,
            ),
            maxOutputTokens: scriptGenerationMaxOutputTokens(scriptMode, episodeSeconds, true, source),
            model,
            usageContext: usageContextForPrincipal(principal),
            ...(onTextProgress
              ? { onTextProgress: (text: string) => onTextProgress(text, 'structure-repair') }
              : {}),
            ...(onTextTiming ? { onTextTiming, timingLabel: 'structure-repair' } : {}),
          })
          candidate = await ensureChineseScriptOutput(
            this.textProvider!,
            repaired,
            model,
            onTextTiming,
            onTextProgress ? (text: string) => onTextProgress(text, 'language-repair') : undefined,
          )
        }
        candidate = completeWebSeriesSpokenContent(candidate, scriptMode)
        assertRequestedSceneCount(source, candidate)
        assertWebSeriesDialogueCoverage(candidate, scriptMode)
        if (enforceWebSeriesSceneBudget && countStructuredScenes(candidate) < sceneBudget.minimum) {
          throw new AppError(
            502,
            'PROVIDER_RESPONSE_TRUNCATED',
            `文本服务返回不完整：本集至少需要 ${sceneBudget.minimum} 个场次，实际只返回 ${countStructuredScenes(candidate)} 个；原剧本未被覆盖，请重试或切换模型`,
          )
        }
        if (
          shouldExpandFromIdea &&
          scriptMode !== 'web-series' &&
          scriptMode !== 'short-video' &&
          countStructuredScenes(candidate) < contentSceneBudget.minimum
        ) {
          throw new AppError(
            502,
            'PROVIDER_RESPONSE_TRUNCATED',
            `${scriptModeDisplayName(scriptMode)}生成结果不完整：目标 ${formatDuration(episodeSeconds)} 至少需要 ${contentSceneBudget.minimum} 个可识别段落，模型只返回 ${countStructuredScenes(candidate)} 个；原内容未被覆盖，请重试或切换模型`,
          )
        }
        const script = candidate
        const warnings = quickScriptIssues(script, scriptMode, episodeSeconds)
        if (hasEpisodeWorkspace && scriptMode === 'web-series') {
          const episode = await this.repository.writeScriptEpisodeDraft(
            projectId,
            episodeId ?? null,
            script,
            principal,
          )
          if (!episode) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
          return { script, episode, mode: 'quick' as const, warnings }
        }
        const updated = await this.repository.update(projectId, { script }, principal)
        if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
        return { script: updated.script, mode: 'quick' as const, warnings }
      },
      billingMode,
    )
  }

  async enrichScript(
    projectId: string,
    script: string,
    direction: ScriptCreativeDirection,
    productionMode: GenerateScriptRequest['productionMode'],
    episodeMinutes: GenerateScriptRequest['episodeMinutes'],
    clientRequestId: string,
    principal: Principal,
    model: ScriptModel = DEFAULT_SCRIPT_MODEL,
    revisionNote = '',
    billingMode: ScriptBillingMode = 'direct',
    episodeDurationSeconds = episodeMinutes * 60,
    onTextProgress?: (text: string, stage?: string) => void,
    onTextTiming?: (timing: TextGenerationTiming) => void,
    episodeId?: string,
  ) {
    const workspace = await this.workspace(projectId, principal)
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')
    const scriptMode = resolveScriptContentMode(workspace.project.contentType, productionMode)
    const hasEpisodeWorkspace = Array.isArray(workspace.scriptEpisodes)
    const scriptEpisodes = workspace.scriptEpisodes ?? []
    const targetEpisode = episodeId ? scriptEpisodes.find((episode) => episode.id === episodeId) : undefined
    if (hasEpisodeWorkspace && scriptMode === 'web-series' && !targetEpisode) {
      throw new AppError(404, 'SCRIPT_EPISODE_NOT_FOUND', '请先打开需要改写的剧集')
    }
    const source =
      script.trim() ||
      targetEpisode?.draftContent.trim() ||
      targetEpisode?.content.trim() ||
      workspace.project.script.trim()
    if (!source)
      throw new AppError(400, 'SCRIPT_REQUIRED', `请先生成或填写${scriptModeDisplayName(scriptMode)}`)
    const episodeSeconds = normalizeScriptDurationSeconds(
      episodeDurationSeconds,
      episodeMinutes * 60,
      scriptMode,
    )

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n项目简介：${workspace.project.synopsis.trim() || '未填写'}\n画面比例：${workspace.project.aspectRatio}\n制作模式：${scriptModeContext(scriptMode, episodeSeconds)}\n当前选择模型：${model}\n创作方向（兼容已有设置）：${directionSummary(direction)}\n已确认项目资产：${assetSummary(workspace.assets)}\n本次改写要求：${revisionNote.trim() || '无，按默认制作规范处理'}`
    return this.runBillableScriptOperation(
      principal,
      `script-enrich-${clientRequestId}`,
      SCRIPT_OPERATION_CREDITS.enrich,
      scriptDetailOperationLabel(scriptMode),
      async () => {
        const candidate = await ensureChineseScriptOutput(
          this.textProvider!,
          await this.textProvider!.generate({
            systemPrompt: withChineseScriptRules(scriptDetailSystemPrompt(scriptMode)),
            userPrompt: scriptDetailUserPrompt(scriptMode, projectContext, source),
            maxOutputTokens: isProtectedLongScript(source)
              ? longScriptMaxOutputTokens(source)
              : SCRIPT_DETAIL_MAX_TOKENS,
            model,
            usageContext: usageContextForPrincipal(principal),
            ...(onTextProgress ? { onTextProgress } : {}),
            ...(onTextTiming ? { onTextTiming, timingLabel: 'rewrite' } : {}),
          }),
          model,
          onTextTiming,
          onTextProgress ? (text: string) => onTextProgress(text, 'language-repair') : undefined,
        )
        const candidateWithBreaks = preserveScriptBreakMarkers(source, candidate)
        let sceneAlignedCandidate = alignEnrichedSceneRows(source, candidateWithBreaks)
        sceneAlignedCandidate = completeWebSeriesSpokenContent(sceneAlignedCandidate, scriptMode)
        assertWebSeriesDialogueCoverage(sceneAlignedCandidate, scriptMode)
        const preserved = isProtectedLongScript(source) && candidateIsTooShort(source, sceneAlignedCandidate)
        const enriched = preserved ? source : sceneAlignedCandidate
        const warnings = preserved
          ? ['检测到长篇原稿，AI 输出过短，系统已自动保留原稿，避免剧情被压缩。']
          : detailedScriptIssues(enriched, scriptMode, episodeSeconds)
        if (hasEpisodeWorkspace && scriptMode === 'web-series') {
          const episode = await this.repository.writeScriptEpisodeDraft(
            projectId,
            targetEpisode!.id,
            enriched,
            principal,
          )
          if (!episode) throw new AppError(404, 'SCRIPT_EPISODE_NOT_FOUND', '剧集不存在或无权修改')
          return { script: enriched, episode, mode: 'detailed' as const, warnings }
        }
        const updated = await this.repository.update(projectId, { script: enriched }, principal)
        if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
        return { script: updated.script, mode: 'detailed' as const, warnings }
      },
      billingMode,
    )
  }

  async reviewScript(
    projectId: string,
    script: string,
    direction: ScriptCreativeDirection,
    clientRequestId: string,
    principal: Principal,
    model: ScriptModel = DEFAULT_SCRIPT_MODEL,
  ) {
    const workspace = await this.workspace(projectId, principal)
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
          userPrompt: `项目：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n画面比例：${workspace.project.aspectRatio}\n当前选择模型：${model}\n创作方向：${directionSummary(direction)}\n\n待审核剧本：\n${source}`,
          maxOutputTokens: 4_000,
          model,
          usageContext: usageContextForPrincipal(principal),
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
    billingMode: ScriptBillingMode = 'direct',
  ): Promise<T> {
    if (!this.creditLedger || billingMode === 'prepaid') return operation()
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
    await this.assertShotDurationForProject(projectId, input.duration, principal)
    if (typeof input.insertAfterShotId === 'string') {
      const workspace = await this.workspace(projectId, principal)
      if (!workspace.shots.some((shot) => shot.id === input.insertAfterShotId)) {
        throw new AppError(404, 'SHOT_INSERT_ANCHOR_NOT_FOUND', '插入位置对应的分镜不存在，请刷新后重试')
      }
    }
    const shot = await this.repository.createShot(projectId, input, principal)
    if (!shot) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
    return shot
  }

  async updateShot(projectId: string, shotId: string, input: UpdateShot, principal: Principal) {
    if (input.duration !== undefined) {
      await this.assertShotDurationForProject(projectId, input.duration, principal)
    }
    const shot = await this.repository.updateShot(projectId, shotId, input, principal)
    if (!shot) throw new AppError(404, 'SHOT_NOT_FOUND', '分镜不存在或无权修改')
    return shot
  }

  async deleteShot(projectId: string, shotId: string, principal: Principal) {
    const outcome = await this.repository.deleteShot(projectId, shotId, principal)
    if (outcome === 'active') {
      throw new AppError(409, 'SHOT_GENERATION_ACTIVE', '这个分镜仍在排队、暂停或生成中，请先处理生成任务')
    }
    if (outcome === 'not_found') {
      throw new AppError(404, 'SHOT_NOT_FOUND', '分镜不存在或无权删除')
    }
  }

  private async assertShotDurationForProject(projectId: string, duration: number, principal: Principal) {
    const workspace = await this.workspace(projectId, principal)
    if (workspace.project.contentType !== 'short-drama' && duration < 4) {
      throw new AppError(
        400,
        'SHOT_DURATION_INVALID',
        '3 秒分镜仅适用于网剧项目，短视频、广告和动画项目至少为 4 秒',
      )
    }
  }

  async generateShots(projectId: string, input: GenerateShotsRequest, principal: Principal) {
    const workspace = await this.workspace(projectId, principal)
    if (workspace.project.contentType === 'short-drama' && workspace.scriptEpisodes?.length) {
      const savedEpisodes = workspace.scriptEpisodes.filter(
        (episode) => episode.status === 'saved' && episode.content.trim(),
      )
      const selectedEpisodes = input.episodeId
        ? savedEpisodes.filter((episode) => episode.id === input.episodeId)
        : savedEpisodes
      if (!selectedEpisodes.length) {
        throw new AppError(
          400,
          'SCRIPT_EPISODE_REQUIRED',
          input.episodeId ? '该集尚未保存，请先保存本集' : '请先保存至少一集剧本',
        )
      }
      const orderedSavedEpisodes = [...savedEpisodes].sort(
        (left, right) => left.episodeNumber - right.episodeNumber,
      )
      const generated = selectedEpisodes.flatMap((episode) => {
        const paragraphs = expandLongScriptParagraphs(splitScriptParagraphs(episode.content))
        const shots =
          input.mode === 'beat'
            ? splitScriptIntoBeatShots(paragraphs, input.maxShots, true)
            : splitScriptIntoSmartSceneShots(paragraphs, input.maxShots, true)
        const previousEpisode = orderedSavedEpisodes
          .filter((candidate) => candidate.episodeNumber < episode.episodeNumber)
          .at(-1)
        return shots.map((shot, index) => ({
          ...shot,
          scriptEpisodeId: episode.id,
          episodeBreakBefore: index === 0 && episode.episodeNumber > 1,
          continuityMode: index === 0 ? ('independent' as const) : shot.continuityMode,
          continuityNote:
            index === 0
              ? episodeOpeningContinuityNote(previousEpisode, episode, shot.continuityNote)
              : shot.continuityNote,
          episodeNumber: episode.episodeNumber,
          episodeTitle: episode.title,
          episodeKind: 'standard' as const,
        }))
      })
      if (input.episodeId) {
        return this.repository.replaceEpisodeShots(projectId, selectedEpisodes[0]!, generated, principal)
      }
      return this.repository.replaceShots(projectId, generated, principal)
    }
    const source = workspace.project.script.trim()
    if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先填写剧本')

    const paragraphs = expandLongScriptParagraphs(splitScriptParagraphs(source))
    const isWebSeries = workspace.project.contentType === 'short-drama'
    const shots =
      input.mode === 'beat'
        ? splitScriptIntoBeatShots(paragraphs, input.maxShots, isWebSeries)
        : splitScriptIntoSmartSceneShots(paragraphs, input.maxShots, isWebSeries)
    return this.repository.replaceShots(
      projectId,
      assignShotEpisodes(
        shots.map((shot) => ({ ...shot, scriptEpisodeId: null })),
        input.episodeDurationSeconds,
      ),
      principal,
    )
  }

  async autoSplitShotEpisodes(projectId: string, input: AutoSplitShotsRequest, principal: Principal) {
    const workspace = await this.workspace(projectId, principal)
    const assigned = assignShotEpisodes(workspace.shots, input.episodeDurationSeconds)
    const updated = await this.repository.updateShotEpisodes(
      projectId,
      assigned.map(({ id, episodeNumber, episodeTitle, episodeKind, continuityMode, continuityNote }) => ({
        id,
        episodeNumber,
        episodeTitle,
        episodeKind,
        continuityMode,
        continuityNote: continuityNote ?? '',
      })),
      principal,
    )
    if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
    return updated
  }
}

function usageContextForPrincipal(principal: Principal) {
  return {
    tenantId: principal.tenantId,
    organizationId: principal.organizationId ?? principal.tenantId,
    userId: principal.userId,
  }
}

function episodeContinuationContext(episodes: ScriptEpisode[]): string {
  const ordered = [...episodes].sort((left, right) => left.episodeNumber - right.episodeNumber)
  const latest = ordered.at(-1)
  const history = ordered
    .slice(0, -1)
    .map(
      (episode) =>
        `第 ${episode.episodeNumber} 集摘要：${episode.summary || episode.content.replace(/\s+/g, ' ').slice(0, 500)}`,
    )
    .join('\n')
  return [
    '以下内容是连续网剧的前情上下文。只生成下一集，不得复述旧集。',
    history ? `历史集摘要：\n${history}` : '',
    latest ? `上一集全文：\n${latest.content}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function assignShotEpisodes<
  T extends {
    duration: number
    episodeKind?: 'standard' | 'hook'
    episodeBreakBefore?: boolean
    continuityMode?: 'independent' | 'continue'
    continuityNote?: string
  },
>(
  shots: T[],
  targetDurationSeconds: GenerateShotsRequest['episodeDurationSeconds'],
): Array<
  T & {
    episodeNumber: number
    episodeTitle: string
    episodeKind: 'standard' | 'hook'
  }
> {
  let episodeNumber = 1
  let episodeDuration = 0
  let breakAfterHook = false

  return shots.map((input) => {
    const isHook = input.episodeKind === 'hook'
    const startsNewEpisode = (input.episodeBreakBefore || breakAfterHook) && episodeDuration > 0
    const exceedsDuration =
      !isHook && episodeDuration > 0 && episodeDuration + input.duration > targetDurationSeconds

    if (startsNewEpisode || exceedsDuration) {
      episodeNumber += 1
      episodeDuration = 0
    }

    const isFirstShotInEpisode = episodeDuration === 0
    episodeDuration += input.duration
    breakAfterHook = isHook

    return {
      ...input,
      episodeNumber,
      episodeTitle: `第 ${episodeNumber} 集`,
      episodeKind: isHook ? ('hook' as const) : ('standard' as const),
      // Episodes are separate production units and never inherit a prior episode's tail frame.
      continuityMode: isFirstShotInEpisode ? ('independent' as const) : (input.continuityMode ?? 'continue'),
      // Do not leave the previous episode's textual handoff attached to its first shot.
      continuityNote: isFirstShotInEpisode ? '' : input.continuityNote,
    }
  })
}

const SCRIPT_ASSET_SUGGESTIONS_SYSTEM_PROMPT = `你是中文 AI 视频项目的资产制片和美术统筹，负责从剧本中提取后续生成必须保持一致的核心资产。
硬性规格：
1. 只返回严格 JSON，不要 Markdown，不要代码块，不要解释。
2. 顶层对象必须包含 summary、assets。
3. assets 只允许包含 character、scene、prop、costume、brand 五类，不要包含 audio。
4. 每个资产只需包含 kind、name、description、visualNotes、reason、priority；character 可额外返回 attributes，其他可明确判断的属性也可放入 attributes。不要返回完整生产提示词、negativePrompt、项目风格、背景、构图和固定默认属性，这些由后端统一补齐。
5. priority 是 1 到 5 的整数，5 表示最高优先级。
6. 角色只保留推动主线或多次出现的人物，建议 1 到 4 个；场景只保留复用率高或制作成本高的地点，建议 1 到 4 个；道具只保留重要且会多次出现或承载剧情转折的物件，建议 1 到 5 个；服装只保留角色一致性需要的核心服装，建议 1 到 4 个；广告或片尾出现的品牌、Logo、产品标识建议 1 到 2 个。
7. 不要把一次性群众、背景摆件、普通环境装饰列成资产；不要重复已有资产。
8. name 只能写稳定、可复用的资产实体名称，长度建议 2 到 16 个中文字符；动作、情绪、时间、天气、对白、镜头描述和完整句子只能写进 description 或 visualNotes，绝不能写进 name。
9. 人物 name 只能使用剧本中的明确姓名或稳定身份称呼，例如“林川”“青云宗长老”“女剑客”“老船夫”；禁止使用“先神情紧张”“低头缩肩”“随后强装镇定”“站在”“走向”“看向”“等待”“说道”等动作或状态，也不要把一次性群众写成人物资产。
10. 场景 name 只能使用稳定地点，例如“青云宗山门广场”“边城药铺”“旧火车站三号站台”；禁止使用“清晨冷雾未散”“四周站满等待试炼的弟子”“石阶尽头立着测灵石”等时间、天气、人物活动或陈设描述。地点的空间、陈设、氛围和光线写进 description 或 visualNotes。
11. visualNotes 只写剧本能够证明的身份、外形、材质、颜色、年代、空间或品牌文字等关键视觉事实，保持一句到两句中文，不要重复固定生成规范。角色要区分人类和动物，动物不得使用人类年龄和性别词；服装只描述服装本身。
12. attributes 只返回剧本能够明确判断的字段，无法判断的字段不要猜测、不要返回。允许字段及枚举：
character.subjectType human/animal；gender male/female/unspecified；ageGroup child/teen/young/middle/senior；exactAge 数字或 null；ethnicity unspecified/east-asian/south-asian/southeast-asian/white/black/latino/middle-eastern/mixed/other；skinTone unspecified/fair/light/medium/tan/deep/dark；eyeColor unspecified/black/dark-brown/brown/hazel/green/blue/gray/amber；hairColor unspecified/black/dark-brown/brown/blonde/red/gray/white/other；species；anthropomorphic。
scene.space interior/exterior；sceneType city/street/residential/commercial/nature/ancient/industrial/fantasy；era ancient/recent/modern/future；time dawn/day/sunset/night；weather clear/cloudy/rain/snow/fog；mood warm/tense/mystery/romantic/epic/desolate。
prop.category weapon/vehicle/furniture/electronics/jewelry/food/daily/other；material wood/metal/glass/fabric/leather/ceramic/mixed；condition new/used/aged/damaged。
costume.audience male/female/unisex；category daily/formal/professional/uniform/ancient/ceremonial/fantasy/armor；season spring-summer/autumn-winter/all-season；design minimal/luxury/retro/future/chinese。
brand.brandType logo/wordmark/combination/product-mark；usage end-card/packaging/signage/interface/general；exactText 为必须准确显示的文字；palette 为品牌配色描述。
返回示例：
{"summary":"优先建立主角、核心场景和关键物件。","assets":[{"kind":"character","name":"女剑客","description":"贯穿主线的退隐女剑客。","visualNotes":"青年女性，克制冷静，古风武侠身份。","reason":"主角跨场出现，需要保持身份一致。","priority":5,"attributes":{"subjectType":"human","gender":"female","ageGroup":"young"}}]}`

const SCRIPT_ASSET_SUGGESTIONS_MIN_TOKENS = 2_800
const SCRIPT_ASSET_SUGGESTIONS_MAX_TOKENS = 4_000

const SCENE_PRODUCTION_RULES = `每个场次是一条可以直接交给分镜师和视频模型的制作记录，不要只写镜头语言，也不要用“氛围感”“人物展开”“镜头表现”等空泛占位语。
- 每个场次必须写清“谁想做什么→遇到什么阻力→发生什么可见变化→场尾留下什么结果或悬念”，剧情字段不能只复述故事梗概。
- 场景字段必须同时写稳定地点、时间、天气、空间布局、前中后景、可复用陈设和主光源；关键物件要写名称、所在位置、当前状态和由谁使用。
- 角色字段必须列出所有画面内角色，并为每个人写清主次、画面位置、朝向、视线、服装、当前表情、起始姿态和本镜反应；配角与背景角色不能只作为名单，必须有符合场景的动作或表情变化。
- 动作字段必须拆成 2 到 3 个可被摄像机看见的微节拍，用“动作1：…；动作2：…；动作3：…”分开；这些微节拍共同完成当前场次的一个核心事件，不代表新增场次，也不能把同一事件换词重复。每个微节拍写清主角起势、执行、一次表情或视线变化和结束姿态；配角、群演只做同步反应。
- 核心人物每 2 到 3 秒必须有一次可见的表情、视线、姿态或情绪状态变化；配角和背景角色也必须在对应节拍发生至少一次反应，这些变化必须落到动作或角色字段中，不能只写“情绪升级”。
- 对白字段按实际情况明确标记“[对白]角色：内容”“[画外音]内容”“[内心独白]角色：内容”或“[音效]内容”；优先写 1 到 2 句短而能推进冲突的发声内容，单句尽量 4 到 12 个中文字符、整场口播尽量不超过 24 个中文字符，禁止用长台词解释画面；没有人物对白时用简短画外音补充画面无法表达的信息，并写至少两种现场声音和人物反应，不能返回空白或“无声”。
- 风格字段写材质、色彩、角色与场景的统一规则；构图字段写景别、主体位置、视线方向、前中后景和画面重心；光影字段写主光方向、软硬、色温、阴影落点；运镜字段写机位、运动方式、速度、跟随对象和结束画面。
- 每个场次都必须额外写清“目标：”“阻力：”“变化：”“入场状态：”“出场状态：”。目标是本场角色要完成的事；阻力是画面中实际发生的阻碍；变化是本场结束后不可逆的新信息、关系或情绪状态；入场状态必须可作为本场第一镜首帧，出场状态必须可作为本场最后一镜尾帧。
- 衔接字段必须同时写上一镜头尾帧如何接入本场，以及本场结尾把哪个人物位置、动作方向、视线、服装、物件状态或光线交给下一镜，禁止让每个镜头像独立照片。
- 不要凭空添加原稿没有的主要角色、关键道具或新空间规则；保持服装、位置、视线、光线和关键物件连续。
- 每一行都必须同时包含场次、剧情、目标、阻力、变化、场景、角色、入场状态、动作、对白、出场状态、风格、构图、光影、运镜、衔接，场次值使用 S01、S02 这样的稳定编号；每个场次尽量保持 320 到 560 个中文字符的信息密度，不能为了凑字数重复形容词。`

const FAST_WEB_SERIES_SCENE_RULES = `初稿只负责讲清剧情与表演，不要提前承担导演分镜层的工作。
- 每行只使用：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜衔接：；禁止输出风格、构图、光影、运镜、提示词、负面提示词或资产外观复述。
- 剧情字段用一句话压缩写清“目标→阻力→变化”；场景只写稳定地点与时间；角色只列本场实际出镜人物，不重复完整外貌和服装设定。
- 动作字段写一个核心事件和 2 个连续可见拍点，包含至少一次表情、视线或姿态变化，并以明确结束状态收尾；不要把一个场次塞入多个独立事件。
- 对白字段保留 1 到 2 句推动冲突的短对白、画外音或内心独白，单句尽量 4 到 12 个中文字符、整场口播不超过 24 个中文字符，并补一种必要的现场音或音乐提示；整集至少 3 个场次包含[画外音]，优先用于开场交代人物处境、换场补充必要信息和反转前制造预期，不复述已经看得见的动作。
- 衔接字段只写需要交给下一场的人物位置、动作方向、视线或关键物件状态，不重复上一场全文。
- 每场控制在 100 到 180 个中文字符，优先保证新信息、动作结果和对白，不用形容词凑字数。`

const ADVERTISEMENT_PRODUCTION_RULES = `每个广告段落是一条可直接交给分镜师和视频模型的制作记录，不要只写口号或抽象氛围。
- 每段必须写清“本段传播任务→观众看到的主体与动作→获得的核心信息→段尾画面结果”，屏幕文字必须给出确切内容与出现时机。
- 场景字段写清地点、时间、空间布局、前中后景、主体陈设和主光源；产品字段信息应写入剧情与动作，名称、位置、朝向、材质和使用状态保持一致。
- 人物不是必选项。纯产品、界面或场景广告应在角色字段明确写“无人物，主体为……”，禁止为了满足格式凭空增加模特；有人物时写清位置、朝向、表情、起始姿态和与产品的真实交互。
- 动作拆成 2 到 3 个可见微节拍，写清主体起始状态、运动过程、局部细节变化与结束状态；禁止用多个形容词替代实际动作。
- 对白字段按需要标记“[旁白]”“[对白]”“[音效]”“[音乐]”；开场、核心价值证明和落版段优先各写一句 6 到 18 个中文字符的短旁白，其余段落按画面需要使用短对白；无人声时可写“无旁白”，但必须给出现场音或设计音，不能返回空白。
- 构图写景别、主体位置、文字安全区域、前中后景和画面重心；光影写光源方向、软硬、色温、产品高光与阴影；运镜写机位、运动方式、速度、跟随主体和结束画面。
- 衔接字段必须写清产品状态、主体位置、运动方向、色彩、光线、声音或文字如何交给下一段，避免每段像互不相关的素材拼接。
- 每一行必须包含场次、剧情、场景、角色、动作、对白、风格、构图、光影、运镜、衔接，场次使用 A01、A02 等稳定编号；信息具体紧凑，不要重复口号凑字数。`

const QUICK_SCRIPT_SYSTEM_PROMPT = `你是中文漫剧的快速编剧。你的任务不是写长篇小说，而是把用户素材整理成 15 到 30 秒视频可以直接进入分镜的故事骨架。

硬性规格：
1. 输出 4 到 6 个场景，总长度约 1800 到 2600 个中文字符；每场都要成为可以继续拆成 2 到 3 个动作镜头的完整制作单元，不能用空泛描写凑字数。
2. 每个场景必须单独占一行，场景之间换行；不要输出标题、解释、Markdown 或分析。
3. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。
4. 剧情必须有明确目标、阻力、变化和结果；不要写空泛的“氛围感”“电影感”。
5. 动作必须是可以被摄像机看见的连续动作，明确谁在什么位置做什么，并包含至少 2 个动作拍点和一个结束姿态；不要只写心理活动。
6. 每场安排 1 到 2 句短、口语化且推动冲突的对白、画外音或内心独白，单句尽量 4 到 12 个中文字符、整场口播不超过 24 个中文字符；优先让人物互相回应，不用长旁白解释可见动作，同时写清必要音效和现场声音。
7. 场景之间必须保持人物、地点、时间、服装和关键物件连续；每一场都要推动主线。
8. 结尾留下一个清晰的悬念、决定或下一步动作，方便后续补齐专业视觉细节。
9. ${SCENE_PRODUCTION_RULES}

只输出 4 到 6 行剧本正文。`

const SCRIPT_REWRITE_SYSTEM_PROMPT = `你是中文漫剧的剧本整理编剧。输入是一份已经包含剧情信息的中文剧本或故事稿，长度在 1500 到 10000 字之间。你的任务是按原有逻辑重写成可直接进入资产设计和分镜的制作稿，而不是另写一个新故事。

硬性规格：
1. 保留原稿的核心剧情、人物关系、场景数量、时间地点、关键物件、对白和因果顺序；不得为了缩短输出而删除重要情节，也不得把一个场景压成一句话。
2. 场景数量、编号和顺序必须与原稿完全一致，不得新增、拆分、合并或删除场次；每个原场次只输出一行，只在该行内部补齐制作信息。
3. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；缺失字段要根据原稿上下文补齐，不要凭空新增角色或道具。
4. 剧情写清本场目标、阻力、变化和结果；角色写清画面位置、表情和姿态；动作写成至少 2 个摄像机能看见的连续动作；对白短而有信息量并标记对白类型。
5. 保留原稿已有的悬念、转折和结尾方向；原稿有“【强制下一集】”时必须独占一行并原样保留。
6. ${SCENE_PRODUCTION_RULES}
7. 只输出重写后的剧本正文，不要标题、解释、Markdown 或分析。`

const ADVERTISEMENT_SCRIPT_SYSTEM_PROMPT = `你是中文商业广告的创意总监、文案和导演。请把用户的一句话想法、品牌资料或产品资料扩写成可以直接进入资产设计、分镜和视频生成的广告制作脚本，而不是故事梗概、品牌介绍或普通剧情短片。

硬性规格：
1. 严格围绕用户指定的目标时长编排传播节奏，每行一个连续广告段落、对应一个可生成视频镜头；每行都要写明该段承担的传播任务和明确起止时间，例如“0-3秒抓住注意”“3-8秒展示核心价值”。
2. 使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。场次使用 A01、A02 等编号；剧情字段必须包含“时段、传播任务、核心信息、屏幕文字”，对白字段使用“[旁白]”“[对白]”“[音效]”“[音乐]”标记。
3. 开头 1 到 3 秒必须有可见的注意力抓点；品牌、产品、服务或核心对象应尽早出现，不能到结尾才首次展示。中段只证明一个核心价值，使用具体画面、动作、使用情境或前后变化，不要堆砌多个空泛卖点。
4. 最后一段必须完成品牌/产品清晰落版、核心文案和行动引导；行动引导应符合素材，例如“立即体验”“了解更多”，不得擅自添加购买链接、价格、优惠、认证、性能数据、代言或用户未提供的承诺。
5. 品牌名、产品名、标语和专有名词必须保持用户原文拼写；信息不足时使用真实可拍的体验表达，不得编造事实。广告语简短、可读、可配音，避免长篇解释。
6. 每段画面都要能独立制作且与前后段连续：产品状态、角色位置、服装、光线、文字层级和运动方向不能跳变；人物只在传播需要时出现，不要为了“像剧情”虚构无关冲突。
7. 广告不是网剧：不要生成分集钩子、受辱反击、悬念续集或完整人物成长线，除非用户素材明确要求剧情广告。
8. ${ADVERTISEMENT_PRODUCTION_RULES}
9. 只输出广告脚本正文，不要标题、创意阐释、Markdown、表格、JSON 或分析。`

const ADVERTISEMENT_REWRITE_SYSTEM_PROMPT = `你是中文商业广告的创意总监和制作脚本统筹。请把已有广告想法、文案或脚本重写成可直接进入资产设计、分镜和视频生成的广告制作稿。

硬性规格：
1. 保留品牌名、产品名、已有事实、核心卖点、受众、语气、画面顺序、现有文案和行动引导，不得编造价格、优惠、认证、性能数据、代言或用户未提供的承诺。
2. 原稿已按场次组织时，场次数量、编号和顺序必须完全一致，只在原段落内补齐；原稿未结构化时，按目标时长重组为连续广告段落。
3. 每行使用：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。剧情字段写明时段、传播任务、核心信息、屏幕文字；对白字段标记旁白、对白、音效和音乐。
4. 开头快速抓住注意，中段用可见证据证明一个核心价值，结尾清晰落版并给出合适的行动引导；产品或品牌不能只在末尾突然出现。
5. 删除重复口号和空泛形容词，但不能把广告压缩成一句品牌简介；每段必须有具体可见动作和画面结果。
6. ${ADVERTISEMENT_PRODUCTION_RULES}
7. 只输出重写后的广告脚本正文，不要解释、Markdown、表格、JSON 或分析。`

const SHORT_FILM_SCRIPT_SYSTEM_PROMPT = `你是中文叙事短片的编剧、导演和剪辑统筹。请把用户的一句话想法或已有素材扩写成一个有完整起承转合、可以直接进入资产设计、分镜和视频生成的独立短片，不要写成广告、网剧单集、小说梗概或续集预告。

硬性规格：
1. 严格围绕用户指定的目标时长倒推场次数量，每行一个连续场次、对应一个可生成视频镜头；开场建立人物处境与目标，中段出现可见阻力和转折，结尾完成情节与情绪落点。
2. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。剧情字段要写明本场时段、叙事任务、目标、阻力、变化和结果。
3. 动作、对白、画外音、内心独白、现场音和音乐只保留能推进人物目标或情绪变化的信息；不要用空镜、旁白总结或重复动作填时长。
4. 每场都要交付新的信息、关系或状态变化，并清楚承接上一场的人物位置、视线、服装、物件和声音；转折必须由前文行动造成，不能突然新增人物、能力或规则。
5. 结尾应完成独立短片的情节回收或情绪余韵，不强制制造“下一集”钩子，不得擅自加入品牌落版、广告语或行动引导。
6. ${SCENE_PRODUCTION_RULES}
7. 只输出短片剧本正文，不要标题、解释、Markdown、表格、JSON 或分析。`

const SHORT_FILM_REWRITE_SYSTEM_PROMPT = `你是中文叙事短片的剧本编辑和分镜前置统筹。请在不改变原作核心表达的前提下，把已有故事或剧本整理成目标时长内可制作的完整独立短片。

硬性规格：
1. 保留人物关系、故事因果、地点、时间、关键物件、重要对白、转折和结局方向；不得压成提纲，也不要扩成网剧或广告。
2. 原稿已按场次组织时，场次数量、编号和顺序必须完全一致，不得新增、拆分、合并或删除场次；只在原场次内部补齐制作信息。
3. 每行使用：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；剧情写明时段、叙事任务、目标、阻力、变化和结果。
4. 强化“建立处境→行动受阻→选择或转折→结果与情绪落点”的完整闭环；不要强行保留续集钩子，也不要加入品牌文案和行动引导。
5. ${SCENE_PRODUCTION_RULES}
6. 只输出重写后的短片剧本正文，不要解释、Markdown、表格、JSON 或分析。`

const WEB_SERIES_SCRIPT_SYSTEM_PROMPT = `你是中文网剧漫剧的主编剧和短视频导演。请把用户素材写成一集可以直接进入分镜制作的网剧剧本，不要写成长篇小说或提纲。

硬性规格：
1. 本次只生成 1 集，不生成多集，不按分钟凑字数。全篇输出 6 到 8 个场次，建议 7 个；总长度控制在约 700 到 1100 个中文字符，已经讲清就停止，不要为了接近上限灌水。每个场次是一个可继续拆分镜的视频制作单元，不要用空镜填充内容。
2. 每行一个场次、对应一个视频镜头；从 S01 正文直接开始，不要先写创作说明、人物小传或全剧摘要。
3. 每场都要有可拍摄的目标、阻力、变化和结果，动作明确到人物位置、视线、表情、手部或关键物件状态；每个动作单元只完成一个核心事件，并明确主角和必要配角各自做什么。
4. 保持人物身份、服装、时间、地点、光线和关键物件连续；每场都写清场内角色与物件的相对位置，不要突然新增人物、道具或空间规则。
5. 前段快速建立冲突，中段持续升级，后段制造明显波动；最后一行的场次值必须写“剧情钩子”，且不直接解决。
6. 钩子可以是秘密即将揭示、主角受辱后即将反击、关键物件即将启动、敌人误判实力或即将进入反转/装逼时刻；必须停在动作或悬念接点。
7. 对白必须真正可听见并推动本场冲突：每个场次必须写 1 到 2 句短对白、画外音或内心独白，使用“[对白]角色：内容”“[画外音]内容”“[内心独白]角色：内容”标记；单句尽量 4 到 12 个中文字符、整场口播不超过 24 个中文字符，禁止写“无台词”。6 到 8 场的整集中至少 3 场包含[画外音]：S01 用一句介绍人物处境，中段换场时补充画面无法表达的信息，反转前一句建立预期；画外音不能复述可见动作。人物同场对峙时优先使用两句一问一答或一压一顶的短对白。每场另写至少一种[音效]或[音乐/环境声]，不能返回空白或静音。
8. ${FAST_WEB_SERIES_SCENE_RULES}
9. 只输出剧本正文，不要标题、解释、Markdown 或分析。`

const WEB_SERIES_REWRITE_SYSTEM_PROMPT = `你是中文网剧漫剧的连续剧编剧和分镜前置统筹。输入是一份 1500 到 10000 字的已有剧本，必须在不改变原剧情的前提下重写整理为可制作的网剧剧本。

硬性规格：
1. 保留原稿的场景顺序、人物关系、对白、地点、时间、服装、关键物件和剧情因果；不得压缩成提纲或删除重要情节，不得把动作和对白合并成一句概括。
2. 场景数量、编号和顺序必须与原稿完全一致，不得新增、拆分、合并或删除场次；每个原场次单独占一行并对应一个 4 到 15 秒视频镜头，场内动作只作为该镜头的微节拍。
3. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；缺失字段根据已有上下文补齐，不要任意新增人物、道具或空间规则。
4. 每场都要有目标、阻力、变化和结果，动作明确到人物位置、视线、表情、手部或关键物件状态，并保持镜头之间的连续性；缺失信息要从原稿上下文恢复，不要用“沿用上一场”代替具体状态。
5. 对白不能被压缩成“无台词”：每个场次必须有 1 到 2 句可听见的[对白]、[画外音]或[内心独白]，单句尽量 4 到 12 个中文字符、整场口播不超过 24 个中文字符，并且台词要改变人物选择、关系或信息；整集至少 3 场保留或补充[画外音]，分别承担开场介绍、必要转场信息和反转预期，不得复述画面；每场同时写[音效]和[环境声]，不得出现静音场次。
6. 结尾保留并强化原稿的高波动钩子；如果原稿存在“【强制下一集】”，必须独占一行并原样保留。
7. ${SCENE_PRODUCTION_RULES}
8. 只输出重写后的剧本正文，不要标题、解释、Markdown 或分析。`

const SCRIPT_DETAIL_SYSTEM_PROMPT = `你是中文漫剧的视觉导演和分镜前置编剧。请把快速剧本补齐为可直接用于资产设计、分镜和视频生成的制作级剧本。

硬性规格：
1. 保留原剧本的场景数量、人物、地点、关键物件、剧情因果和对白，不要另起炉灶，不要扩展成新的长故事；优先补齐能被摄像机执行的信息。
2. 每个场景必须单独占一行，场景之间换行；不要输出标题、解释、Markdown 或分析。
3. 在每个场次内完整保留并补齐：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；禁止只返回风格、构图、光影或运镜。
4. 剧情写清本场目标、阻力、转折和结果；动作拆成 2 到 3 个可见拍点，写清起势、过程、结束姿态、表情变化以及与环境或物件的互动。
5. 风格必须落实项目选择的视觉类型、材质和色彩；构图必须写景别、主体位置、前中后景和画面重心。
6. 光影必须写主光来源、方向、软硬、色温和明暗关系；运镜必须写机位、运动方式、速度、运动对象和结束画面。
7. 衔接必须说明承接上一场的时间、动作、视线、人物位置或物件状态，并给下一场留下明确动作接点。
8. 所有视觉内容必须服务于原剧情，禁止添加新的角色、道具、回忆、梦境或突然转场；原稿中的“【强制下一集】”必须独占一行并原样保留。
9. ${SCENE_PRODUCTION_RULES}

只输出补齐后的剧本正文。`

const ADVERTISEMENT_DETAIL_SYSTEM_PROMPT = `你是中文商业广告的导演、摄影指导、文案和声音设计。请在不改变广告事实与传播策略的前提下，把现有广告脚本补齐为可直接分镜和视频生成的制作稿。
1. 场次数量、编号、时段顺序、品牌名、产品名、核心卖点、屏幕文字、旁白和行动引导必须保留；不得擅自添加价格、优惠、认证、性能数据或代言。
2. 每行完整输出：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；剧情明确时段、传播任务、核心信息和屏幕文字，对白明确旁白、对白、音效与音乐。
3. 补齐产品展示角度、材质细节、使用动作、文字安全区域、品牌识别时机、光影与运镜；所有视觉选择必须服务一个核心传播信息。
4. 开头注意力抓点、中段可见证明和结尾品牌落版必须连贯，不能补成普通剧情短片或网剧钩子。
5. ${ADVERTISEMENT_PRODUCTION_RULES}
只输出补齐后的广告脚本正文。`

const SHORT_FILM_DETAIL_SYSTEM_PROMPT = `你是中文叙事短片的导演、摄影指导、剪辑和声音设计。请在不改变原剧情的前提下，把短片补齐成可直接分镜和视频生成的制作稿。
1. 保留原有场次、人物、地点、关键物件、对白、因果、转折和结尾，不扩写成广告或连续网剧。
2. 每行完整输出：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；剧情明确时段、叙事任务、目标、阻力、变化和结果。
3. 补齐人物表演节拍、配角反应、现场音、音乐进入/退出点、构图、光影、运镜和转场落点；每一项都要服务人物行动与情绪变化。
4. 场间保持人物位置、视线、服装、物件、环境和声音连续，结尾完成情节回收或情绪落点，不强加下一集钩子或品牌行动引导。
5. ${SCENE_PRODUCTION_RULES}
只输出补齐后的短片剧本正文。`

const WEB_SERIES_DETAIL_SYSTEM_PROMPT = `你是中文网剧漫剧的视觉导演、分镜导演和连续性统筹。请在不改变原剧情的前提下，把剧本补齐为可制作的网剧分镜前置稿。

硬性规格：
1. 保留原有场次、人物、对白、地点、关键物件和剧情因果，不压缩长稿，不另起新故事；每个动作单元都必须提供足够的角色和空间状态。
2. 每个场次完整输出：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；禁止只输出镜头语言字段。每场对应一个视频镜头，以 4 到 5 秒快切为主，必要时延长到 15 秒；每行都要写清可见动作和动作终点。
3. 对白字段必须补齐 1 到 2 句可听见的[对白]、[画外音]或[内心独白]，单句尽量 4 到 12 个中文字符、整场口播不超过 24 个中文字符；整集至少 3 场有简短[画外音]，用于开场介绍、必要转场信息和反转预期，不能复述画面；每个场次都不能写“无台词”，每场同时补充[音效]和[环境声/音乐]，确保视频不是无声空镜。
4. 风格写明材质、色彩和角色/场景的一致性；构图写景别、主体位置、前中后景和视线方向；光影写光源、方向、色温和明暗关系；运镜写机位、移动方式、速度、运动对象和落点。
5. 衔接必须写清上一镜尾帧如何接入本镜，以及本镜如何把人物位置、动作、视线、服装、物件和光线交给下一镜，避免镜头像独立照片。
6. 最后一个场次保留并强化高波动钩子，不提前揭示结果；原稿中的“【强制下一集】”必须独占一行并原样保留；不要增加拍摄设备、文字、水印或无关人物。
7. ${SCENE_PRODUCTION_RULES}
只输出补齐后的剧本正文。`

const SCRIPT_INITIAL_EXPANSION_THRESHOLD = 1_500
const SINGLE_REWRITE_MAX_LENGTH = 10_000
const INITIAL_SCRIPT_MAX_TOKENS = 4_800
const SCRIPT_DETAIL_MAX_TOKENS = 4_000
const LONG_SCRIPT_MAX_TOKENS = 16_000
const CHINESE_SCRIPT_OUTPUT_RULES = `语言硬约束：
- 所有面向用户的场次名称、剧情、场景、角色、动作、对白、风格、构图、光影、运镜和衔接内容必须使用简体中文。
- 除人物或地点的既有外文专名以及 AI、CG、2D、3D、Alpha 等行业缩写外，禁止输出英文标题、英文句子或中英混写的动作描述。
- 不要把内部推理、英文动作草稿、英文镜头术语或翻译过程写进剧本正文。`

const CHINESE_SCRIPT_REPAIR_SYSTEM_PROMPT = `你是中文剧本格式校对员。输入是一份混入英文的剧本结果，请只做语言与格式修复：
1. 把所有英文标题、英文句子、英文动作描述和英文镜头术语准确改写为自然的简体中文。
2. 人物、地点、物件、剧情因果、场次数量、场次编号、字段顺序、动作数量、对白含义和强制分集/分镜标记必须保持不变。
3. AI、CG、2D、3D、Alpha 以及原稿中的既有外文专名可以保留；不要增加剧情、解释、标题、Markdown 或 JSON。
4. 只输出修复后的完整剧本正文。`

function webSeriesMaxOutputTokens(_episodeSeconds = 0): number {
  return 1_500
}

function webSeriesSceneBudget(_episodeSeconds = 0): {
  minimum: number
  target: number
  maximum: number
} {
  return { minimum: 6, target: 7, maximum: 8 }
}

type ScriptSceneBudget = ReturnType<typeof webSeriesSceneBudget>

function resolveScriptContentMode(
  contentType: string,
  productionMode: GenerateScriptRequest['productionMode'],
): ScriptContentMode {
  if (contentType === 'advertisement') return 'advertisement'
  if (contentType === 'animation') return 'short-film'
  if (contentType === 'short-drama' && productionMode === 'web-series') return 'web-series'
  return productionMode
}

function scriptModeDisplayName(mode: ScriptContentMode): string {
  if (mode === 'advertisement') return '广告脚本'
  if (mode === 'short-film') return '短片剧本'
  if (mode === 'web-series') return '网剧剧本'
  return '快速剧本'
}

function scriptModeContext(mode: ScriptContentMode, durationSeconds: number): string {
  if (mode === 'advertisement') return `广告创作模式，目标成片 ${formatDuration(durationSeconds)}`
  if (mode === 'short-film') return `短片创作模式，目标成片 ${formatDuration(durationSeconds)}`
  if (mode === 'web-series') return '网剧模式，按单集生产；本次只生成 1 集'
  return `短视频模式，目标成片 ${formatDuration(durationSeconds)}`
}

function scriptContentSceneBudget(mode: ScriptContentMode, durationSeconds: number): ScriptSceneBudget {
  if (mode === 'web-series') return webSeriesSceneBudget(durationSeconds)
  if (mode === 'advertisement') {
    return {
      minimum: Math.max(2, Math.min(40, Math.ceil(durationSeconds / 8))),
      target: Math.max(2, Math.min(48, Math.ceil(durationSeconds / 5))),
      maximum: Math.max(3, Math.min(60, Math.ceil(durationSeconds / 3))),
    }
  }
  if (mode === 'short-film') {
    return {
      minimum: Math.max(3, Math.min(60, Math.ceil(durationSeconds / 8))),
      target: Math.max(4, Math.min(80, Math.ceil(durationSeconds / 5))),
      maximum: Math.max(5, Math.min(100, Math.ceil(durationSeconds / 3))),
    }
  }
  return { minimum: 4, target: 5, maximum: 6 }
}

function scriptGenerationSystemPrompt(mode: ScriptContentMode, shouldExpandFromIdea: boolean): string {
  if (mode === 'advertisement') {
    return shouldExpandFromIdea ? ADVERTISEMENT_SCRIPT_SYSTEM_PROMPT : ADVERTISEMENT_REWRITE_SYSTEM_PROMPT
  }
  if (mode === 'short-film') {
    return shouldExpandFromIdea ? SHORT_FILM_SCRIPT_SYSTEM_PROMPT : SHORT_FILM_REWRITE_SYSTEM_PROMPT
  }
  if (mode === 'web-series') {
    return shouldExpandFromIdea ? WEB_SERIES_SCRIPT_SYSTEM_PROMPT : WEB_SERIES_REWRITE_SYSTEM_PROMPT
  }
  return shouldExpandFromIdea ? QUICK_SCRIPT_SYSTEM_PROMPT : SCRIPT_REWRITE_SYSTEM_PROMPT
}

function scriptGenerationInstruction(input: {
  scriptMode: ScriptContentMode
  sourceLength: number
  shouldExpandFromIdea: boolean
  episodeSeconds: number
  sourceHasStructuredScene: boolean
  sceneBudget: ScriptSceneBudget
}): string {
  const { scriptMode, sourceLength, shouldExpandFromIdea, episodeSeconds, sourceHasStructuredScene } = input
  const budget =
    scriptMode === 'web-series' ? input.sceneBudget : scriptContentSceneBudget(scriptMode, episodeSeconds)
  const durationRule =
    scriptMode === 'web-series'
      ? `本次只生成 1 集，输出 ${budget.minimum} 到 ${budget.maximum} 个可识别场次，建议 ${budget.target} 个；全篇约 700 到 1100 个中文字符，表达完整后立即停止；每行一个场次，不得把全部内容压成一段，也不要生成其他集。`
      : `目标成片时长 ${formatDuration(episodeSeconds)}，输出 ${budget.minimum} 到 ${budget.maximum} 个可识别场次/段落，建议 ${budget.target} 个；每行一个场次，不得把全部内容压成一段。`

  if (shouldExpandFromIdea) {
    if (scriptMode === 'advertisement') {
      return `当前素材仅 ${sourceLength} 字，属于广告创意输入。必须主动推断合理的传播目标与核心对象，把它扩写成完整可执行广告，禁止原样复述或只润色这一句话。${durationRule}`
    }
    if (scriptMode === 'short-film') {
      return `当前素材仅 ${sourceLength} 字，属于短片创意输入。必须补全人物目标、可见阻力、因果转折和结尾情绪落点，形成完整独立短片，禁止原样复述或只生成故事梗概。${durationRule}`
    }
    if (scriptMode === 'web-series') {
      return `当前内容仅 ${sourceLength} 字。请根据用户想法、项目简介和已有资产，直接生成高信息密度网剧初稿；不要原样复述，也不要输出人物小传或导演说明。每场只保留剧情目标与阻力、角色、空间、两个可见动作拍点、推动冲突的短对白和场尾连续状态，视觉导演信息留给后续分镜层。${durationRule}`
    }
    return `当前内容仅 ${sourceLength} 字。请根据用户想法、项目简介和已有资产生成高信息密度制作剧本；如果原始内容是系统提示语，也要把它转化为具体剧情，不要原样复述。每个场次必须有明确角色、空间、动作拍点、对白类型和上下场衔接。`
  }

  const preserveRule = sourceHasStructuredScene
    ? '原稿已经按场次组织，输出场次数量、场次编号和顺序必须与原稿完全一致，只能在原场次内部补齐制作信息，不得新增、拆分或合并场次。'
    : durationRule
  if (scriptMode === 'advertisement') {
    return `当前广告素材约 ${sourceLength} 字。保留品牌事实、核心卖点、受众、语气、已有画面和文案，将其重写为目标时长内可制作的广告脚本；不得改成普通剧情片，也不得编造宣传承诺。${preserveRule}`
  }
  if (scriptMode === 'short-film') {
    return `当前短片素材约 ${sourceLength} 字。保留人物关系、核心事件、因果、转折与结局方向，将其重写为目标时长内有完整叙事闭环的短片制作稿；不要压成提纲，也不要加入广告落版或网剧钩子。${preserveRule}`
  }
  return `当前内容约 ${sourceLength} 字。请在保留核心剧情、人物关系、场景因果、关键物件和对白信息的前提下，按原有逻辑重写整理为制作级剧本；不要把内容压缩成提纲，不要任意删减重要情节。${preserveRule}`
}

function scriptGenerationUserPrompt(
  mode: ScriptContentMode,
  projectContext: string,
  generationInstruction: string,
  source: string,
): string {
  const request =
    mode === 'advertisement'
      ? '请把以下素材创作成可直接进入分镜的商业广告制作脚本'
      : mode === 'short-film'
        ? '请把以下素材创作成可直接进入分镜的完整独立短片'
        : mode === 'web-series'
          ? '请把以下素材改编成一集可制作的网剧剧本'
          : '请把以下素材改编成可直接进入分镜的快速剧本'
  return `${projectContext}\n\n${generationInstruction}\n${request}：\n${source}`
}

function scriptGenerationMaxOutputTokens(
  mode: ScriptContentMode,
  durationSeconds: number,
  shouldExpandFromIdea: boolean,
  source: string,
): number {
  if (mode === 'web-series') return webSeriesMaxOutputTokens()
  if (!shouldExpandFromIdea) return longScriptMaxOutputTokens(source)
  if (mode === 'advertisement') {
    return Math.min(12_000, Math.max(3_500, Math.ceil(durationSeconds / 30) * 3_000))
  }
  if (mode === 'short-film') {
    return Math.min(16_000, Math.max(4_500, Math.ceil(durationSeconds / 30) * 3_500))
  }
  return INITIAL_SCRIPT_MAX_TOKENS
}

function scriptStructureRepairPrompt(
  mode: ScriptContentMode,
  projectContext: string,
  source: string,
  candidate: string,
  durationSeconds: number,
  budget: ScriptSceneBudget,
): string {
  const modeRule =
    mode === 'advertisement'
      ? '必须形成“开场抓点→核心对象/问题→一个核心价值的可见证明→品牌落版与行动引导”的广告结构，并在剧情字段写明时间段、传播任务、核心信息和屏幕文字。'
      : '必须形成“建立人物处境与目标→可见阻力→因果转折→结果与情绪落点”的完整独立短片，不要加入广告落版或下一集钩子。'
  return `${projectContext}\n\n上一次结果只有 ${countStructuredScenes(candidate)} 个可识别段落，且可能只是复述用户输入，不可写回。请完整重写：目标时长 ${formatDuration(durationSeconds)}，必须输出 ${budget.minimum} 到 ${budget.maximum} 个场次/段落，建议 ${budget.target} 个；每行必须以“场次：”开始并包含全部制作字段。${modeRule}\n\n用户原始素材：\n${source}`
}

function scriptGenerationOperationLabel(mode: ScriptContentMode): string {
  if (mode === 'advertisement') return '智能生成广告脚本'
  if (mode === 'short-film') return '智能生成短片剧本'
  if (mode === 'web-series') return '智能生成网剧剧本'
  return '快速生成剧本'
}

function scriptSegmentOperationLabel(mode: ScriptContentMode): string {
  if (mode === 'advertisement') return '延长广告脚本'
  if (mode === 'short-film') return '续写短片'
  if (mode === 'web-series') return '续写下一集'
  return '生成下一段'
}

function scriptDetailOperationLabel(mode: ScriptContentMode): string {
  if (mode === 'advertisement') return '补齐广告制作细节'
  if (mode === 'short-film') return '补齐短片制作细节'
  return '补齐剧本专业视觉细节'
}

function scriptDetailSystemPrompt(mode: ScriptContentMode): string {
  if (mode === 'advertisement') return ADVERTISEMENT_DETAIL_SYSTEM_PROMPT
  if (mode === 'short-film') return SHORT_FILM_DETAIL_SYSTEM_PROMPT
  if (mode === 'web-series') return WEB_SERIES_DETAIL_SYSTEM_PROMPT
  return SCRIPT_DETAIL_SYSTEM_PROMPT
}

function scriptDetailUserPrompt(mode: ScriptContentMode, projectContext: string, source: string): string {
  const request =
    mode === 'advertisement'
      ? '请保留广告事实、传播结构、屏幕文字和行动引导，补齐产品展示、声音、光影、运镜及段落衔接'
      : mode === 'short-film'
        ? '请保留短片剧情因果、转折和结尾，补齐表演、声音、光影、运镜及场次衔接'
        : '请在保留原有场景数量、剧情因果、人物关系和对白的前提下，补齐制作字段与镜头衔接'
  return `${projectContext}\n\n${request}；本次改写要求必须优先执行：\n${source}`
}

function scriptSegmentSystemPrompt(mode: ScriptContentMode): string {
  if (mode === 'advertisement') return ADVERTISEMENT_SEGMENT_SYSTEM_PROMPT
  if (mode === 'short-film') return SHORT_FILM_SEGMENT_SYSTEM_PROMPT
  if (mode === 'web-series') return WEB_SERIES_SEGMENT_SYSTEM_PROMPT
  return SCRIPT_SEGMENT_SYSTEM_PROMPT
}

function scriptSegmentUserPrompt(
  mode: ScriptContentMode,
  projectContext: string,
  source: string,
  goal: string,
  segmentSeconds: number,
): string {
  const fallbackGoal =
    mode === 'advertisement'
      ? '补充新的使用场景或可见证明，并在结尾重新完成品牌落版'
      : mode === 'short-film'
        ? '顺着人物当前行动继续推进短片'
        : mode === 'web-series'
          ? '承接上一集钩子推进下一集'
          : '顺着现有剧情自然推进下一段'
  const finalInstruction =
    mode === 'advertisement'
      ? '请只输出追加的广告段落，不要重写已有广告。'
      : mode === 'short-film'
        ? '请只输出续写的新场次，不要重写已有短片。'
        : '请只生成下一段剧本正文，不要重写已有内容。'
  const segmentBudget =
    mode === 'web-series'
      ? '本次只生成 1 个下一集生产单元，输出 6 到 8 个连续场次，建议 7 个；全篇约 700 到 1100 个中文字符，表达完整后立即停止。'
      : `追加时长：${formatDuration(segmentSeconds)}`
  return `${projectContext}\n\n已有脚本上下文：\n${scriptSegmentContext(source)}\n\n本次目标：${goal || fallbackGoal}\n${segmentBudget}\n\n${finalInstruction}`
}

function withChineseScriptRules(systemPrompt: string): string {
  return `${systemPrompt}\n\n${CHINESE_SCRIPT_OUTPUT_RULES}`
}

const SCRIPT_SEGMENT_SYSTEM_PROMPT = `你是中文长剧和漫剧的分段编剧。你的任务是基于已有剧本继续写下一段，而不是一次性生成整部长篇。
硬性规则：
1. 只输出“下一段剧本正文”，不要标题解释、Markdown、JSON 或分析。
2. 不要重写、总结、改写已有剧本；只顺着已有内容继续推进。
3. 输出 2 到 6 个连续场次，每个场次单独一行。
4. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。
5. 剧情必须承接上一段的时间、地点、人物状态和关键物件；本段结尾留下清晰的下一步动作或悬念。
6. 不要为了拉长篇幅写空泛氛围；每个场次都要有目标、阻力、变化和结果。
7. 不要在本段一次性解决全剧大结局，除非本段目标明确要求收尾。
8. ${SCENE_PRODUCTION_RULES}`

const ADVERTISEMENT_SEGMENT_SYSTEM_PROMPT = `你是中文商业广告的创意总监和制作统筹。请在现有广告脚本末尾追加一组可制作的广告段落，用于按用户指定秒数延长当前广告，而不是重写原稿或另做一支无关广告。
1. 承接现有广告的品牌、产品、核心卖点、受众、视觉风格、产品状态、旁白语气和最后画面；只追加新段落。
2. 追加内容用于补充使用场景、可见证明或情绪价值，不能重复原段落，也不能编造价格、优惠、认证、性能数据、代言或未提供的承诺。
3. 新段落时间码从现有广告结尾继续累计；最后一段重新完成简洁品牌落版和合适的行动引导。
4. 每行使用：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；剧情写明时段、传播任务、核心信息和屏幕文字。
5. ${ADVERTISEMENT_PRODUCTION_RULES}
6. 只输出要追加的广告段落正文，不要复述已有脚本，不要解释、Markdown、表格或分析。`

const SHORT_FILM_SEGMENT_SYSTEM_PROMPT = `你是中文叙事短片的编剧和连续性统筹。请在现有短片末尾续写用户指定时长的新场次，只推进当前故事，不要重写、总结或复述已有内容。
1. 首场直接承接上一场的人物位置、视线、服装、动作、关键物件、环境和声音状态。
2. 新场次继续推进人物目标，形成新的阻力、选择、变化与结果；不得突然新增人物、能力、道具或世界规则。
3. 用户要求收尾时完成因果回收和情绪落点；未要求收尾时留下自然的下一步行动，但不要套用网剧受辱反击或强制下一集钩子。
4. 每行使用：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。
5. ${SCENE_PRODUCTION_RULES}
6. 只输出续写的新场次正文，不要复述已有剧本，不要解释、Markdown、表格或分析。`

const WEB_SERIES_SEGMENT_SYSTEM_PROMPT = `你是中文网剧漫剧的连续剧编剧。请基于已有剧本只续写下一集，严禁重写已有内容。
1. 本次只生成 1 个下一集生产单元，输出 6 到 8 个连续场次，建议 7 个；每个场次对应一个视频镜头，不生成下一集之后的内容。
2. 承接上一段最后的时间、地点、人物状态、服装、视线、动作和关键物件，前两场要明确接住上一段尾部动作。
3. 每场使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；每场都有目标、阻力、变化和结果。
4. 对白不能被压缩成“无台词”：每个场次必须有 1 到 2 句[对白]、[画外音]或[内心独白]，单句尽量 4 到 12 个中文字符、整场口播不超过 24 个中文字符，台词要推进本段冲突；本集至少 3 场使用简短[画外音]承接开场处境、转场信息或反转预期，不得复述可见动作；每场必须写[音效]和[环境声]，不得出现静音场次。
5. 本段末尾保留高波动钩子：悬念、受辱后反击前一秒、身份/实力即将揭示、关键物件启动或敌人误判；最后一行的场次值写“剧情钩子”，不要直接解决。
6. ${SCENE_PRODUCTION_RULES}
7. 只输出下一段剧本正文，不要标题、解释、Markdown、JSON 或分析。`

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
  '品牌',
  '品牌标识',
  'Logo',
  'logo',
]
const SCRIPT_ASSET_STOP_WORDS = new Set(SCRIPT_ASSET_FIELD_BOUNDARIES)

const COMPLETE_SCENE_FIELDS = [
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

function normalizeExpandedScript(raw: string): string {
  const normalized = raw
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const firstScene = normalized.search(/(?:^|\n)\s*(?=场次\s*[：:])/u)
  if (firstScene <= 0) return normalized
  const preamble = normalized.slice(0, firstScene)
  return /(?:用户希望|用户要求|让我|我们需要|我将|任务是|原稿包含|先分析|思考|输出要求)/u.test(preamble)
    ? normalized.slice(firstScene).trim()
    : normalized
}

function assertRequestedSceneCount(source: string, candidate: string): void {
  const expected = explicitRequestedSceneCount(source)
  if (!expected) return
  const actual = splitScriptParagraphs(candidate).filter((paragraph) =>
    Boolean(parseShotFields(paragraph.text).场次),
  ).length
  if (actual >= expected) return
  throw new AppError(
    502,
    'PROVIDER_RESPONSE_TRUNCATED',
    `文本服务返回不完整：明确要求 ${expected} 个场次，实际只返回 ${actual} 个；原剧本未被覆盖，请重试或切换模型`,
  )
}

function explicitRequestedSceneCount(source: string): number | null {
  for (const match of source.matchAll(/(\d{1,3})\s*个(?:场次|场景|镜头)/gu)) {
    const count = Number(match[1])
    if (Number.isInteger(count) && count >= 2 && count <= 100) return count
  }
  return null
}

async function ensureChineseScriptOutput(
  provider: TextGenerationProvider,
  raw: string,
  model: ScriptModel,
  onTextTiming?: (timing: TextGenerationTiming) => void,
  onTextProgress?: (text: string) => void,
): Promise<string> {
  const candidate = normalizeExpandedScript(raw)
  if (!hasUnexpectedEnglish(candidate)) return candidate

  const repaired = normalizeExpandedScript(
    await provider.generate({
      systemPrompt: CHINESE_SCRIPT_REPAIR_SYSTEM_PROMPT,
      userPrompt: `请修复下面的剧本并完整返回：\n\n${candidate}`,
      maxOutputTokens: Math.min(24_000, Math.max(2_400, Math.ceil(contentLength(candidate) * 1.5))),
      model,
      ...(onTextProgress ? { onTextProgress } : {}),
      ...(onTextTiming ? { onTextTiming, timingLabel: 'language-repair' } : {}),
    }),
  )
  if (!repaired || hasUnexpectedEnglish(repaired)) {
    throw new AppError(
      502,
      'PROVIDER_RESPONSE_LANGUAGE_INVALID',
      '文本服务连续返回大量英文内容，系统已阻止覆盖中文剧本，请更换模型后重试',
    )
  }
  return repaired
}

function hasSufficientWebSeriesDialogue(script: string): boolean {
  const scenes = splitScriptParagraphs(script)
    .map((paragraph) => parseShotFields(paragraph.text))
    .filter((fields) => Boolean(fields.场次))
  if (!scenes.length) return false
  const spokenScenes = scenes.filter((fields) => {
    const dialogue = String(fields.对白 || '')
    return /\[(?:对白|画外音|内心独白)\]/u.test(dialogue) && !/无台词/u.test(dialogue)
  }).length
  return spokenScenes === scenes.length
}

function completeMissingWebSeriesDialogue(script: string, mode: ScriptContentMode): string {
  if (mode !== 'web-series' || hasSufficientWebSeriesDialogue(script)) return script

  return splitScriptParagraphs(script)
    .map((paragraph) => {
      const fields = parseShotFields(paragraph.text)
      if (!fields.场次 || sceneHasSpokenDialogue(fields.对白)) return paragraph.text

      const plot = compactDialogueContext(fields.剧情 || fields.动作)
      const existingSound = String(fields.对白 || '')
        .replace(/无台词[\s，,;；。]*/gu, '')
        .replace(/静音[\s，,;；。]*/gu, '')
        .trim()
      const dialogue = [
        `[画外音]${plot || '本场的选择正在改变局面。'}`,
        existingSound,
        existingSound ? '' : '[音效]现场动作声；[环境声]延续当前场景环境声。',
      ]
        .filter(Boolean)
        .join('；')
      const replacement = `对白：${dialogue}`
      const text = /(^|｜)\s*对白\s*[：:][^｜]*/u.test(paragraph.text)
        ? paragraph.text.replace(/(^|｜)\s*对白\s*[：:][^｜]*/u, `$1${replacement}`)
        : `${paragraph.text}｜${replacement}`
      return [
        paragraph.forceEpisodeBreakBefore ? FORCE_EPISODE_BREAK_MARKER : '',
        paragraph.forceShotBreakBefore ? FORCE_SHOT_BREAK_MARKER : '',
        text,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')
}

function completeWebSeriesSpokenContent(script: string, mode: ScriptContentMode): string {
  const completed = completeMissingWebSeriesDialogue(script, mode)
  if (mode !== 'web-series') return completed

  const paragraphs = splitScriptParagraphs(completed)
  const fields = paragraphs.map((paragraph) => parseShotFields(paragraph.text))
  const sceneIndexes = fields.flatMap((scene, index) => (scene.场次 ? [index] : []))
  if (!sceneIndexes.length) return completed

  const desiredVoiceoverScenes = Math.min(
    sceneIndexes.length,
    sceneIndexes.length >= 6 ? 3 : Math.max(1, Math.ceil(sceneIndexes.length / 3)),
  )
  const selected = new Set(
    sceneIndexes.filter((index) => /\[画外音\]/u.test(String(fields[index]?.对白 || ''))),
  )
  const sceneChanges = sceneIndexes.filter((index, position) => {
    if (position === 0) return true
    const previous = fields[sceneIndexes[position - 1]!]?.场景 || ''
    const current = fields[index]?.场景 || ''
    return Boolean(
      previous && current && normalizedSceneIdentity(previous) !== normalizedSceneIdentity(current),
    )
  })
  const candidates = [
    sceneIndexes[0],
    ...sceneChanges,
    sceneIndexes[Math.floor(sceneIndexes.length / 2)],
    sceneIndexes[Math.max(0, sceneIndexes.length - 2)],
    ...sceneIndexes,
  ].filter((index): index is number => typeof index === 'number')

  for (const index of candidates) {
    if (selected.size >= desiredVoiceoverScenes) break
    if (selected.has(index)) continue
    const scene = fields[index] || {}
    const dialogue = String(scene.对白 || '').trim()
    const availableCharacters = Math.max(6, 24 - dialogueTextForTiming(dialogue).length)
    const voiceover = shortVoiceoverContext(scene.剧情 || scene.动作, Math.min(16, availableCharacters))
    if (!voiceover) continue
    const replacement = `对白：[画外音]${voiceover}；${dialogue}`
    paragraphs[index]!.text = /(^|｜)\s*对白\s*[：:][^｜]*/u.test(paragraphs[index]!.text)
      ? paragraphs[index]!.text.replace(/(^|｜)\s*对白\s*[：:][^｜]*/u, `$1${replacement}`)
      : `${paragraphs[index]!.text}｜${replacement}`
    selected.add(index)
  }

  return paragraphs
    .map((paragraph) =>
      [
        paragraph.forceEpisodeBreakBefore ? FORCE_EPISODE_BREAK_MARKER : '',
        paragraph.forceShotBreakBefore ? FORCE_SHOT_BREAK_MARKER : '',
        paragraph.text,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n')
}

function sceneHasSpokenDialogue(dialogue: string | undefined): boolean {
  return (
    /\[(?:对白|画外音|内心独白)\]/u.test(String(dialogue || '')) && !/无台词/u.test(String(dialogue || ''))
  )
}

function compactDialogueContext(value: string | undefined): string {
  const normalized = String(value || '')
    .replace(/动作\s*\d+\s*[：:]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!normalized) return ''
  const sentence = normalized.split(/(?<=[。！？!?])/u)[0] || normalized
  return sentence.length <= 52 ? sentence : `${sentence.slice(0, 52)}。`
}

function shortVoiceoverContext(value: string | undefined, limit: number): string {
  const normalized = String(value || '')
    .replace(/(?:目标|阻力|变化|结果)\s*[：:]/gu, '')
    .replace(/动作\s*\d+\s*[：:]/gu, '')
    .replace(/[“”"']/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!normalized) return ''
  const clause =
    normalized
      .split(/[。！？!?；;，,]/u)
      .find(Boolean)
      ?.trim() || normalized
  const text = (clause.length >= 4 ? clause : normalized)
    .slice(0, Math.max(4, limit))
    .replace(/[。！？!?；;，,]+$/u, '')
  return text ? `${text}。` : ''
}

function assertWebSeriesDialogueCoverage(script: string, mode: ScriptContentMode): void {
  if (mode !== 'web-series' || hasSufficientWebSeriesDialogue(script)) return
  throw new AppError(
    502,
    'PROVIDER_RESPONSE_INVALID',
    '网剧对白生成不完整：每个场次都需要可听见的对白、画外音或内心独白；原剧本未被覆盖，请重试或切换模型',
  )
}

function hasUnexpectedEnglish(script: string): boolean {
  const inspected = script.replace(/\b(?:AI|CG|2D|3D|Alpha|Seedance|JSON|Markdown|IP|S\d+)\b/giu, '')
  const englishWords = inspected.match(/[A-Za-z]{3,}/g) || []
  if (englishWords.length < 6) return false

  const hanCount = inspected.match(/[\u3400-\u9fff]/gu)?.length || 0
  const latinCount = inspected.match(/[A-Za-z]/g)?.length || 0
  const englishDominantLines = inspected
    .split(/\n+/u)
    .filter((line) => (line.match(/[A-Za-z]{3,}/g) || []).length >= 4)
    .filter((line) => {
      const lineHan = line.match(/[\u3400-\u9fff]/gu)?.length || 0
      const lineLatin = line.match(/[A-Za-z]/g)?.length || 0
      return lineLatin > Math.max(18, lineHan * 1.5)
    }).length
  return englishDominantLines >= 2 || (latinCount >= 80 && latinCount > hanCount * 0.22)
}

function isProtectedLongScript(script: string): boolean {
  return contentLength(script) >= SINGLE_REWRITE_MAX_LENGTH
}

function candidateIsTooShort(source: string, candidate: string): boolean {
  return contentLength(candidate) < Math.floor(contentLength(source) * 0.85)
}

function longScriptMaxOutputTokens(source: string): number {
  return Math.min(LONG_SCRIPT_MAX_TOKENS, Math.max(6_000, Math.ceil(contentLength(source) * 1.6)))
}

function segmentMaxOutputTokens(targetSeconds: number, mode: ScriptContentMode = 'short-video'): number {
  if (mode === 'web-series') return webSeriesMaxOutputTokens()
  return Math.min(5_500, Math.max(2_400, Math.ceil(targetSeconds / 60) * 650))
}

function normalizeScriptDurationSeconds(value: number, fallback: number, mode: ScriptContentMode): number {
  const minimum = mode === 'web-series' ? 30 : mode === 'short-film' ? 10 : 5
  if (!Number.isFinite(value)) return Math.min(300, Math.max(minimum, Math.round(fallback)))
  return Math.min(300, Math.max(minimum, Math.round(value)))
}

function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  const minutes = Math.floor(value / 60)
  const remainder = value % 60
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`
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

function segmentScriptIssues(segment: string, mode: ScriptContentMode = 'short-video'): string[] {
  const issues: string[] = []
  const scenes = scriptScenes(segment)
  const minimum = mode === 'web-series' ? 6 : 2
  const maximum = mode === 'web-series' ? 8 : 6
  if (scenes.length < minimum || scenes.length > maximum)
    issues.push(`本段生成 ${scenes.length} 个场次，建议保持 ${minimum} 到 ${maximum} 个`)
  for (const field of QUICK_SCRIPT_FIELDS) {
    const missing = scenes.filter((scene) => !new RegExp(`${field}[：:]`).test(scene)).length
    if (missing) issues.push(`${missing} 个场次缺少“${field}”字段`)
  }
  if (contentLength(segment) < 500) issues.push('本段内容偏短，可继续生成下一段或补充段落目标')
  return issues
}

const HUMAN_PORTRAIT_REQUIREMENTS =
  '影视 CG 风格，透明背景，Alpha 通道，无背景色，无光影效果，无投影，无高光，无环境反射，均匀平光，主体边缘清晰，人物面部大头照，头部和肩部完整入镜，五官清晰可调整，正面平视镜头，自然中性表情，不出现手部、文字和饰边，画面比例 1:1'
const ANIMAL_PORTRAIT_REQUIREMENTS =
  '影视 CG 风格，保留明确物种特征，透明背景，Alpha 通道，无背景色，无光影效果，无投影，无高光，无环境反射，均匀平光，主体边缘清晰，动物面部大头照，头部和肩颈完整入镜，正面平视镜头，自然中性表情，不出现前爪、文字和饰边，画面比例 1:1'
const CHARACTER_ASSET_NEGATIVE_PROMPT =
  '不要真人摄影感、卡通动漫、塑料皮肤、蜡像脸、过度磨皮、玻璃眼、空洞眼神、无瞳孔、斜视、眼睛不对称、面部漂移、五官融化、歪嘴、缺牙、畸形、解剖错误、多余肢体、手部、手指、文字、水印、logo、二维码、边框、背景色、投影、强高光、环境反射、低分辨率、模糊和压缩痕迹'
const ANIMAL_ASSET_NEGATIVE_PROMPT =
  '不要人类面孔、人类皮肤、人类身体、真人摄影感、物种混杂、额外头部、额外耳朵、额外眼睛、额外肢体、前爪入镜、解剖错误、塑料材质、文字、水印、logo、二维码、边框、背景色、投影、强高光、环境反射、低分辨率和模糊'
const SCENE_ASSET_NEGATIVE_PROMPT =
  '不要人物、动物、拥挤道具、悬浮物体、断开物体、穿帮接缝、重复纹理、贴图拉伸、抠像边、漂浮阴影、色温跳变、文字、水印、logo、二维码、UI、边框、低分辨率、像素化、过曝炸白和暗部死黑'
const PROP_ASSET_NEGATIVE_PROMPT =
  '不要人物、手部、多个重复物品、额外零件、悬浮部件、断裂、变形、比例错误、材质塑料感、复杂场景、文字、水印、logo、二维码、边框、投影、强反射、低分辨率和模糊'
const COSTUME_ASSET_NEGATIVE_PROMPT =
  '不要人物、模特、人体、脸、手部、衣架、多个重复服装、缺失部件、布料粘连、材质塑料感、复杂场景、文字、水印、logo、二维码、边框、投影、强反射、低分辨率和模糊'
const BRAND_ASSET_NEGATIVE_PROMPT =
  '不要人物、人体、手部、产品乱码、错别字、额外文字、水印、二维码、重复 Logo、变形图形、缺失字母、投影、环境反射、低分辨率和模糊'

type ScriptAssetKind = ScriptAssetSuggestion['kind']
type ScriptAssetNameIndex = Record<ScriptAssetKind, string[]>

function normalizeScriptAssetSuggestion(
  suggestion: ScriptAssetSuggestion,
  sourceNames: ScriptAssetNameIndex,
  sourceContext = '',
  projectVisualStyle: ProjectVisualStyle = 'cinematic-cg',
): ScriptAssetSuggestion | null {
  const name = resolveAssetSuggestionName(suggestion, sourceNames)
  if (!name) return null

  const namedSuggestion: ScriptAssetSuggestion =
    name === suggestion.name.trim()
      ? suggestion
      : {
          ...suggestion,
          name,
          description: replaceAssetName(suggestion.description, suggestion.name, name),
          prompt: replaceAssetName(suggestion.prompt, suggestion.name, name),
          reason: replaceAssetName(suggestion.reason, suggestion.name, name),
        }
  const stylePrompt = `项目统一视觉风格：${projectVisualStyleLabel(projectVisualStyle)}，后续资产和视频必须保持这一风格，不要自行切换风格`

  if (namedSuggestion.kind === 'character') {
    const animal = namedSuggestion.attributes.subjectType === 'animal'
    const evidence = [
      namedSuggestion.name,
      namedSuggestion.description,
      namedSuggestion.prompt,
      namedSuggestion.reason,
    ].join('，')
    const nearbyScriptEvidence = characterEvidenceWindow(namedSuggestion.name, sourceContext)
    const profileEvidence = [evidence, nearbyScriptEvidence].filter(Boolean).join('，')
    const inferredGender = inferScriptCharacterGender(profileEvidence)
    const gender = animal
      ? 'unspecified'
      : inferredGender === 'unspecified'
        ? namedSuggestion.attributes.gender
        : inferredGender
    const exactAge = animal
      ? null
      : inferScriptCharacterExactAge(namedSuggestion.name, sourceContext) ||
        namedSuggestion.attributes.exactAge
    const ageSignal = inferScriptCharacterAgeSignal(profileEvidence)
    const ageGroup = animal
      ? namedSuggestion.attributes.ageGroup
      : exactAge
        ? ageGroupFromExactAge(exactAge)
        : ageSignal || namedSuggestion.attributes.ageGroup
    const identityTags = inferScriptCharacterIdentityTags(profileEvidence)
    const profileFacts = animal
      ? identityTags
      : [
          gender === 'male' ? '男性' : gender === 'female' ? '女性' : '',
          exactAge ? `${exactAge}岁` : scriptAgeLabel(ageGroup),
          ...identityTags,
        ].filter(Boolean)
    const profileSummary = profileFacts.length ? `角色背景：${profileFacts.join('，')}。` : ''
    const basePrompt = animal ? stripHumanProfileTerms(namedSuggestion.prompt) : namedSuggestion.prompt
    const description = namedSuggestion.description.includes(namedSuggestion.name)
      ? namedSuggestion.description
      : `${namedSuggestion.name}；${namedSuggestion.description}`
    const subjectProfile = animal
      ? [
          '动物角色',
          namedSuggestion.attributes.species || namedSuggestion.name,
          namedSuggestion.attributes.anthropomorphic ? '拟人化动物造型，保留物种面部特征' : '自然动物形态',
        ]
      : [
          '人物角色',
          namedSuggestion.attributes.gender === 'male'
            ? '男性'
            : namedSuggestion.attributes.gender === 'female'
              ? '女性'
              : '性别未指定',
          namedSuggestion.attributes.exactAge
            ? `${namedSuggestion.attributes.exactAge}岁`
            : scriptAgeLabel(namedSuggestion.attributes.ageGroup),
        ]
    return {
      ...namedSuggestion,
      description: appendAssetProfile(description, profileSummary),
      prompt: composeAssetPrompt([
        stylePrompt,
        ...subjectProfile,
        namedSuggestion.name,
        profileSummary,
        basePrompt,
        animal ? ANIMAL_PORTRAIT_REQUIREMENTS : HUMAN_PORTRAIT_REQUIREMENTS,
      ]),
      negativePrompt: composeAssetNegativePrompt(
        namedSuggestion.negativePrompt,
        animal ? ANIMAL_ASSET_NEGATIVE_PROMPT : CHARACTER_ASSET_NEGATIVE_PROMPT,
      ),
      attributes: {
        ...namedSuggestion.attributes,
        gender,
        ageGroup,
        exactAge,
        visualStyle: projectVisualStyle || 'cinematic-cg',
        framing: 'portrait',
        background: 'transparent',
      },
    }
  }

  if (namedSuggestion.kind === 'scene') {
    const sceneContext = [
      sourceContext,
      namedSuggestion.name,
      namedSuggestion.description,
      namedSuggestion.prompt,
    ].join('，')
    return {
      ...namedSuggestion,
      prompt: composeAssetPrompt([
        stylePrompt,
        namedSuggestion.name,
        namedSuggestion.prompt,
        '统一项目视觉风格的场景概念设计，空场景，无人物和动物，空间结构与前中后景关系清楚，关键出入口和动线明确，预留角色表演、动作和运镜空间，材质尺度统一，光照方向稳定，宽幅环境全景，适合后续多镜头复用',
      ]),
      negativePrompt: composeAssetNegativePrompt(namedSuggestion.negativePrompt, SCENE_ASSET_NEGATIVE_PROMPT),
      attributes: {
        ...namedSuggestion.attributes,
        sceneType: inferSceneType(sceneContext, namedSuggestion.attributes.sceneType),
        era: inferEra(sceneContext, namedSuggestion.attributes.era),
        visualStyle: projectVisualStyle || 'cinematic-cg',
        emptyScene: true,
        activitySpace: true,
      },
    }
  }

  if (namedSuggestion.kind === 'prop') {
    const propContext = [
      namedSuggestion.name,
      namedSuggestion.description,
      namedSuggestion.prompt,
      sourceContext,
    ].join('，')
    return {
      ...namedSuggestion,
      prompt: composeAssetPrompt([
        stylePrompt,
        namedSuggestion.name,
        namedSuggestion.prompt,
        '统一项目视觉风格的物品资产，单个物品独立展示，完整轮廓，正面主视图，结构和尺寸关系准确，材质、颜色、磨损与剧情状态明确，透明背景，Alpha 通道，无背景色，无投影，均匀平光，主体边缘清晰，适合跨镜头保持一致',
      ]),
      negativePrompt: composeAssetNegativePrompt(namedSuggestion.negativePrompt, PROP_ASSET_NEGATIVE_PROMPT),
      attributes: {
        ...namedSuggestion.attributes,
        condition: inferPropCondition(propContext, namedSuggestion.attributes.condition),
        visualStyle: projectVisualStyle || 'cinematic-cg',
        background: 'transparent',
      },
    }
  }

  if (namedSuggestion.kind === 'brand') {
    return {
      ...namedSuggestion,
      prompt: composeAssetPrompt([
        stylePrompt,
        namedSuggestion.name,
        namedSuggestion.prompt,
        '品牌或 Logo 资产，图形结构完整，字形和字母准确，构图清晰，适合在片尾、包装、场景招牌或界面中复用，透明背景，Alpha 通道，无背景色，无投影，均匀平光，主体边缘清晰',
        namedSuggestion.attributes.exactText
          ? `必须准确显示文字“${namedSuggestion.attributes.exactText}”`
          : '',
      ]),
      negativePrompt: composeAssetNegativePrompt(namedSuggestion.negativePrompt, BRAND_ASSET_NEGATIVE_PROMPT),
      attributes: {
        ...namedSuggestion.attributes,
        visualStyle: projectVisualStyle || 'cinematic-cg',
        background: 'transparent',
      },
    }
  }

  return {
    ...namedSuggestion,
    prompt: composeAssetPrompt([
      stylePrompt,
      namedSuggestion.name,
      namedSuggestion.prompt,
      '统一项目视觉风格的服装资产，单套服装平铺独立展示，完整呈现上装、下装和必要配件，版型、材质、纹理、配色与磨损状态清楚，不出现人物、人体、脸和衣架，透明背景，Alpha 通道，无背景色，无投影，均匀平光，边缘清晰，适合角色跨镜头造型一致',
    ]),
    negativePrompt: composeAssetNegativePrompt(namedSuggestion.negativePrompt, COSTUME_ASSET_NEGATIVE_PROMPT),
    attributes: {
      ...namedSuggestion.attributes,
      visualStyle: projectVisualStyle || 'cinematic-cg',
      presentation: 'flat',
    },
  }
}

function replaceAssetName(value: string, originalName: string, replacementName: string): string {
  const original = originalName.trim()
  return original && original !== replacementName ? value.replaceAll(original, replacementName) : value
}

function appendAssetProfile(description: string, profile: string): string {
  if (!profile || description.includes(profile)) return description
  return `${description.replace(/[。.!！?？\s]+$/u, '')}；${profile}`.slice(0, 500)
}

function composeAssetPrompt(fragments: readonly string[]): string {
  const prompt = fragments
    .map((fragment) => fragment.trim().replace(/[，。；;,]+$/u, ''))
    .filter(Boolean)
    .filter((fragment, index, values) => values.indexOf(fragment) === index)
    .join('，')
  return `${prompt.slice(0, 4_999)}。`
}

function composeAssetNegativePrompt(current: string, required: string): string {
  return composeAssetPrompt([current, required]).slice(0, 2_000)
}

function stripHumanProfileTerms(value: string): string {
  return value
    .replace(/\d{1,3}\s*岁/gu, '')
    .replace(/男性|女性|男人|女人|男孩|女孩|少年|少女|青年|中年|老年|儿童|婴儿/gu, '')
    .replace(/\b(?:male|female|boy|girl|young|middle-aged|senior)\b/giu, '')
    .replace(/[，,]{2,}/gu, '，')
    .trim()
}

function fallbackAssetSuggestions(
  script: string,
  direction: ScriptCreativeDirection,
  projectVisualStyle: ProjectVisualStyle = 'cinematic-cg',
): { summary: string; assets: ScriptAssetSuggestion[] } {
  const visualStyle = projectVisualStyle || suggestionVisualStyle(direction)
  const characters = extractAssetNames(script, ['角色', '人物', '主角'], [], 4, 'character')
  const scenes = extractAssetNames(script, ['场景', '地点'], [], 4, 'scene')
  const props = extractAssetNames(script, ['关键物件', '关键道具', '物件', '道具'], [], 5, 'prop')
  const costumes = extractAssetNames(script, ['服装', '衣装', '外观'], [], 4, 'costume')
  const brands = extractAssetNames(script, ['品牌', '品牌标识', 'Logo', 'logo'], [], 2, 'brand')
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
          ethnicity: 'unspecified',
          skinTone: 'unspecified',
          eyeColor: 'unspecified',
          hairColor: 'unspecified',
          species: subjectType === 'animal' ? name : '',
          anthropomorphic: false,
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
          appearanceVariants: [],
          activeAppearanceVariantId: null,
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
        characterAssetId: null,
        audience: 'unisex',
        category: inferCostumeCategory(name),
        season: inferCostumeSeason(name),
        design: inferCostumeDesign(name),
        presentation: 'flat',
        visualStyle,
        turnaround: false,
      },
    })),
    ...brands.map((name): ScriptAssetSuggestion => ({
      kind: 'brand',
      name,
      description: `从剧本中提取的品牌或 Logo 资产：${name}`,
      prompt: `${name}，品牌 Logo 设计，图形结构完整，文字准确，透明背景，Alpha 通道，居中构图，适合广告片尾落版和场景复用。`,
      negativePrompt: '',
      reason: '品牌标识需要在广告、片尾或场景中保持一致，建议独立建立资产。',
      priority: 5,
      attributes: {
        type: 'brand',
        brandType: 'logo',
        usage: 'end-card',
        background: 'transparent',
        layout: 'centered',
        exactText: name,
        palette: '',
        visualStyle,
      },
    })),
  ]
  return {
    summary: '已根据剧本文本提取角色、场景、关键道具、核心服装和品牌标识建议，建议先确认高优先级资产。',
    assets,
  }
}

function extractScriptAssetNameIndex(script: string): ScriptAssetNameIndex {
  return {
    character: extractAssetNames(script, ['角色', '人物', '主角'], [], 8, 'character'),
    scene: extractAssetNames(script, ['场景', '地点'], [], 8, 'scene'),
    prop: extractAssetNames(script, ['关键物件', '关键道具', '物件', '道具'], [], 10, 'prop'),
    costume: extractAssetNames(script, ['服装', '衣装', '外观'], [], 8, 'costume'),
    brand: extractAssetNames(script, ['品牌', '品牌标识', 'Logo', 'logo'], [], 4, 'brand'),
  }
}

function resolveAssetSuggestionName(
  suggestion: ScriptAssetSuggestion,
  sourceNames: ScriptAssetNameIndex,
): string | null {
  const direct = cleanAssetName(suggestion.name, suggestion.kind)
  if (isPlausibleAssetName(direct, suggestion.kind)) return direct

  const evidence = [suggestion.description, suggestion.prompt, suggestion.reason].join('\n')
  const evidenceMatch = [...sourceNames[suggestion.kind]]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => evidence.includes(candidate))
  if (evidenceMatch) return evidenceMatch

  return sourceNames[suggestion.kind].length === 1 ? sourceNames[suggestion.kind][0]! : null
}

function extractAssetNames(
  script: string,
  fields: string[],
  fallback: string[],
  limit: number,
  kind: ScriptAssetKind,
): string[] {
  const values = extractScriptFieldValues(script, fields).flatMap((value) => splitAssetNameList(value, kind))
  const cleanedValues = values
    .map((value) => cleanAssetName(value, kind))
    .filter((value) => isPlausibleAssetName(value, kind))
    .filter((value) => !SCRIPT_ASSET_STOP_WORDS.has(value))
  const uniqueValues = deduplicateExtractedAssetNames(cleanedValues, kind)
  return (uniqueValues.length ? uniqueValues : fallback).slice(0, limit)
}

function extractScriptFieldValues(script: string, fields: string[]): string[] {
  const normalized = script
    .replace(/\*\*/gu, '')
    .replace(/\r/gu, '')
    .replace(/(^|\n)\s*(?:[-*]\s+|#{1,6}\s*)/gu, '$1')
  const targets = fields.map(escapeRegExp).join('|')
  const boundaries = SCRIPT_ASSET_FIELD_BOUNDARIES.map(escapeRegExp).join('|')
  const pattern = new RegExp(
    `(?:^|[\\n|｜])\\s*(?:${targets})\\s*[：:]\\s*([\\s\\S]*?)(?=(?:[\\n|｜])\\s*(?:${boundaries})\\s*[：:]|$)`,
    'gu',
  )
  return [...normalized.matchAll(pattern)].map((match) => (match[1] || '').trim()).filter(Boolean)
}

function splitAssetNameList(value: string, kind: ScriptAssetKind): string[] {
  if (kind === 'character') return splitCharacterNameList(value)
  if (kind === 'scene') return splitSceneNameList(value)
  return value
    .split(/[、，,；;]|(?:和|与)/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitCharacterNameList(value: string): string[] {
  const names: string[] = []
  for (const rawSection of value.replace(/\s+/gu, ' ').split(/[；;]/u)) {
    const section = rawSection.trim()
    if (
      !section ||
      /^(?:无)?背景角色/u.test(section) ||
      /^(?:无配角|无人物|无角色|无主角)(?:[，,]|$)/u.test(section)
    )
      continue

    const hasRoleLabel = /^(?:(?:主要|核心)?角色|主角|人物|配角)(?:为|是|包括|包含)?\s*/u.test(section)
    const withoutRoleLabel = section.replace(
      /^(?:(?:主要|核心)?角色|主角|人物|配角)(?:为|是|包括|包含)?\s*/u,
      '',
    )
    if (!withoutRoleLabel || /^(?:无配角|无人物|无人)$/u.test(withoutRoleLabel)) continue

    const identityClause = withoutRoleLabel.split(/[，,]/u)[0] || ''
    const candidates = identityClause
      .split(/[、]|(?:和|与)/u)
      .map((item) => item.trim())
      .filter(Boolean)
    names.push(
      ...(!hasRoleLabel &&
      /身穿|穿着|佩戴|戴着|跟随|跟在|穿(?:黑|白|红|橙|黄|绿|蓝|紫|灰|旧|新|深|浅|褪色)/u.test(identityClause)
        ? candidates.slice(0, 1)
        : candidates),
    )
  }
  return names
}

function splitSceneNameList(value: string): string[] {
  for (const segment of value.replace(/\s+/gu, ' ').split(/[，,；;]/u)) {
    const candidate = cleanSceneName(segment)
    if (isPlausibleAssetName(candidate, 'scene')) return [candidate]
  }
  return []
}

function cleanAssetName(value: string, kind: ScriptAssetKind): string {
  if (kind === 'character') return cleanCharacterName(value)
  if (kind === 'scene') return cleanSceneName(value)
  return cleanAssetNameBase(value)
}

function cleanAssetNameBase(value: string): string {
  const cleaned = value
    .replace(/^[\s·\-—]+/u, '')
    .replace(/^(?:资产|名称|物品|物件|道具|服装|衣装)[：:]\s*/u, '')
    .replace(
      /^(?:一位|一名|一个|这位|那位|该|某)?(?:[零〇一二三四五六七八九十百两\d]+岁(?:的)?|年迈的|年老的|老年的|少年的|少女的|年轻的|中年的|儿童的)/u,
      '',
    )
    .split(/[（(。.!！?？]/u)[0]!
    .split(/——|--|：|:/u)[0]!
    .trim()
  if (cleaned.length < 2) return ''
  return cleaned.length > 32 ? cleaned.slice(0, 32) : cleaned
}

function cleanCharacterName(value: string): string {
  return cleanAssetNameBase(value)
    .replace(/^(?:(?:主要|核心)?角色|主角|人物|配角)(?:为|是|包括|包含)?\s*/u, '')
    .split(
      /(?:身穿|穿着|佩戴|戴着|跟随|跟在|站在|位于|坐在|躲在|手持|拿着|抱着|先神情|随后|然后|低头|抬头|缩肩|强装)/u,
    )[0]!
    .split(/穿(?=(?:黑|白|红|橙|黄|绿|蓝|紫|灰|旧|新|深|浅|褪色))/u)[0]!
    .trim()
}

function cleanSceneName(value: string): string {
  return cleanAssetNameBase(value)
    .replace(/^(?:内景|外景|室内|室外)[：:]?\s*/u, '')
    .replace(
      /^(?:次日|当天|清晨|黎明|上午|中午|下午|傍晚|黄昏|夜晚|深夜|午夜|雨夜|雪夜)(?:前|后|时)?(?:的)?\s*/u,
      '',
    )
    .replace(/[，,；;].*$/u, '')
    .replace(/(?:内景|外景)$/u, '')
    .trim()
}

function isPlausibleAssetName(value: string, kind: ScriptAssetKind): boolean {
  if (!value || value.length < 2 || value.length > (kind === 'scene' ? 28 : 24)) return false
  if (kind === 'character') {
    if (
      /神情|表情|情绪|眼神|视线|瞳孔|紧张|镇定|惊慌|错愕|赔笑|皱眉|低头|抬头|缩肩|随后|然后|开始|继续|正在|站在|走向|看向|等待|说道|抬手|伸手|转身|位于|强装|抱臂|探头|交头接耳|寻找|声音/u.test(
        value,
      )
    )
      return false
    if (
      /^(?:无|未指定|主角|主要角色|配角|无配角|背景角色|角色|人物|众人|人群)$/u.test(value) ||
      /^(?:数名|多名|若干|一群|众多|所有|其余|围观|等待)?(?:弟子|群众|路人|村民|工作人员|士兵|侍卫|学生|乘客|客人|观众|人群|众人|人们)(?:们|[甲乙丙丁一二三四\d])?$/u.test(
        value,
      ) ||
      /^(?:数名|多名|若干|一群|众多|所有|其余|围观|等待).{0,8}(?:弟子|群众|路人|村民|工作人员|士兵|侍卫|学生|乘客|客人|观众|人群|众人|人们)(?:们)?$/u.test(
        value,
      )
    )
      return false
  }
  if (kind === 'scene') {
    if (
      /神情|表情|冷雾未散|晨雾未散|雾气未散|站满|立着|等待|位于|穿着|身穿|挂着|抱着|拿着|出现|翻涌|笼罩|散去|亮起|裂开|覆盖|坐着|站着|走向|看向|弟子|人物|角色/u.test(
        value,
      )
    )
      return false
    if (/^(?:清晨|黎明|上午|中午|下午|傍晚|黄昏|夜晚|深夜|午夜|阴天|晴天|冷雾|晨雾|黑雾|金光)$/u.test(value))
      return false
  }
  return true
}

function deduplicateExtractedAssetNames(values: string[], kind: ScriptAssetKind): string[] {
  const result: string[] = []
  for (const value of values) {
    const exactIndex = result.findIndex((existing) => existing === value)
    if (exactIndex >= 0) continue
    if (kind === 'scene') {
      const containingIndex = result.findIndex(
        (existing) =>
          Math.abs(existing.length - value.length) <= 8 &&
          (existing.startsWith(value) || value.startsWith(existing)),
      )
      if (containingIndex >= 0) {
        if (value.length < result[containingIndex]!.length) result[containingIndex] = value
        continue
      }
    }
    result.push(value)
  }
  return result
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function inferScriptCharacterSubjectType(text: string): 'human' | 'animal' {
  return /狗|猫|牛|马|羊|猪|鸡|鸭|鹅|鸟|鱼|狼|虎|熊|鹿|猴|犬|妖兽|灵兽/u.test(text) ? 'animal' : 'human'
}

function inferScriptCharacterGender(text: string): 'male' | 'female' | 'unspecified' {
  if (/老船夫|船夫|祖父|爷爷|爷|父亲|男人|男性|哥哥|弟弟|少爷|他\b/u.test(text)) return 'male'
  if (/翠翠|孙女|外孙女|女性|少女|姑娘|女孩|母亲|娘|妻|小姐|她\b/u.test(text)) return 'female'
  return 'unspecified'
}

function inferScriptCharacterAge(text: string): 'child' | 'teen' | 'young' | 'middle' | 'senior' {
  return inferScriptCharacterAgeSignal(text) || 'young'
}

function inferScriptCharacterAgeSignal(
  text: string,
): 'child' | 'teen' | 'young' | 'middle' | 'senior' | null {
  if (/老船夫|船夫|年迈|祖父|爷爷|老人|老年|晚年|七十|六十|五十/u.test(text)) return 'senior'
  if (/儿童|孩子|小孩|幼/u.test(text)) return 'child'
  if (/翠翠|少年|少女|十几|十三|十四|十五|十六|十七|十八/u.test(text)) return 'teen'
  if (/中年|三十|四十/u.test(text)) return 'middle'
  if (/青年|年轻|二十|十九/u.test(text)) return 'young'
  return null
}

function inferScriptCharacterExactAge(name: string, script: string): number | null {
  const exactFromContext = exactAgeNearCharacterName(name, script)
  if (exactFromContext) return exactFromContext
  return exactAgeFromText(name)
}

function exactAgeNearCharacterName(name: string, script: string): number | null {
  const nearby = characterEvidenceWindow(name, script)
  const nearbyAge = exactAgeFromText(nearby)
  if (nearbyAge) return nearbyAge

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

function characterEvidenceWindow(name: string, script: string): string {
  if (!name || !script) return ''
  const occurrences: string[] = []
  let searchFrom = 0
  while (searchFrom < script.length) {
    const index = script.indexOf(name, searchFrom)
    if (index < 0) break
    const lineStart = Math.max(
      script.lastIndexOf('\n', index),
      script.lastIndexOf('｜', index),
      script.lastIndexOf('|', index),
    )
    const lineEndCandidates = [
      script.indexOf('\n', index),
      script.indexOf('｜', index),
      script.indexOf('|', index),
    ].filter((boundary) => boundary >= 0)
    const lineEnd = lineEndCandidates.length ? Math.min(...lineEndCandidates) : script.length
    const line = script.slice(lineStart + 1, lineEnd)
    const listPart = line.split(/[、；;]/u).find((part) => part.includes(name))
    occurrences.push((listPart || line).trim())
    searchFrom = index + name.length
  }
  return (
    occurrences.find((value) =>
      /\d{1,3}\s*岁|男性|女性|男|女|老年|中年|青年|少年|少女|儿童|镖师|剑客|长老|导演|医生|将军/u.test(value),
    ) ||
    occurrences[0] ||
    ''
  )
}

function ageGroupFromExactAge(age: number): 'child' | 'teen' | 'young' | 'middle' | 'senior' {
  if (age < 13) return 'child'
  if (age <= 18) return 'teen'
  if (age < 30) return 'young'
  if (age < 50) return 'middle'
  return 'senior'
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
    /镖师|镖客/u.test(text) ? '镖师' : '',
    /剑客|剑士|女剑客/u.test(text) ? '剑客' : '',
    /长老|宗主|掌门|弟子/u.test(text) ? '宗门身份' : '',
    /导演|摄影师|记者/u.test(text) ? '影像从业者' : '',
    /医生|医师|药师/u.test(text) ? '医者' : '',
    /将军|士兵|军人|校尉/u.test(text) ? '军旅身份' : '',
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

function projectVisualStyleLabel(value: string | undefined): string {
  return (
    (
      {
        photorealistic: '仿真人',
        'cinematic-cg': 'CG风',
        'chinese-2d': '2D风',
        'chinese-3d': '3D国漫风',
        anime: '日漫风',
        storybook: '绘本风',
      } as Record<string, string>
    )[value || 'cinematic-cg'] || 'CG风'
  )
}

function inferSceneSpace(name: string): 'interior' | 'exterior' {
  return /室内|屋|房|店|铺|工厂|车厢|房间|大厅|暗房|药铺/u.test(name) ? 'interior' : 'exterior'
}

function inferSceneType(
  name: string,
  fallback:
    | 'city'
    | 'street'
    | 'residential'
    | 'commercial'
    | 'nature'
    | 'ancient'
    | 'industrial'
    | 'fantasy' = 'city',
): 'city' | 'street' | 'residential' | 'commercial' | 'nature' | 'ancient' | 'industrial' | 'fantasy' {
  if (/修仙|仙侠|仙门|宗门|山门|青云宗|灵石|灵脉|妖兽|秘境|玄幻|奇幻|神殿|魔法|浮空|天穹/u.test(name))
    return 'fantasy'
  if (/古|宫|城门|边城|药铺|江湖|门派/u.test(name)) return 'ancient'
  if (/工厂|车间|管线|工业|暗房/u.test(name)) return 'industrial'
  if (/森林|山|河|雪坡|荒野/u.test(name)) return 'nature'
  if (/商店|市场|餐厅|药铺/u.test(name)) return 'commercial'
  if (/街|路|站台|车站/u.test(name)) return 'street'
  if (/住宅|家|卧室/u.test(name)) return 'residential'
  if (/浮空|魔法|神殿/u.test(name)) return 'fantasy'
  return fallback
}

function inferEra(
  name: string,
  fallback: 'ancient' | 'recent' | 'modern' | 'future' = 'modern',
): 'ancient' | 'recent' | 'modern' | 'future' {
  if (
    /修仙|仙侠|仙门|宗门|山门|青云宗|灵石|灵脉|妖兽|秘境|玄幻|奇幻|古|剑|宫|江湖|门派|药铺|古门/u.test(name)
  )
    return 'ancient'
  if (/未来|赛博|浮空|企业霓虹|机器人/u.test(name)) return 'future'
  if (/民国|旧式|老式/u.test(name)) return 'recent'
  return fallback
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

function inferPropCondition(
  text: string,
  fallback: 'new' | 'used' | 'aged' | 'damaged',
): 'new' | 'used' | 'aged' | 'damaged' {
  if (/破损|损坏|断裂|残缺|碎裂/u.test(text)) return 'damaged'
  if (/年久|陈旧|老旧|锈蚀|腐朽/u.test(text)) return 'aged'
  if (/旧|使用痕迹|磨损|划痕/u.test(text)) return 'used'
  return fallback
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

type ScriptParagraph = {
  text: string
  forceEpisodeBreakBefore: boolean
  forceShotBreakBefore?: boolean
}

export function splitScriptParagraphs(script: string): ScriptParagraph[] {
  const lines = script
    .replaceAll(FORCE_EPISODE_BREAK_MARKER, `\n${FORCE_EPISODE_BREAK_MARKER}\n`)
    .replaceAll(FORCE_SHOT_BREAK_MARKER, `\n${FORCE_SHOT_BREAK_MARKER}\n`)
    .replace(/(?:｜|\|)\s*(?=(?:#{1,6}\s*|\*{1,2})?场次\s*[：:])/gu, '\n')
    .split(/\n+/)
    .map(normalizeScriptLine)
    .filter(Boolean)
  const paragraphs: ScriptParagraph[] = []
  let forceEpisodeBreakBefore = false
  let forceShotBreakBefore = false
  let structuredScene: ScriptParagraph | null = null

  const flushStructuredScene = () => {
    if (!structuredScene) return
    paragraphs.push(structuredScene)
    structuredScene = null
  }

  for (const line of lines) {
    if (line === FORCE_EPISODE_BREAK_MARKER) {
      flushStructuredScene()
      forceEpisodeBreakBefore = true
      continue
    }
    if (line === FORCE_SHOT_BREAK_MARKER) {
      flushStructuredScene()
      forceShotBreakBefore = true
      continue
    }

    if (isEpisodeHeaderLine(line)) {
      flushStructuredScene()
      forceEpisodeBreakBefore = true
      continue
    }

    if (isSceneHeaderLine(line)) {
      flushStructuredScene()
      structuredScene = {
        text: line,
        forceEpisodeBreakBefore,
        ...(forceShotBreakBefore ? { forceShotBreakBefore: true } : {}),
      }
      forceEpisodeBreakBefore = false
      forceShotBreakBefore = false
      continue
    }

    if (structuredScene && isStructuredSceneContinuation(line)) {
      structuredScene.text = `${structuredScene.text}｜${line}`
      continue
    }

    if (structuredScene) {
      structuredScene.text = `${structuredScene.text} ${line}`
      continue
    }

    flushStructuredScene()
    paragraphs.push({
      text: line,
      forceEpisodeBreakBefore,
      ...(forceShotBreakBefore ? { forceShotBreakBefore: true } : {}),
    })
    forceEpisodeBreakBefore = false
    forceShotBreakBefore = false
  }

  flushStructuredScene()

  return paragraphs
}

function normalizeScriptLine(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/u, '')
    .replace(/^[-+>]\s+(?=(?:\*{1,2})?(?:场次|场景|第\s*\d+\s*[集话场幕]|(?:E\d+[-_])?S\d+))/iu, '')
    .trim()
}

function normalizedScriptHeader(line: string): string {
  return normalizeScriptLine(line)
    .replace(/[*_`【】[\]]/gu, '')
    .trim()
}

function isEpisodeHeaderLine(line: string): boolean {
  const header = normalizedScriptHeader(line)
  if (/^E\d+[-_]S\d+/iu.test(header)) return false
  return /^(?:第\s*[一二三四五六七八九十百千0-9]+\s*[集话]|EP(?:ISODE)?\s*\d+)(?:\s*[：:].*)?$/iu.test(header)
}

function isSceneHeaderLine(line: string): boolean {
  const header = normalizedScriptHeader(line)
  return /^(?:场次\s*(?:[：:]\s*)?(?:[A-Z]*\d+|[一二三四五六七八九十百千]+)|(?:E\d+[-_])?S\d+|第\s*[一二三四五六七八九十百千0-9]+\s*[场幕]|(?:场景|SCENE)\s*[一二三四五六七八九十百千0-9]+)(?:\s*[：:｜|.、-].*)?$/iu.test(
    header,
  )
}

function isStructuredSceneContinuation(line: string): boolean {
  const field = line
    .match(/^([^：:]{1,20})\s*[：:]/u)?.[1]
    ?.replace(/[*_`#【】[\]]/gu, '')
    .trim()
  return Boolean(
    field && ([...SHOT_FIELD_NAMES, ...SCENE_DIRECTION_FIELD_NAMES] as readonly string[]).includes(field),
  )
}

const LONG_SCRIPT_PARAGRAPH_THRESHOLD = 900
const LONG_SCRIPT_CHUNK_TARGET = 420

function expandLongScriptParagraphs(paragraphs: ScriptParagraph[]): ScriptParagraph[] {
  return paragraphs.flatMap(expandLongScriptParagraph)
}

function expandLongScriptParagraph(paragraph: ScriptParagraph): ScriptParagraph[] {
  if (paragraph.text.replace(/\s/gu, '').length < LONG_SCRIPT_PARAGRAPH_THRESHOLD) return [paragraph]

  const fields = parseShotFields(paragraph.text)
  const direction = parseSceneDirectionFields(paragraph.text)
  const narrativeField = (['动作', '剧情', '对白'] as const)
    .map((field) => ({ field, value: fields[field]?.trim() || '' }))
    .sort((left, right) => right.value.length - left.value.length)[0]
  const narrative =
    narrativeField && narrativeField.value.length >= LONG_SCRIPT_PARAGRAPH_THRESHOLD / 2
      ? narrativeField.value
      : paragraph.text
  const chunks = splitLongNarrative(narrative)
  if (chunks.length < 2) return [paragraph]

  const structured = Boolean(fields.场次) && narrative !== paragraph.text && narrativeField
  return chunks.map((chunk, index) => {
    if (!structured || !narrativeField) {
      return {
        text: chunk,
        forceEpisodeBreakBefore: index === 0 && paragraph.forceEpisodeBreakBefore,
        ...(index === 0 && paragraph.forceShotBreakBefore ? { forceShotBreakBefore: true } : {}),
      }
    }

    const sceneNumber = `${fields.场次}-${String(index + 1).padStart(2, '0')}`
    const row = [
      `场次：${sceneNumber}`,
      `${narrativeField.field}：${chunk}`,
      ...SHOT_FIELD_NAMES.filter(
        (field) =>
          field !== '场次' &&
          field !== narrativeField.field &&
          Boolean(fields[field]) &&
          (fields[field]?.length || 0) <= 600,
      ).map((field) => `${field}：${fields[field]}`),
      ...SCENE_DIRECTION_FIELD_NAMES.filter((field) => Boolean(direction[field])).map(
        (field) => `${field}：${direction[field]}`,
      ),
    ].join('｜')

    return {
      text: row,
      forceEpisodeBreakBefore: index === 0 && paragraph.forceEpisodeBreakBefore,
      ...(index === 0 && paragraph.forceShotBreakBefore ? { forceShotBreakBefore: true } : {}),
    }
  })
}

function splitLongNarrative(value: string): string[] {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (!normalized) return []
  const sentences = normalized.match(/[^。！？!?；;]+[。！？!?；;]?/gu) || [normalized]
  const chunks: string[] = []
  let current = ''

  const flush = () => {
    const text = current.trim()
    if (text) chunks.push(text)
    current = ''
  }

  for (const sentence of sentences) {
    const text = sentence.trim()
    if (!text) continue
    if (text.length > LONG_SCRIPT_CHUNK_TARGET * 1.5) {
      flush()
      for (let offset = 0; offset < text.length; offset += LONG_SCRIPT_CHUNK_TARGET) {
        chunks.push(text.slice(offset, offset + LONG_SCRIPT_CHUNK_TARGET).trim())
      }
      continue
    }
    if (current && current.length + text.length > LONG_SCRIPT_CHUNK_TARGET) flush()
    current += text
  }
  flush()
  return chunks
}

function preserveScriptBreakMarkers(source: string, candidate: string): string {
  const sourceParagraphs = splitScriptParagraphs(source)
  const sourceEpisodeBreaks = new Set(
    sourceParagraphs.flatMap((paragraph, index) => (paragraph.forceEpisodeBreakBefore ? [index] : [])),
  )
  const sourceShotBreaks = new Set(
    sourceParagraphs.flatMap((paragraph, index) => (paragraph.forceShotBreakBefore ? [index] : [])),
  )
  if (!sourceEpisodeBreaks.size && !sourceShotBreaks.size) return candidate

  return splitScriptParagraphs(candidate)
    .flatMap((paragraph, index) => [
      ...(sourceEpisodeBreaks.has(index) || paragraph.forceEpisodeBreakBefore
        ? [FORCE_EPISODE_BREAK_MARKER]
        : []),
      ...(sourceShotBreaks.has(index) || paragraph.forceShotBreakBefore ? [FORCE_SHOT_BREAK_MARKER] : []),
      paragraph.text,
    ])
    .join('\n')
}

function hasStructuredSceneRows(script: string): boolean {
  const paragraphs = splitScriptParagraphs(script)
  if (paragraphs.length < 2) return false
  const structuredRows = paragraphs.filter((paragraph) => {
    const fields = parseShotFields(paragraph.text)
    return Boolean(fields.场次) && Object.keys(fields).length >= 3
  }).length
  return structuredRows >= Math.max(2, Math.ceil(paragraphs.length * 0.6))
}

function alignEnrichedSceneRows(source: string, candidate: string): string {
  const sourceParagraphs = splitScriptParagraphs(source)
  const candidateParagraphs = splitScriptParagraphs(candidate)
  if (!sourceParagraphs.length || !candidateParagraphs.length) return candidate

  const candidateFields = candidateParagraphs.map((paragraph) => parseShotFields(paragraph.text))
  const preserveSceneCount = hasStructuredSceneRows(source)
  const isComplete =
    (!preserveSceneCount || candidateParagraphs.length === sourceParagraphs.length) &&
    candidateFields.every((fields) => COMPLETE_SCENE_FIELDS.every((field) => Boolean(fields[field])))
  if (isComplete) return candidate

  const sourceFields = sourceParagraphs.map((paragraph) => parseShotFields(paragraph.text))
  const candidateByScene = new Map(
    candidateFields
      .map((fields, index) => [sceneNumberKey(fields.场次, index), fields] as const)
      .filter(([key]) => key),
  )

  return sourceParagraphs
    .map((paragraph, index) => {
      const original = sourceFields[index] || {}
      const generated =
        candidateByScene.get(sceneNumberKey(original.场次, index)) || candidateFields[index] || {}
      const merged = {
        场次: generated.场次 || original.场次 || `S${String(index + 1).padStart(2, '0')}`,
        剧情: generated.剧情 || original.剧情 || '本场继续推进当前冲突，并产生明确变化。',
        场景: generated.场景 || original.场景 || '沿用上一场空间与时间',
        角色: generated.角色 || original.角色 || '沿用上一场角色；无配角，环境保持静态',
        动作:
          generated.动作 ||
          original.动作 ||
          '动作1：角色保持上一场结束姿态并确认目标；动作2：角色根据阻力改变位置或视线；动作3：角色停在下一步行动前。',
        对白: generated.对白 || original.对白 || '无台词，角色通过表情和动作传达变化',
        风格: generated.风格 || original.风格 || '沿用项目视觉风格，角色和场景材质保持统一',
        构图: generated.构图 || original.构图 || '中景，主体位于画面重心，前中后景关系清晰',
        光影: generated.光影 || original.光影 || '沿用上一场光源方向和色温，避免跳变',
        运镜: generated.运镜 || original.运镜 || '稳定跟随动作，结尾停在下一动作的起始位置',
        衔接:
          generated.衔接 ||
          original.衔接 ||
          '承接上一场最后人物位置、视线、动作、服装、物件和光线；本场结尾为下一场留下动作接点',
      }
      const row = COMPLETE_SCENE_FIELDS.map((field) => `${field}：${merged[field]}`).join('｜')
      return [
        paragraph.forceEpisodeBreakBefore ? FORCE_EPISODE_BREAK_MARKER : '',
        paragraph.forceShotBreakBefore ? FORCE_SHOT_BREAK_MARKER : '',
        row,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')
}

function sceneNumberKey(value: string | undefined, index: number): string {
  const text = String(value || '').trim()
  const match = text.match(/(?:S|场次\s*)?(\d+)/iu)
  return match?.[1] ? String(Number(match[1])) : String(index + 1)
}

function scriptScenes(script: string): string[] {
  return splitScriptParagraphs(script).map((paragraph) => paragraph.text)
}

function countStructuredScenes(script: string): number {
  return splitScriptParagraphs(script).filter((paragraph) => Boolean(parseShotFields(paragraph.text).场次))
    .length
}

function quickScriptIssues(
  script: string,
  mode: ScriptContentMode = 'short-video',
  durationSeconds = 30,
): string[] {
  const issues: string[] = []
  const characterCount = script.replace(/\s/g, '').length
  const scenes = scriptScenes(script)
  const budget = scriptContentSceneBudget(mode, durationSeconds)
  const minimumCharacters =
    mode === 'advertisement'
      ? Math.max(500, budget.target * 160)
      : mode === 'short-film'
        ? Math.max(800, budget.target * 190)
        : mode === 'web-series'
          ? 700
          : 1_800

  if (characterCount < minimumCharacters)
    issues.push(
      `内容仅 ${characterCount} 字，建议补充到 ${minimumCharacters} 字以上，确保每段有足够的可执行动作和衔接信息`,
    )
  if (scenes.length < budget.minimum || scenes.length > budget.maximum)
    issues.push(
      mode === 'web-series'
        ? `本集当前 ${scenes.length} 个场次，建议保持 ${budget.minimum} 到 ${budget.maximum} 个`
        : `当前 ${scenes.length} 个场景，目标时长建议保持 ${budget.minimum} 到 ${budget.maximum} 个`,
    )
  for (const field of QUICK_SCRIPT_FIELDS) {
    const missing = scenes.filter((scene) => !new RegExp(`${field}[：:]`).test(scene)).length
    if (missing) issues.push(`${missing} 个场景缺少“${field}”字段`)
  }
  const shortScenes = scenes.filter((scene) => scene.replace(/\s/g, '').length < 90).length
  if (shortScenes) issues.push(`${shortScenes} 个场景内容过短`)
  return issues
}

function detailedScriptIssues(
  script: string,
  mode: ScriptContentMode = 'short-video',
  durationSeconds = 30,
): string[] {
  const issues: string[] = []
  const scenes = scriptScenes(script)
  const budget = scriptContentSceneBudget(mode, durationSeconds)
  if (scenes.length < budget.minimum || scenes.length > budget.maximum)
    issues.push(`当前 ${scenes.length} 个场景，建议与 ${formatDuration(durationSeconds)} 的目标结构保持一致`)
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

const SCENE_DIRECTION_FIELD_NAMES = ['目标', '阻力', '变化', '入场状态', '出场状态'] as const
type SceneDirectionFields = Partial<Record<(typeof SCENE_DIRECTION_FIELD_NAMES)[number], string>>

type ShotDraft = Omit<CreateShot, 'scriptEpisodeId' | 'episodeNumber' | 'episodeTitle' | 'episodeKind'> & {
  episodeKind?: 'standard' | 'hook'
}

function splitScriptIntoBeatShots(
  paragraphs: ScriptParagraph[],
  maxShots: number,
  isWebSeries = false,
): ShotDraft[] {
  const shots: ShotDraft[] = []
  for (const [sceneIndex, scriptParagraph] of paragraphs.entries()) {
    const paragraph = scriptParagraph.text
    const fields = parseShotFields(paragraph)
    const direction = parseSceneDirectionFields(paragraph)
    const beats = splitFieldBeats(fields.动作 || fields.剧情 || paragraph).slice(0, 4)
    const dialogueBeats = spokenDialogueCues(fields.对白)
    const soundCues = nonSpokenSoundCues(fields.对白)
    const sceneNumber = fields.场次 || String(sceneIndex + 1)
    const previousParagraph = paragraphs[sceneIndex - 1]
    const continuesPreviousScene =
      sceneIndex > 0 &&
      !scriptParagraph.forceShotBreakBefore &&
      scenesShareVisualContinuity(previousParagraph?.text || '', paragraph)
    for (const [beatIndex, beat] of beats.entries()) {
      if (shots.length >= maxShots) return shots
      const spokenDialogue =
        dialogueBeats.length > 1
          ? dialogueBeats[beatIndex] || ''
          : beatIndex === 0
            ? dialogueBeats[0] || ''
            : ''
      const dialogue = [spokenDialogue, beatIndex === 0 ? soundCues.join('；') : '']
        .filter(Boolean)
        .join('；')
      const duration = estimateShotDuration(beat, dialogue, fields, isWebSeries)
      const previousSource =
        beatIndex > 0
          ? continuitySource(fields, direction, beats[beatIndex - 1] || '')
          : previousParagraph?.text || ''
      const currentSource = continuitySource(fields, direction, beat)
      shots.push({
        title: `场次 ${sceneNumber} · 动作 ${beatIndex + 1}`,
        framing: beatFraming(fields.构图, beat, dialogue, beatIndex, beats.length),
        duration,
        prompt: compactShotPrompt(fields, direction, beat, dialogue, duration, beatIndex, beats.length),
        negativePrompt: '',
        imageUrl: null,
        episodeBreakBefore: beatIndex === 0 && scriptParagraph.forceEpisodeBreakBefore,
        episodeKind: isHookParagraph(paragraph) && beatIndex === beats.length - 1 ? 'hook' : 'standard',
        continuityMode:
          shots.length === 0 || (beatIndex === 0 && !continuesPreviousScene) ? 'independent' : 'continue',
        continuityNote: continuityNoteFor(previousSource, beatIndex > 0 ? '上一镜' : '上一场', {
          entryState: beatIndex === 0 ? direction.入场状态 : undefined,
          exitState: beatIndex === beats.length - 1 ? direction.出场状态 : undefined,
          current: currentSource,
          visualContinuity: beatIndex > 0 || continuesPreviousScene,
        }),
      })
    }
  }
  return shots
}

function splitScriptIntoSceneShots(
  paragraphs: ScriptParagraph[],
  maxShots: number,
  isWebSeries = false,
): ShotDraft[] {
  return paragraphs.slice(0, maxShots).map((scriptParagraph, index) => {
    const paragraph = scriptParagraph.text
    const fields = parseShotFields(paragraph)
    const direction = parseSceneDirectionFields(paragraph)
    const structured = Object.keys(fields).length > 1
    const previousParagraph = paragraphs[index - 1]
    const continuesPreviousScene =
      index > 0 &&
      !scriptParagraph.forceShotBreakBefore &&
      scenesShareVisualContinuity(previousParagraph?.text || '', paragraph)
    return {
      title: `镜头 ${String(index + 1).padStart(2, '0')}`,
      framing: sceneFraming(fields, index),
      duration: structured
        ? estimateShotDuration(fields.动作 || fields.剧情 || paragraph, fields.对白, fields, isWebSeries)
        : Math.min(15, Math.max(isWebSeries ? 3 : 4, Math.ceil(paragraph.length / 18))),
      prompt: structured
        ? compactShotPrompt(
            fields,
            direction,
            fields.动作 || fields.剧情 || paragraph,
            fields.对白,
            undefined,
            0,
            1,
            'scene',
          )
        : paragraph,
      negativePrompt: '',
      imageUrl: null,
      episodeBreakBefore: scriptParagraph.forceEpisodeBreakBefore,
      episodeKind: isHookParagraph(paragraph) ? ('hook' as const) : ('standard' as const),
      continuityMode:
        index === 0 || !continuesPreviousScene ? ('independent' as const) : ('continue' as const),
      continuityNote: continuityNoteFor(previousParagraph?.text || '', '上一场', {
        entryState: direction.入场状态,
        exitState: direction.出场状态,
        current: paragraph,
        visualContinuity: continuesPreviousScene,
      }),
    }
  })
}

function splitScriptIntoSmartSceneShots(
  paragraphs: ScriptParagraph[],
  maxShots: number,
  isWebSeries = false,
): ShotDraft[] {
  const sceneShots = splitScriptIntoSceneShots(paragraphs, maxShots, isWebSeries)
  if (paragraphs.length !== 1 || sceneShots.length !== 1) return sceneShots

  const actionShots = splitScriptIntoBeatShots(paragraphs, maxShots, isWebSeries)
  return actionShots.length > 1 ? actionShots : sceneShots
}

function isHookParagraph(paragraph: string): boolean {
  const fields = parseShotFields(paragraph)
  return /剧情钩子|悬念钩子|结尾钩子/u.test(fields.场次 || '') || /^【?剧情钩子】?/u.test(paragraph)
}

function continuityNoteFor(
  previous: string,
  previousLabel: '上一场' | '上一镜',
  sceneState: {
    entryState?: string | undefined
    exitState?: string | undefined
    current?: string | undefined
    visualContinuity?: boolean | undefined
  } = {},
): string {
  if (!previous.trim()) return ''
  const previousDirection = parseSceneDirectionFields(previous)
  const previousFields = parseShotFields(previous)
  const currentFields = parseShotFields(sceneState.current || '')
  const previousAction = previousFields.动作 || previousFields.剧情 || previous
  const currentAction = currentFields.动作 || currentFields.剧情 || sceneState.current || ''
  return [
    sceneState.visualContinuity
      ? `${previousLabel}已完成；首帧直接承接该镜真实尾帧，不得重演、解释或复述上一镜已经完成的事件。`
      : `${previousLabel}已完成；本镜使用独立首帧，只承接剧情状态，不携带上一场画面构图。`,
    `上一镜终态：${[
      previousFields.场景 ? `场景在${headExcerpt(previousFields.场景, 100)}` : '',
      previousFields.角色 ? `人物为${headExcerpt(previousFields.角色, 140)}` : '',
      previousAction ? `已完成${tailExcerpt(previousAction, 180)}` : '',
      previousDirection.出场状态 ? `形成${tailExcerpt(previousDirection.出场状态, 180)}` : '',
    ]
      .filter(Boolean)
      .join('；')}`,
    `本镜动作起点：${[
      currentFields.场景 ? `场景为${headExcerpt(currentFields.场景, 100)}` : '',
      currentFields.角色 ? `画内人物为${headExcerpt(currentFields.角色, 140)}` : '',
      sceneState.entryState ? headExcerpt(sceneState.entryState, 180) : '',
      currentAction ? `随后只执行${headExcerpt(currentAction, 180)}` : '',
    ]
      .filter(Boolean)
      .join('；')}`,
    sceneState.visualContinuity
      ? '人物位置、视线、动作方向、服装、关键物品和光线保持连续；本镜直接执行自己的主动作。'
      : '人物身份、服装和关键物品归属保持连续；人物位置、构图与光线按本镜新场景重新建立。',
    '本镜结束时保留清晰的结束姿态、视线落点和物件状态，供下一镜真实尾帧直接承接。',
    sceneState.exitState ? `本镜所在场次的最终出场状态：${tailExcerpt(sceneState.exitState, 220)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function continuitySource(
  fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>>,
  direction: SceneDirectionFields,
  action: string,
): string {
  return [
    fieldPart('场景', fields.场景, 320),
    fieldPart('角色', fields.角色, 420),
    fieldPart('动作', action, 520),
    fieldPart('入场状态', direction.入场状态, 240),
    fieldPart('出场状态', direction.出场状态, 240),
  ]
    .filter(Boolean)
    .join('｜')
}

function scenesShareVisualContinuity(previous: string, current: string): boolean {
  if (!previous.trim() || !current.trim()) return false
  const previousScene = parseShotFields(previous).场景 || ''
  const currentScene = parseShotFields(current).场景 || ''
  if (/^(?:沿用|承接|继续)(?:上一场|上场|前场)/u.test(currentScene.trim())) return true
  if (!previousScene.trim() && !currentScene.trim()) return true
  if (!previousScene.trim() || !currentScene.trim()) return false
  const previousMoment = sceneMoment(previousScene)
  const currentMoment = sceneMoment(currentScene)
  if (previousMoment && currentMoment && previousMoment !== currentMoment) return false
  const previousIdentity = normalizedSceneIdentity(previousScene)
  const currentIdentity = normalizedSceneIdentity(currentScene)
  if (!previousIdentity || !currentIdentity) return false
  return (
    previousIdentity === currentIdentity ||
    (Math.min(previousIdentity.length, currentIdentity.length) >= 4 &&
      (previousIdentity.includes(currentIdentity) || currentIdentity.includes(previousIdentity)))
  )
}

function sceneMoment(value: string): 'dawn' | 'day' | 'sunset' | 'night' | '' {
  if (/清晨|黎明|拂晓|日出/u.test(value)) return 'dawn'
  if (/黄昏|傍晚|日落/u.test(value)) return 'sunset'
  if (/深夜|夜晚|夜间|雨夜|雪夜|午夜/u.test(value)) return 'night'
  if (/白天|上午|中午|下午|日间/u.test(value)) return 'day'
  return ''
}

function normalizedSceneIdentity(value: string): string {
  return value
    .split(/[，,；;。]/u)[0]!
    .replace(/(?:清晨|早晨|上午|中午|下午|傍晚|黄昏|深夜|夜晚|夜间|白天|雨天|雪天|晴天|雾天)/gu, '')
    .replace(/[\s·|｜()（）【】\-—]/gu, '')
    .trim()
}

function episodeOpeningContinuityNote(
  previousEpisode: ScriptEpisode | undefined,
  episode: ScriptEpisode,
  shotContinuityNote: string,
): string {
  if (!previousEpisode) return shotContinuityNote
  const previousState = Object.keys(previousEpisode.continuityState || {}).length
    ? JSON.stringify(previousEpisode.continuityState)
    : previousEpisode.summary || previousEpisode.content.replace(/\s+/gu, ' ').slice(-500)
  return [
    `剧集边界：第 ${episode.episodeNumber} 集使用独立首帧，不得读取上一集尾帧作为视觉参考。`,
    `上一集剧情终态：${tailExcerpt(previousState, 500)}`,
    '只承接人物关系、已知信息、情绪和关键物品归属；当前镜头的场景、时间、人物位置与动作以本集开场分镜为准。',
    shotContinuityNote,
  ]
    .filter(Boolean)
    .join('\n')
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
    const match = segment
      .trim()
      .replace(/^\*{1,2}|\*{1,2}$/gu, '')
      .match(/^([^：:]+)[：:]([\s\S]*)$/)
    const key = match?.[1]?.replace(/[*_`#【】[\]]/gu, '').trim() as
      (typeof SHOT_FIELD_NAMES)[number] | undefined
    if (key && SHOT_FIELD_NAMES.includes(key)) {
      fields[key] = match?.[2]?.replace(/^\*{1,2}|\*{1,2}$/gu, '').trim() || ''
    }
  }
  return fields
}

function parseSceneDirectionFields(paragraph: string): SceneDirectionFields {
  const fields: SceneDirectionFields = {}
  for (const segment of paragraph.split('｜')) {
    const match = segment
      .trim()
      .replace(/^\*{1,2}|\*{1,2}$/gu, '')
      .match(/^([^：:]+)[：:]([\s\S]*)$/)
    const key = match?.[1]?.replace(/[*_`#【】[\]]/gu, '').trim() as
      (typeof SCENE_DIRECTION_FIELD_NAMES)[number] | undefined
    if (key && SCENE_DIRECTION_FIELD_NAMES.includes(key)) {
      fields[key] = match?.[2]?.replace(/^\*{1,2}|\*{1,2}$/gu, '').trim() || ''
    }
  }
  return fields
}

function splitFieldBeats(value: string, splitCommas = false): string[] {
  const text = value.trim()
  if (!text) return []
  const explicitActionBeats = text
    .split(/(?=动作\s*[1-9][0-9]*\s*[：:])/u)
    .map((item) => item.trim())
    .filter(Boolean)
  // `动作1/动作2` is the production contract. Commas inside one labelled action
  // describe its performance details and must never create extra video shots.
  if (explicitActionBeats.some((item) => /^动作\s*[1-9][0-9]*\s*[：:]/u.test(item))) {
    return explicitActionBeats
  }
  const semicolonBeats = text
    .split(
      splitCommas ? /[；;，,]+|(?=动作\s*[1-9][0-9]*\s*[：:])/u : /[；;]+|(?=动作\s*[1-9][0-9]*\s*[：:])/u,
    )
    .map((item) => item.trim())
    .filter(Boolean)
  if (semicolonBeats.length > 1) return semicolonBeats
  return text
    .split(/(?<=[。！？!?])/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function spokenDialogueCues(value: string | undefined): string[] {
  const text = String(value || '').trim()
  if (!text) return []
  const tagged = splitTaggedAudioCues(text).filter((cue) => /^\[(?:对白|台词|画外音|内心独白)\]/u.test(cue))
  if (tagged.length) return tagged
  return splitFieldBeats(text).filter(
    (cue) => !/无台词|静音|^\[(?:音效|环境声|音乐|音乐\/环境声)\]/u.test(cue),
  )
}

function nonSpokenSoundCues(value: string | undefined): string[] {
  return splitTaggedAudioCues(String(value || '')).filter((cue) =>
    /^\[(?:音效|环境声|音乐|音乐\/环境声)\]/u.test(cue),
  )
}

function splitTaggedAudioCues(value: string): string[] {
  return value
    .split(/(?=\[(?:对白|台词|画外音|内心独白|音效|环境声|音乐|音乐\/环境声)\])/u)
    .map((cue) => cue.trim().replace(/^[；;]+|[；;]+$/gu, ''))
    .filter(Boolean)
}

function compactShotPrompt(
  fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>>,
  direction: SceneDirectionFields,
  beat: string,
  dialogue?: string,
  duration?: number,
  beatIndex = 0,
  beatCount = 1,
  scope: 'scene' | 'beat' = 'beat',
): string {
  const action = beat.trim() || fields.动作 || '角色保持当前状态并产生可见变化'
  const resolvedDialogue =
    dialogue === undefined
      ? fields.对白 || '无台词，角色通过表情和动作传达变化'
      : dialogue || '无台词，仅保留本镜动作声、环境声和画内人物反应'
  return [
    fieldPart('场次', fields.场次 || '未编号场次', 24),
    fieldPart('剧情', fields.剧情 || '本场继续推进当前冲突', 260),
    fieldPart('目标', direction.目标 || '角色完成当前可见行动', 180),
    fieldPart('阻力', direction.阻力 || '当前环境或对手阻碍角色推进', 180),
    fieldPart('变化', direction.变化 || '动作结束后角色状态发生可见变化', 180),
    fieldPart('场景', fields.场景 || '沿用上一场空间与时间', 320),
    fieldPart('角色', fields.角色 || '沿用上一场所有角色；每位画面内人物都必须有动作、表情或视线变化', 420),
    ...(beatIndex === 0 ? [fieldPart('入场状态', direction.入场状态, 240)] : []),
    fieldPart(
      '镜头边界',
      scope === 'scene'
        ? '本镜只覆盖当前场次，按动作字段顺序完成，不重演上一场，不提前进入下一场'
        : '本镜只表现当前动作，不重演上一镜已完成动作，不提前执行本场后续动作',
      160,
    ),
    fieldPart('动作', action, 520),
    fieldPart('对白', resolvedDialogue, 280),
    fieldPart('风格', fields.风格 || '沿用项目视觉风格，角色与场景材质统一', 180),
    fieldPart('构图', fields.构图 || '中景，主体位于画面重心，前中后景清晰', 220),
    fieldPart('光影', fields.光影 || '沿用上一场光源方向和色温，避免跳变', 200),
    fieldPart('运镜', fields.运镜 || '稳定跟随动作，结尾停在下一动作起点', 240),
    fieldPart('衔接', fields.衔接 || '承接上一场人物位置、视线、动作、服装、物件和光线状态', 300),
    ...(beatIndex === beatCount - 1 ? [fieldPart('出场状态', direction.出场状态, 240)] : []),
    fieldPart('导演节拍', directorBeatFor(action, fields.角色, resolvedDialogue, duration, scope), 480),
  ]
    .filter(Boolean)
    .join('｜')
}

function estimateShotDuration(
  beat: string,
  dialogue: string | undefined,
  fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>>,
  isWebSeries: boolean,
): number {
  const action = String(beat || fields.动作 || fields.剧情 || '').trim()
  const spokenCharacters = dialogueTextForTiming(dialogue).length
  const dialogueSeconds = spokenCharacters ? Math.ceil(spokenCharacters / 4) + 1 : 0
  const reactionOnly =
    /(?:抬眼|抬头|回头|转头|对视|凝视|停住|停步|皱眉|屏住呼吸|吸气|惊愕|错愕|警觉|眼神)/u.test(action) &&
    !/(?:走|跑|冲|进入|离开|打开|关上|拿起|放下|递|接|抓|推|拉|击|躲|拥抱|贴近|划过|投出|操作|按住|伸手|抬手|举起|拨开|握住)/u.test(
      action,
    )
  const movementOrInteraction =
    /(?:走|跑|冲|进入|离开|打开|关上|拿起|放下|递|接|抓|推|拉|击|躲|转身|跪|起身|坐下|贴近|划过|投出|操作|按住|伸手|抬手|举起|拨开|握住)/u.test(
      action,
    )
  const actionSeconds = reactionOnly ? 3 : movementOrInteraction ? 5 : 4
  const baseDuration = Math.max(actionSeconds, dialogueSeconds)

  // 网剧允许少量 3 秒反应镜，其余镜头至少留出一个完整动作和一次表情变化。
  const minimum = isWebSeries && reactionOnly && !dialogueSeconds ? 3 : 4
  return Math.min(15, Math.max(minimum, baseDuration || minimum))
}

function dialogueTextForTiming(dialogue: string | undefined): string {
  const source = String(dialogue || '')
  const spokenCues = spokenDialogueCues(source)
  return (spokenCues.length ? spokenCues.join('；') : source)
    .replace(/\[(?:对白|台词|画外音|内心独白)\]/gu, '')
    .replace(/(?:^|[；;])[^：:\n]{1,16}[：:]/gu, '')
    .replace(/\[(?:音效|环境声|音乐|音乐\/环境声)\][^；;]*/gu, '')
    .replace(/[\s，。！？、；;“”"'（）()——-]/gu, '')
    .trim()
}

function directorBeatFor(
  action: string,
  roleField: string | undefined,
  dialogue: string | undefined,
  duration: number | undefined,
  scope: 'scene' | 'beat' = 'beat',
): string {
  const roles = namedRolesForDirector(roleField)
  const lead = roles[0] || '主角'
  const supporting = roles.slice(1).join('、')
  const hasDialogue = dialogueTextForTiming(dialogue).length > 0 && !/无台词/u.test(String(dialogue || ''))
  const endSecond = Math.max(2, Number(duration || 4) - 1)
  return [
    scope === 'scene'
      ? `本镜完整表现当前场次，不新增场外事件：${headExcerpt(action, 180)}`
      : `本镜只完成一个主动作：${headExcerpt(action, 180)}`,
    scope === 'scene'
      ? `0-1 秒承接入场状态，1-${endSecond} 秒按动作字段的既定顺序完成表演与反应，最后 1 秒固定人物位置、视线和物件状态`
      : `0-1 秒承接既有状态，1-${endSecond} 秒完整表现动作起势、执行与一次表情或视线变化，最后 1 秒停在可被下一镜承接的结束姿态`,
    supporting
      ? `主角 ${lead} 推进主动作；配角 ${supporting} 只做同步的转头、视线、停步或姿态反应，不新增第二个剧情动作`
      : `主角 ${lead} 推进主动作；其他画内人物只做同步的视线、表情或姿态反应，不新增第二个剧情动作`,
    hasDialogue
      ? '对白在动作进行中自然说完，口型与听者反应同步，不为念完长台词而另起动作'
      : '无对白时用表情、视线、环境声和动作音效推进信息，不留空镜填时长',
  ].join('；')
}

function namedRolesForDirector(roleField: string | undefined): string[] {
  const raw = String(roleField || '').trim()
  if (!raw) return []
  const profiledRoles = [...raw.matchAll(/(?:^|[；;])\s*([^（(；;]{1,40})[（(]/gu)]
    .map((match) => match[1]?.trim())
    .filter((name): name is string => Boolean(name))
  if (profiledRoles.length) return profiledRoles
  return raw
    .split(/[；;]/u)
    .flatMap((role) => (role.split(/[，,]/u)[0] || '').split('、'))
    .map((role) => role.replace(/[（(].*$/u, '').trim())
    .filter(Boolean)
}

function fieldPart(label: string, value: string | undefined, limit: number): string {
  const text = String(value || '').trim()
  return text ? `${label}：${text.slice(0, limit)}` : ''
}

function beatFraming(
  composition: string | undefined,
  beat: string,
  dialogue: string | undefined,
  beatIndex: number,
  beatCount: number,
): string {
  const explicit = ['大全景', '全景', '广角', '俯拍', '中景', '中近景', '近景', '特写'].find((framing) =>
    composition?.includes(framing),
  )
  if (beatIndex === 0) {
    return explicit || (/走|跑|冲|进入|离开|战斗|追逐/u.test(beat) ? '全景' : '大全景')
  }
  if (/看清|发现|信封|手机|屏幕|戒指|钥匙|照片|证据|按钮|伤口/u.test(beat)) return '特写'
  if (dialogueTextForTiming(dialogue).length || /表情|眼神|皱眉|流泪|惊愕|错愕|警觉/u.test(beat)) {
    return beatIndex === beatCount - 1 ? '特写' : '近景'
  }
  if (/走|跑|冲|进入|离开|打|击|躲|转身|起身|坐下|拥抱|推|拉/u.test(beat)) return '中景'
  if (beatIndex === beatCount - 1) return '近景'
  return '中景'
}

function sceneFraming(
  fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>>,
  index: number,
): string {
  const action = fields.动作 || fields.剧情 || ''
  const explicit = ['大全景', '全景', '广角', '俯拍', '中景', '中近景', '近景', '特写'].find((framing) =>
    fields.构图?.includes(framing),
  )
  if (explicit) return explicit
  if (/看清|发现|信封|手机|屏幕|戒指|钥匙|照片|证据|按钮|伤口/u.test(action)) return '特写'
  if (fields.对白 || /表情|眼神|皱眉|流泪|惊愕|错愕|警觉/u.test(action)) return '中近景'
  if (/走|跑|冲|进入|离开|战斗|追逐|人群|全貌/u.test(action)) return '全景'
  return index === 0 ? '大全景' : '中景'
}

function assetSummary(assets: Asset[]): string {
  if (!assets.length) return '暂无，请根据原始素材建立一致的人物、场景和道具设定'
  return assets
    .slice(0, 16)
    .map((asset) => {
      const parts = [
        `${asset.kind}:${asset.name}`,
        asset.description ? `说明：${headExcerpt(asset.description, 220)}` : '',
        asset.prompt ? `生成提示词：${headExcerpt(asset.prompt, 260)}` : '',
        assetAttributeSummary(asset),
      ].filter(Boolean)
      return parts.join('；')
    })
    .join('；')
}

function assetAttributeSummary(asset: Asset): string {
  const attributes = asset.attributes
  if (attributes.type === 'character') {
    return `结构化身份：${[
      attributes.subjectType,
      attributes.gender,
      attributes.exactAge ? `${attributes.exactAge}岁` : attributes.ageGroup,
      attributes.species,
      attributes.visualStyle,
      attributes.bodyType,
      attributes.background,
    ]
      .filter(Boolean)
      .join('、')}`
  }
  if (attributes.type === 'scene') {
    return `结构化场景：${[
      attributes.space,
      attributes.sceneType,
      attributes.era,
      attributes.time,
      attributes.weather,
      attributes.mood,
      attributes.camera,
      attributes.visualStyle,
    ]
      .filter(Boolean)
      .join('、')}`
  }
  if (attributes.type === 'prop') {
    return `结构化物品：${[
      attributes.category,
      attributes.material,
      attributes.condition,
      attributes.view,
      attributes.background,
      attributes.visualStyle,
    ]
      .filter(Boolean)
      .join('、')}`
  }
  if (attributes.type === 'costume') {
    return `结构化服装：${[
      attributes.audience,
      attributes.category,
      attributes.season,
      attributes.design,
      attributes.presentation,
      attributes.visualStyle,
    ]
      .filter(Boolean)
      .join('、')}`
  }
  if (attributes.type === 'brand') {
    return `结构化品牌：${[
      attributes.brandType,
      attributes.usage,
      attributes.layout,
      attributes.exactText,
      attributes.palette,
      attributes.visualStyle,
    ]
      .filter(Boolean)
      .join('、')}`
  }
  return ''
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

function parseProviderJson<T>(
  raw: string,
  schema: z.ZodType<T>,
  errorMessage: string,
  normalize: (value: unknown) => unknown = (value) => value,
): T {
  for (const candidate of providerJsonCandidates(raw)) {
    try {
      const result = schema.safeParse(normalize(parseJsonCandidate(candidate)))
      if (result.success) return result.data
    } catch {
      // Continue through the remaining fenced, balanced, and repaired candidates.
    }
  }
  throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', errorMessage)
}

function providerJsonCandidates(raw: string): string[] {
  const text = raw
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
  const candidates: string[] = [text]
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]) candidates.push(match[1].trim())
  }

  const initialCandidates = candidates.slice()
  for (const source of initialCandidates) {
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] !== '{' && source[index] !== '[') continue
      const balanced = balancedJsonSlice(source, index)
      if (balanced) candidates.push(balanced)
      candidates.push(source.slice(index).trim())
      if (candidates.length >= 24) break
    }
    if (candidates.length >= 24) break
  }

  return [...new Set(candidates.filter(Boolean))]
}

function balancedJsonSlice(text: string, start: number): string | null {
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{' || character === '[') stack.push(character)
    if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '['
      if (stack.pop() !== expected) return null
      if (!stack.length) return text.slice(start, index + 1)
    }
  }
  return null
}

function parseJsonCandidate(candidate: string): unknown {
  let value: unknown = JSON.parse(jsonrepair(candidate))
  for (let depth = 0; depth < 3 && typeof value === 'string'; depth += 1) {
    const nested = value.trim()
    if (!nested.startsWith('{') && !nested.startsWith('[')) break
    value = JSON.parse(jsonrepair(nested))
  }
  return value
}

function normalizeScriptAssetSuggestionPayload(value: unknown): unknown {
  let root: unknown = value
  let inheritedSummary: unknown
  for (let depth = 0; depth < 5; depth += 1) {
    const record = asRecord(root)
    inheritedSummary ??= record?.summary ?? record?.['总结'] ?? record?.['概述'] ?? record?.['资产概述']
    if (record && hasAssetCollection(record)) break
    const nested =
      record &&
      ['data', 'result', 'output', 'response', 'payload', 'content']
        .map((key) => record[key])
        .find((candidate) => candidate !== undefined && candidate !== null)
    if (nested !== undefined) {
      root = nested
      continue
    }
    break
  }

  if (Array.isArray(root)) root = { assets: root }
  const rootRecord = asRecord(root)
  if (!rootRecord) return value

  const assetValue =
    rootRecord.assets ??
    rootRecord.suggestions ??
    rootRecord['资产'] ??
    rootRecord['资产建议'] ??
    rootRecord['建议资产']
  const assetContainer = asRecord(assetValue)
  const categorizedEntries = Object.entries(assetContainer || rootRecord).filter(
    ([key, entry]) => normalizeScriptAssetKind(key) && Array.isArray(entry),
  )
  const rawAssets: unknown[] = Array.isArray(assetValue)
    ? assetValue
    : categorizedEntries.flatMap(([key, entry]) =>
        (entry as unknown[]).map((item) => {
          const itemRecord = asRecord(item)
          return itemRecord ? { ...itemRecord, kind: itemRecord.kind || key } : { kind: key, name: item }
        }),
      )
  const assets = rawAssets
    .map((item) => normalizeProviderAssetSuggestion(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .slice(0, 16)

  return {
    summary: textValue(
      rootRecord.summary ??
        rootRecord['总结'] ??
        rootRecord['概述'] ??
        rootRecord['资产概述'] ??
        inheritedSummary,
      '已根据剧本提取可复用的人物、场景、物品和服装。',
      700,
    ),
    assets,
  }
}

function normalizeProviderAssetSuggestion(value: unknown): Record<string, unknown> | null {
  const source = asRecord(value)
  if (!source) return null
  const kind = normalizeScriptAssetKind(
    source.kind ?? source.type ?? source.assetType ?? source.category ?? source['类型'] ?? source['资产类型'],
  )
  if (!kind) return null
  const attributes = asRecord(source.attributes ?? source.properties ?? source.details)
  const read = (key: string) => attributes?.[key] ?? source[key]
  const name = textValue(
    source.name ??
      source.title ??
      source.label ??
      source.assetName ??
      source['资产名'] ??
      source['名称'] ??
      source['角色名'] ??
      source['场景名'],
    '',
    120,
  ).trim()
  if (!name) return null

  return {
    kind,
    name,
    description: textValue(
      source.description ?? source.summary ?? source.profile ?? source['设定'],
      name,
      500,
    ),
    prompt: textValue(
      source.prompt ??
        source.visualNotes ??
        source.visual_notes ??
        source['视觉要点'] ??
        source.visualPrompt ??
        source.generationPrompt ??
        source.visual_prompt ??
        source.generation_prompt ??
        source['提示词'] ??
        source.description,
      name,
      5_000,
    ),
    negativePrompt: textValue(
      source.negativePrompt ?? source.negative_prompt ?? source['负面提示词'],
      '',
      2_000,
    ),
    reason: textValue(source.reason ?? source.why ?? source['原因'], '根据剧本核心实体建立可复用资产。', 500),
    priority: normalizePriority(source.priority ?? source.importance ?? source['优先级']),
    attributes: normalizeScriptAssetAttributes(kind, read),
  }
}

function scriptAssetSuggestionMaxTokens(candidateCount: number): number {
  const expectedAssetCount = Math.min(16, Math.max(8, candidateCount))
  return Math.min(
    SCRIPT_ASSET_SUGGESTIONS_MAX_TOKENS,
    Math.max(SCRIPT_ASSET_SUGGESTIONS_MIN_TOKENS, 2_200 + expectedAssetCount * 110),
  )
}

function buildScriptAssetEvidence(script: string): { text: string; candidateCount: number } {
  const names = extractScriptAssetEvidenceNameIndex(script)
  const labels: Record<ScriptAssetKind, string> = {
    character: '人物',
    scene: '场景',
    prop: '物品',
    costume: '服装',
    brand: '品牌',
  }
  const indexLines = (Object.entries(names) as [ScriptAssetKind, string[]][])
    .filter(([, values]) => values.length)
    .map(([kind, values]) => `${labels[kind]}候选：${values.join('、')}`)

  const rankedNames = (Object.entries(names) as [ScriptAssetKind, string[]][])
    .flatMap(([kind, values]) =>
      values.map((name, index) => ({
        kind,
        name,
        index,
        occurrences: countTextOccurrences(script, name),
      })),
    )
    .sort((left, right) => right.occurrences - left.occurrences || left.index - right.index)
    .slice(0, 16)
  const detailLines = rankedNames.flatMap(({ kind, name }) => {
    const evidence = assetEvidenceSnippets(name, script)
    return evidence ? [`${labels[kind]}「${name}」证据：${evidence}`] : []
  })
  const sceneSamples = distributedScriptParagraphs(script, 6, 340)
  const candidateCount = new Set(rankedNames.map(({ kind, name }) => `${kind}:${name}`)).size

  return {
    text: [
      indexLines.length ? `全剧结构化字段索引：\n${indexLines.join('\n')}` : '',
      detailLines.length ? `核心候选上下文：\n${detailLines.join('\n')}` : '',
      sceneSamples.length ? `分布式场次采样：\n${sceneSamples.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    candidateCount,
  }
}

function extractScriptAssetEvidenceNameIndex(script: string): ScriptAssetNameIndex {
  return {
    character: extractAssetNames(script, ['角色', '人物', '主角'], [], 24, 'character'),
    scene: extractAssetNames(script, ['场景', '地点'], [], 24, 'scene'),
    prop: extractAssetNames(script, ['关键物件', '关键道具', '物件', '道具'], [], 32, 'prop'),
    costume: extractAssetNames(script, ['服装', '衣装', '外观'], [], 20, 'costume'),
    brand: extractAssetNames(script, ['品牌', '品牌标识', 'Logo', 'logo'], [], 12, 'brand'),
  }
}

function countTextOccurrences(text: string, search: string): number {
  if (!search) return 0
  let count = 0
  let from = 0
  while (from < text.length) {
    const index = text.indexOf(search, from)
    if (index < 0) break
    count += 1
    from = index + search.length
  }
  return count
}

function assetEvidenceSnippets(name: string, script: string): string {
  if (!name || !script) return ''
  const snippets: string[] = []
  let from = 0
  while (from < script.length && snippets.length < 6) {
    const index = script.indexOf(name, from)
    if (index < 0) break
    const start = Math.max(0, index - 100)
    const end = Math.min(script.length, index + name.length + 150)
    const snippet = script
      .slice(start, end)
      .replace(/\s+/gu, ' ')
      .replace(/^.*?(?=(?:场次|剧情|场景|角色|人物|主角|关键物件|道具|服装|品牌)\s*[：:])/u, '')
      .trim()
    const compactSnippet = headExcerpt(snippet, 170)
    if (compactSnippet && !snippets.includes(compactSnippet)) snippets.push(compactSnippet)
    from = index + name.length
  }
  if (snippets.length <= 2) return snippets.join('；')
  return [snippets[0], snippets.at(-1)].filter(Boolean).join('；')
}

function distributedScriptParagraphs(script: string, limit: number, paragraphLimit: number): string[] {
  const paragraphs = splitScriptParagraphs(script)
    .map(({ text }) => text.trim())
    .filter(Boolean)
  if (paragraphs.length <= 1 && script.length > paragraphLimit) {
    return distributedTextExcerpts(script, limit, paragraphLimit)
  }
  if (!paragraphs.length) return []
  if (paragraphs.length <= limit) return paragraphs.map((paragraph) => headExcerpt(paragraph, paragraphLimit))

  const indexes = new Set<number>()
  for (let index = 0; index < limit; index += 1) {
    indexes.add(Math.round((index * (paragraphs.length - 1)) / (limit - 1)))
  }
  return [...indexes].map((index) => headExcerpt(paragraphs[index] || '', paragraphLimit)).filter(Boolean)
}

function distributedTextExcerpts(text: string, limit: number, excerptLimit: number): string[] {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (!normalized) return []
  if (normalized.length <= excerptLimit) return [normalized]

  const maxStart = Math.max(0, normalized.length - excerptLimit)
  const excerpts: string[] = []
  for (let index = 0; index < limit; index += 1) {
    const start = Math.round((index * maxStart) / Math.max(1, limit - 1))
    const excerpt = normalized.slice(start, start + excerptLimit).trim()
    if (excerpt && !excerpts.includes(excerpt)) excerpts.push(excerpt)
  }
  return excerpts
}

function hasAssetCategory(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => normalizeScriptAssetKind(key) && Array.isArray(value[key]))
}

function hasAssetCollection(value: Record<string, unknown>): boolean {
  return (
    ['assets', 'suggestions', '资产', '资产建议', '建议资产'].some((key) => key in value) ||
    hasAssetCategory(value)
  )
}

function assetSuggestionWarning(error: unknown): string {
  if (error instanceof AppError && error.code === 'PROVIDER_RESPONSE_INVALID') {
    return '模型返回格式异常，资产结构无法解析，已根据剧本文本做基础资产建议；可检查模型输出格式后重试'
  }
  if (error instanceof Error && error.message) {
    return `资产建议调用失败：${error.message}；已根据剧本文本做基础资产建议`
  }
  return '资产建议生成失败，已根据剧本文本做基础资产建议'
}

function normalizeScriptAssetKind(value: unknown): ScriptAssetKind | null {
  if (typeof value !== 'string') return null
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_/-]+/g, '')
  if (
    [
      'character',
      'characters',
      'person',
      'people',
      '人物',
      '角色',
      '人物角色',
      '人物资产',
      '角色资产',
    ].includes(normalized)
  )
    return 'character'
  if (['scene', 'scenes', 'location', 'locations', '场景', '地点', '地方', '场景资产'].includes(normalized))
    return 'scene'
  if (['prop', 'props', 'item', 'items', '物品', '道具', '物品资产', '道具资产'].includes(normalized))
    return 'prop'
  if (['costume', 'costumes', 'outfit', 'outfits', '服装', '衣装', '服装资产'].includes(normalized))
    return 'costume'
  if (
    ['brand', 'branding', 'logo', 'logomark', '品牌', '品牌标识', 'logo资产', '品牌资产'].includes(normalized)
  )
    return 'brand'
  return null
}

function normalizeScriptAssetAttributes(
  kind: ScriptAssetKind,
  read: (key: string) => unknown,
): Record<string, unknown> {
  const visualStyles = [
    'photorealistic',
    'cinematic-cg',
    'chinese-3d',
    'chinese-2d',
    'anime',
    'storybook',
  ] as const
  if (kind === 'character') {
    const subjectType = pickEnum(read('subjectType'), ['human', 'animal'] as const, 'human')
    return {
      type: 'character',
      subjectType,
      gender:
        subjectType === 'animal'
          ? 'unspecified'
          : pickEnum(read('gender'), ['male', 'female', 'unspecified'] as const, 'unspecified'),
      ageGroup: pickEnum(read('ageGroup'), ['child', 'teen', 'young', 'middle', 'senior'] as const, 'young'),
      exactAge: normalizeExactAge(read('exactAge')),
      ethnicity: pickEnum(
        read('ethnicity'),
        [
          'unspecified',
          'east-asian',
          'south-asian',
          'southeast-asian',
          'white',
          'black',
          'latino',
          'middle-eastern',
          'mixed',
          'other',
        ] as const,
        'unspecified',
      ),
      skinTone: pickEnum(
        read('skinTone'),
        ['unspecified', 'fair', 'light', 'medium', 'tan', 'deep', 'dark'] as const,
        'unspecified',
      ),
      eyeColor: pickEnum(
        read('eyeColor'),
        ['unspecified', 'black', 'dark-brown', 'brown', 'hazel', 'green', 'blue', 'gray', 'amber'] as const,
        'unspecified',
      ),
      hairColor: pickEnum(
        read('hairColor'),
        ['unspecified', 'black', 'dark-brown', 'brown', 'blonde', 'red', 'gray', 'white', 'other'] as const,
        'unspecified',
      ),
      species: textValue(read('species'), '', 80),
      anthropomorphic: Boolean(read('anthropomorphic')),
      visualStyle: pickEnum(read('visualStyle'), visualStyles, 'cinematic-cg'),
      framing: pickEnum(read('framing'), ['portrait', 'half', 'full'] as const, 'portrait'),
      bodyType: pickEnum(read('bodyType'), ['slim', 'balanced', 'athletic', 'full'] as const, 'balanced'),
      background: pickEnum(
        read('background'),
        ['solid', 'transparent', 'environment'] as const,
        'transparent',
      ),
      faceStatus: pickEnum(read('faceStatus'), ['pending', 'approved'] as const, 'pending'),
      bodyStatus: pickEnum(read('bodyStatus'), ['pending', 'approved'] as const, 'pending'),
      faceReference: normalizeMediaReference(read('faceReference')),
      bodyReference: normalizeMediaReference(read('bodyReference')),
      portraitSource: pickEnum(
        read('portraitSource'),
        ['ai-virtual', 'authorized-real'] as const,
        'ai-virtual',
      ),
      trustedPortrait: null,
      legStretch: Boolean(read('legStretch')),
      turnaround: Boolean(read('turnaround')),
      turnaroundLayout: pickEnum(read('turnaroundLayout'), ['sheet', 'separate'] as const, 'sheet'),
      appearanceVariants: [],
      activeAppearanceVariantId: null,
    }
  }
  if (kind === 'scene') {
    return {
      type: 'scene',
      space: pickEnum(read('space'), ['interior', 'exterior'] as const, 'exterior'),
      sceneType: pickEnum(
        read('sceneType'),
        [
          'city',
          'street',
          'residential',
          'commercial',
          'nature',
          'ancient',
          'industrial',
          'fantasy',
        ] as const,
        'city',
      ),
      era: pickEnum(read('era'), ['ancient', 'recent', 'modern', 'future'] as const, 'modern'),
      time: pickEnum(read('time'), ['dawn', 'day', 'sunset', 'night'] as const, 'day'),
      weather: pickEnum(read('weather'), ['clear', 'cloudy', 'rain', 'snow', 'fog'] as const, 'clear'),
      mood: pickEnum(
        read('mood'),
        ['warm', 'tense', 'mystery', 'romantic', 'epic', 'desolate'] as const,
        'warm',
      ),
      camera: pickEnum(
        read('camera'),
        ['eye-level', 'overhead', 'low-angle', 'aerial', 'wide'] as const,
        'wide',
      ),
      visualStyle: pickEnum(read('visualStyle'), visualStyles, 'cinematic-cg'),
      emptyScene: read('emptyScene') === undefined ? true : Boolean(read('emptyScene')),
      activitySpace: read('activitySpace') === undefined ? true : Boolean(read('activitySpace')),
    }
  }
  if (kind === 'prop') {
    return {
      type: 'prop',
      category: pickEnum(
        read('category'),
        ['weapon', 'vehicle', 'furniture', 'electronics', 'jewelry', 'food', 'daily', 'other'] as const,
        'other',
      ),
      material: pickEnum(
        read('material'),
        ['wood', 'metal', 'glass', 'fabric', 'leather', 'ceramic', 'mixed'] as const,
        'mixed',
      ),
      condition: pickEnum(read('condition'), ['new', 'used', 'aged', 'damaged'] as const, 'new'),
      view: pickEnum(read('view'), ['front', 'side', 'turnaround'] as const, 'front'),
      background: pickEnum(read('background'), ['solid', 'transparent', 'environment'] as const, 'solid'),
      visualStyle: pickEnum(read('visualStyle'), visualStyles, 'cinematic-cg'),
    }
  }
  if (kind === 'brand') {
    return {
      type: 'brand',
      brandType: pickEnum(
        read('brandType'),
        ['logo', 'wordmark', 'combination', 'product-mark'] as const,
        'logo',
      ),
      usage: pickEnum(
        read('usage'),
        ['end-card', 'packaging', 'signage', 'interface', 'general'] as const,
        'general',
      ),
      background: pickEnum(
        read('background'),
        ['transparent', 'solid', 'environment'] as const,
        'transparent',
      ),
      layout: pickEnum(read('layout'), ['centered', 'horizontal', 'vertical'] as const, 'centered'),
      exactText: textValue(read('exactText'), '', 120),
      palette: textValue(read('palette'), '', 120),
      visualStyle: pickEnum(read('visualStyle'), visualStyles, 'cinematic-cg'),
    }
  }
  return {
    type: 'costume',
    characterAssetId: null,
    audience: pickEnum(read('audience'), ['male', 'female', 'unisex'] as const, 'unisex'),
    category: pickEnum(
      read('category'),
      ['daily', 'formal', 'professional', 'uniform', 'ancient', 'ceremonial', 'fantasy', 'armor'] as const,
      'daily',
    ),
    season: pickEnum(read('season'), ['spring-summer', 'autumn-winter', 'all-season'] as const, 'all-season'),
    design: pickEnum(read('design'), ['minimal', 'luxury', 'retro', 'future', 'chinese'] as const, 'minimal'),
    presentation: pickEnum(read('presentation'), ['flat', 'model', 'worn'] as const, 'flat'),
    visualStyle: pickEnum(read('visualStyle'), visualStyles, 'cinematic-cg'),
    turnaround: Boolean(read('turnaround')),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function textValue(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return (text || fallback).slice(0, maxLength)
}

function normalizePriority(value: unknown): number {
  const priority = Number(value)
  if (!Number.isFinite(priority)) return 3
  return Math.min(5, Math.max(1, Math.round(priority)))
}

function normalizeExactAge(value: unknown): number | null {
  const age = Number(value)
  return Number.isInteger(age) && age >= 1 && age <= 120 ? age : null
}

function normalizeMediaReference(value: unknown): Record<string, string> | null {
  const reference = asRecord(value)
  if (!reference) return null
  const id = textValue(reference.id, '', 128)
  const url = textValue(reference.url, '', 2_000)
  const name = textValue(reference.name, '', 255)
  return id && url && name ? { id, url, name } : null
}

function pickEnum<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback
}
