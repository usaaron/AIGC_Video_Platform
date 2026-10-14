import { ASSET_SUGGESTION_MODEL } from '@seqora/contracts'
import { ScriptPage } from '../../components/LazyWorkspacePages'
import { api } from '../../services/apiClient'
import {
  assetSuggestionRevision,
  scriptGenerationTaskLabel,
  scriptSegmentTaskLabel,
} from '../script/scriptTaskLabels'

export function WorkspaceScriptPage({
  project,
  workspace,
  billing,
  tasks,
  providerHealth,
  refreshWorkspace,
  navigateTo,
  activeStep,
  setToast,
  createScriptJob,
  createAsset,
  importAssets,
  createAndGenerateAsset,
  replaceTasks,
}) {
  return (
    <ScriptPage
      key={project.id}
      project={project}
      scriptEpisodes={workspace.scriptEpisodes || []}
      assets={workspace.assets}
      billing={billing}
      tasks={tasks}
      textProviderStatus={providerHealth?.providers?.text ?? null}
      scriptModelCapabilities={providerHealth?.scriptModels ?? []}
      onRefreshProduction={refreshWorkspace}
      onOpenProduction={navigateTo}
      scriptMasterView={activeStep === 'storyboard' ? 'storyboard' : 'script'}
      onSave={async (script) => {
        await api.updateProject(project.id, { script })
        await refreshWorkspace()
        setToast('剧本已保存')
      }}
      onSaveEpisode={async (episodeId, content) => {
        const episode = await api.saveScriptEpisode(project.id, {
          ...(episodeId ? { episodeId } : {}),
          content,
        })
        await refreshWorkspace()
        setToast(`${episode.title}已保存`)
        return episode
      }}
      onDeleteEpisode={async (episodeId) => {
        await api.deleteScriptEpisode(project.id, episodeId)
        await refreshWorkspace()
        setToast('最后一集已删除')
      }}
      onClearEpisodes={async () => {
        await api.clearScriptEpisodes(project.id)
        await refreshWorkspace()
        setToast('所有剧集已清空')
      }}
      onUpdateEpisodeDuration={async (episodeDurationSeconds) => {
        await api.updateProject(project.id, { episodeDurationSeconds })
        await refreshWorkspace()
        setToast(
          project.contentType === 'short-drama'
            ? '网剧剧本按单集生成；该时长仅用于后续分镜分集'
            : `已设置目标成片 ${episodeDurationSeconds} 秒，脚本与分镜会沿用该时长`,
        )
      }}
      onGenerate={async (
        draft,
        direction,
        productionMode,
        episodeDurationSeconds,
        model,
        revisionNote,
        setPhase,
        episodeId,
        episodePlan,
      ) => {
        setPhase?.('submitting')
        const isRevision = Boolean(revisionNote?.trim())
        return createScriptJob(
          episodePlan
            ? `分集改编 · ${episodePlan.episodes.length} 集`
            : isRevision
              ? '改写当前剧集'
              : scriptGenerationTaskLabel(project.contentType),
          isRevision ? 'enrich' : 'generate',
          {
            ...(isRevision ? { script: draft } : { draft, mode: 'quick' }),
            ...(episodePlan ? { episodePlan } : {}),
            direction,
            productionMode,
            episodeDurationSeconds,
            episodeMinutes: Math.max(1, Math.ceil(episodeDurationSeconds / 60)),
            model,
            revisionNote,
            episodeId,
          },
        )
      }}
      onGenerateSegment={async (
        draft,
        direction,
        segment,
        productionMode,
        episodeDurationSeconds,
        model,
        revisionNote,
        setPhase,
        episodeId,
      ) => {
        setPhase?.('submitting')
        return createScriptJob(scriptSegmentTaskLabel(project.contentType), 'generate', {
          draft,
          direction,
          mode: 'segment',
          segment,
          productionMode,
          episodeDurationSeconds,
          episodeMinutes: Math.max(1, Math.ceil(episodeDurationSeconds / 60)),
          model,
          revisionNote,
          episodeId,
        })
      }}
      onSuggestAssets={(script, direction, sourceScriptFingerprint) =>
        createScriptJob('资产建议', 'suggest-assets', {
          script,
          direction,
          sourceScriptFingerprint,
          assetRevision: assetSuggestionRevision(workspace?.assets),
          model: ASSET_SUGGESTION_MODEL,
        })
      }
      onSuggestAssetsFast={(script, direction) =>
        api.suggestScriptAssets(
          project.id,
          script,
          direction,
          ASSET_SUGGESTION_MODEL,
          crypto.randomUUID(),
          'fast',
        )
      }
      onCreateAsset={createAsset}
      onImportAssets={importAssets}
      onCreateAndGenerateAsset={createAndGenerateAsset}
      onUpload={(file) => api.uploadMedia(project.id, file)}
      onCancelTask={async (taskId, successMessage = '已停止剧本生成，可以切换模型后重试') => {
        await api.deleteTask(taskId)
        replaceTasks(project.id, await api.tasks(project.id))
        setToast(successMessage)
      }}
      onNext={() => navigateTo('assets')}
    />
  )
}
