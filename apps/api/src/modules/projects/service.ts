import type {
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
  ASSET_SUGGESTION_MODEL,
  DEFAULT_SCRIPT_MODEL,
  SCRIPT_OPERATION_CREDITS,
  scriptAssetSuggestionsContentSchema,
  scriptReviewContentSchema,
} from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import type { TextGenerationProvider, TextGenerationTiming } from '../../core/generation/textProvider.js'
import { traceMetadata } from '../../core/observability/trace.js'
import type { SessionMetadata } from '../auth/accounts.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import type { ProjectRepository } from './repository.js'
import {
  assetSuggestionKey,
  deduplicateAssetSuggestions,
  extractScriptAssetNameIndex,
  fallbackAssetSuggestions,
  normalizeScriptAssetSuggestion,
  projectVisualStyleLabel,
} from './assetSuggestions.js'
import {
  SCRIPT_ASSET_SUGGESTIONS_SYSTEM_PROMPT,
  SCRIPT_ASSET_SUGGESTIONS_TIMEOUT_MS,
  assetSuggestionWarning,
  buildScriptAssetEvidence,
  normalizeScriptAssetSuggestionPayload,
  scriptAssetSuggestionMaxTokens,
} from './assetSuggestionProvider.js'
import { assetSuggestionSummary, assetSummary, directionSummary } from './projectPresentation.js'
import { parseProviderJson } from './providerJson.js'
import {
  alignEnrichedSceneRows,
  assignShotEpisodes,
  countStructuredScenes,
  episodeOpeningContinuityNote,
  expandLongScriptParagraphs,
  hasStructuredSceneRows,
  preserveScriptBreakMarkers,
  splitScriptIntoBeatShots,
  splitScriptIntoSmartSceneShots,
  splitScriptParagraphs,
} from './shotPlanning.js'

export { assignShotEpisodes, splitScriptParagraphs } from './shotPlanning.js'
import {
  LONG_SCRIPT_MAX_TOKENS,
  SCRIPT_DETAIL_MAX_TOKENS,
  SCRIPT_INITIAL_EXPANSION_THRESHOLD,
  SINGLE_REWRITE_MAX_LENGTH,
  WEB_SERIES_SCRIPT_SYSTEM_PROMPT,
  appendScriptSegment,
  assertRequestedSceneCount,
  assertWebSeriesDialogueCoverage,
  candidateIsTooShort,
  completeWebSeriesSpokenContent,
  contentLength,
  detailedScriptIssues,
  ensureChineseScriptOutput,
  explicitRequestedSceneCount,
  formatDuration,
  isProtectedLongScript,
  longScriptMaxOutputTokens,
  normalizeScriptDurationSeconds,
  quickScriptIssues,
  resolveScriptContentMode,
  scriptContentSceneBudget,
  scriptDetailOperationLabel,
  scriptDetailSystemPrompt,
  scriptDetailUserPrompt,
  scriptGenerationInstruction,
  scriptGenerationMaxOutputTokens,
  scriptGenerationOperationLabel,
  scriptGenerationSystemPrompt,
  scriptGenerationUserPrompt,
  scriptModeContext,
  scriptModeDisplayName,
  scriptStructureRepairPrompt,
  scriptSceneCountRepairPrompt,
  scriptSegmentOperationLabel,
  scriptSegmentSystemPrompt,
  scriptSegmentUserPrompt,
  segmentMaxOutputTokens,
  segmentScriptIssues,
  webSeriesMaxOutputTokens,
  webSeriesSceneBudget,
  withChineseScriptRules,
} from './scriptWriting.js'

type ScriptBillingMode = 'direct' | 'prepaid'

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

  async workspaceVersion(projectId: string, principal: Principal) {
    const version = await this.repository.workspaceVersion(projectId, principal)
    if (!version) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权访问')
    return { version }
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
    onTextProgress?: (text: string, stage?: string) => void,
    onTextTiming?: (timing: TextGenerationTiming) => void,
    strategy: 'model' | 'fast' = 'model',
  ) {
    const workspace = await this.workspace(projectId, principal)
    const source = script.trim()
    if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先填写剧本内容')

    const projectContext = `项目名称：${workspace.project.name}\n内容类型：${workspace.project.contentType}\n视觉风格：${projectVisualStyleLabel(workspace.project.visualStyle)}\n画面比例：${workspace.project.aspectRatio}\n创作方向：${directionSummary(direction)}\n已有资产：${assetSuggestionSummary(workspace.assets)}`
    const fallbackResult = fallbackAssetSuggestions(
      source,
      direction,
      workspace.project.visualStyle ?? 'cinematic-cg',
    )
    const assetEvidence = buildScriptAssetEvidence(source)
    let warnings: string[] = []
    let result: { summary: string; assets: ScriptAssetSuggestion[] }

    if (strategy === 'fast') {
      warnings = ['已使用剧本结构快速提取基础资产；建议在资产设计页核对名称、外观和优先级']
      result = fallbackResult
    } else if (!this.textProvider) {
      warnings = ['文本服务未配置，已根据剧本文本做基础资产建议']
      result = fallbackResult
    } else {
      try {
        const response = await this.textProvider.generate({
          systemPrompt: SCRIPT_ASSET_SUGGESTIONS_SYSTEM_PROMPT,
          userPrompt: `${projectContext}\n\n全剧资产证据（已覆盖开头、中段和结尾；只基于这些证据筛选核心资产）：\n${assetEvidence.text}`,
          maxOutputTokens: scriptAssetSuggestionMaxTokens(assetEvidence.candidateCount),
          timeoutMs: SCRIPT_ASSET_SUGGESTIONS_TIMEOUT_MS,
          maxAttempts: 1,
          responseFormat: 'json',
          model: ASSET_SUGGESTION_MODEL,
          ...(onTextProgress
            ? { onTextProgress: (text: string) => onTextProgress(text, 'asset-suggestions') }
            : {}),
          ...(onTextTiming ? { onTextTiming } : {}),
          timingLabel: 'asset-suggestions',
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
          { generationClientRequestId: clientRequestId },
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
              { createNext: true, generationClientRequestId: clientRequestId },
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
            { generationClientRequestId: clientRequestId },
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
    const requestedSceneCount = explicitRequestedSceneCount(revisionNote)

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
            systemPrompt: withChineseScriptRules(scriptDetailSystemPrompt(scriptMode, requestedSceneCount)),
            userPrompt: scriptDetailUserPrompt(scriptMode, projectContext, source, requestedSceneCount),
            maxOutputTokens: requestedSceneCount
              ? Math.min(
                  LONG_SCRIPT_MAX_TOKENS,
                  Math.max(SCRIPT_DETAIL_MAX_TOKENS, requestedSceneCount * 700),
                )
              : isProtectedLongScript(source)
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
        let candidateWithBreaks = preserveScriptBreakMarkers(source, candidate)
        let sceneAlignedCandidate = requestedSceneCount
          ? candidateWithBreaks
          : alignEnrichedSceneRows(source, candidateWithBreaks)
        if (requestedSceneCount && countStructuredScenes(sceneAlignedCandidate) !== requestedSceneCount) {
          const repairedCandidate = await ensureChineseScriptOutput(
            this.textProvider!,
            await this.textProvider!.generate({
              systemPrompt: withChineseScriptRules(scriptDetailSystemPrompt(scriptMode, requestedSceneCount)),
              userPrompt: scriptSceneCountRepairPrompt(
                projectContext,
                source,
                sceneAlignedCandidate,
                requestedSceneCount,
              ),
              maxOutputTokens: Math.min(
                LONG_SCRIPT_MAX_TOKENS,
                Math.max(SCRIPT_DETAIL_MAX_TOKENS, requestedSceneCount * 700),
              ),
              model,
              usageContext: usageContextForPrincipal(principal),
              ...(onTextProgress
                ? { onTextProgress: (text: string) => onTextProgress(text, 'scene-count-repair') }
                : {}),
              ...(onTextTiming ? { onTextTiming, timingLabel: 'scene-count-repair' } : {}),
            }),
            model,
            onTextTiming,
            onTextProgress ? (text: string) => onTextProgress(text, 'language-repair') : undefined,
          )
          candidateWithBreaks = preserveScriptBreakMarkers(source, repairedCandidate)
          sceneAlignedCandidate = candidateWithBreaks
        }
        sceneAlignedCandidate = completeWebSeriesSpokenContent(sceneAlignedCandidate, scriptMode)
        assertRequestedSceneCount(revisionNote, sceneAlignedCandidate)
        assertWebSeriesDialogueCoverage(sceneAlignedCandidate, scriptMode)
        const preserved =
          !requestedSceneCount &&
          isProtectedLongScript(source) &&
          candidateIsTooShort(source, sceneAlignedCandidate)
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
            { generationClientRequestId: clientRequestId },
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
