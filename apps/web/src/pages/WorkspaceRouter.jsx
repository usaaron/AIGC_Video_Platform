import { AssetsPage } from './AssetsPage'
import { BillingPage } from './BillingPage'
import { FilmPage } from './FilmPage'
import { GenerationPage } from './GenerationPage'
import { OverviewPage } from './OverviewPage'
import { ScriptPage } from './ScriptPage'
import { SettingsPage } from './SettingsPage'
import { StoryboardPage } from './StoryboardPage'
import { negativePromptForAsset } from '../features/prompts/negativePromptPresets'
import { api } from '../services/apiClient'

export function WorkspaceRouter({
  activeStep,
  project,
  workspace,
  tasks,
  billing,
  account,
  playing,
  setPlaying,
  currentShot,
  setCurrentShot,
  taskPollError,
  taskSyncMode,
  onNavigate,
  onOpenNewProject,
  onRefreshWorkspace,
  onRefreshTasks,
  onRefreshSession,
  onSetBilling,
  onSetToast,
  onLogout,
  onCreateJob,
  onCreateShotVideoJob,
  onRetryJob,
  onRerunJob,
  onRetryShotVideoJob,
  onExportFilmMp4,
  onUpdateProject,
}) {
  if (!project) {
    return (
      <div className="page empty-workspace">
        <h1>创建第一个项目</h1>
        <p>从项目名称和画面比例开始。</p>
        <button className="button primary" onClick={onOpenNewProject}>
          新建项目
        </button>
      </div>
    )
  }

  const pages = {
    overview: (
      <OverviewPage
        project={project}
        assets={workspace.assets}
        shots={workspace.shots}
        jobs={tasks}
        billing={billing}
        setActiveStep={onNavigate}
        setNewProjectOpen={onOpenNewProject}
      />
    ),
    script: (
      <ScriptPage
        project={project}
        assets={workspace.assets}
        onSave={(script) => onUpdateProject({ script }, '剧本已保存')}
        onSplit={async () => {
          await api.generateShots(project.id)
          await onRefreshWorkspace()
          onSetToast('已根据剧本拆分镜头')
          onNavigate('storyboard')
        }}
      />
    ),
    assets: (
      <AssetsPage
        project={project}
        assets={workspace.assets}
        tasks={tasks}
        billing={billing}
        onCreate={async (input) => {
          const created = await api.createAsset(project.id, input)
          await onRefreshWorkspace()
          onSetToast('资产已添加')
          return created
        }}
        onUpdate={async (assetId, input) => {
          await api.updateAsset(project.id, assetId, input)
          await onRefreshWorkspace()
          onSetToast('资产已更新')
        }}
        onDelete={async (assetId) => {
          await api.deleteAsset(project.id, assetId)
          await onRefreshWorkspace()
          onSetToast('资产已删除')
        }}
        onUpload={(file) => api.uploadMedia(project.id, file)}
        onGenerateStage={(asset, stage, prompt, view = null) => {
          const references =
            stage === 'face'
              ? asset.references
              : stage === 'body'
                ? [asset.attributes.faceReference].filter(Boolean)
                : [asset.attributes.faceReference, asset.attributes.bodyReference].filter(Boolean)
          const labels = { face: '面部大头照', body: '全身设定', turnaround: '三视图设定表' }
          const costs = { face: 4, body: 6, turnaround: view ? 6 : 18 }
          return onCreateJob(`${asset.name} · ${labels[stage]}`, '图片', costs[stage], {
            prompt,
            negativePrompt: effectiveAssetNegativePrompt(asset),
            rethrow: true,
            metadata: {
              assetId: asset.id,
              assetKind: asset.kind,
              generationStage: stage,
              aspectRatio: stage === 'face' ? '1:1' : stage === 'turnaround' ? '16:9' : project.aspectRatio,
              sourceMode: asset.sourceMode,
              references,
              attributes: asset.attributes,
              turnaround: stage === 'turnaround',
              outputLayout: asset.attributes.turnaroundLayout,
              outputViews: view ? [view] : undefined,
              regenerateView: view,
            },
          })
        }}
        onGenerate={(asset) =>
          onCreateJob(`${asset.name} · 重新生成`, asset.kind === 'audio' ? '音频' : '图片', 6, {
            prompt: asset.prompt,
            negativePrompt: effectiveAssetNegativePrompt(asset),
            metadata: {
              assetId: asset.id,
              assetKind: asset.kind,
              aspectRatio: project.aspectRatio,
              sourceMode: asset.sourceMode,
              references: asset.references,
              attributes: asset.attributes,
              turnaround: asset.attributes.turnaround === true || asset.attributes.view === 'turnaround',
            },
          })
        }
        onGenerateAll={(selectedAssets) =>
          selectedAssets.forEach(
            (asset) =>
              void onCreateJob(`${asset.name} · 资产生成`, asset.kind === 'audio' ? '音频' : '图片', 6, {
                prompt: asset.prompt,
                negativePrompt: effectiveAssetNegativePrompt(asset),
                metadata: {
                  assetId: asset.id,
                  assetKind: asset.kind,
                  aspectRatio: project.aspectRatio,
                  sourceMode: asset.sourceMode,
                  references: asset.references,
                  attributes: asset.attributes,
                  turnaround: asset.attributes.turnaround === true || asset.attributes.view === 'turnaround',
                },
              }),
          )
        }
        onNext={() => onNavigate('storyboard')}
      />
    ),
    storyboard: (
      <StoryboardPage
        shots={workspace.shots}
        assets={workspace.assets}
        tasks={tasks}
        billing={billing}
        onRegenerate={async () => {
          await api.generateShots(project.id)
          await onRefreshWorkspace()
          onSetToast('已根据剧本重新拆分分镜')
        }}
        onCreate={async (input) => {
          await api.createShot(project.id, input)
          await onRefreshWorkspace()
        }}
        onUpdate={async (shotId, input) => {
          await api.updateShot(project.id, shotId, input)
          await onRefreshWorkspace()
          onSetToast('分镜已更新')
        }}
        onGenerate={onCreateShotVideoJob}
        onRetry={onRetryShotVideoJob}
        onNext={() => onNavigate('generate')}
      />
    ),
    generate: (
      <GenerationPage
        jobs={tasks}
        onClear={async () => {
          await api.clearTasks(project.id)
          await onRefreshTasks()
          onSetToast('已清理完成任务')
        }}
        onRetry={onRetryJob}
        onRerun={onRerunJob}
        onCancel={async (job) => {
          await api.cancelTask(job.id)
          await onRefreshTasks()
          onSetBilling(await api.billing())
          await onRefreshSession()
          onSetToast('任务已取消')
        }}
        onNext={() => onNavigate('film')}
        pollError={taskPollError}
        syncMode={taskSyncMode}
      />
    ),
    film: (
      <FilmPage
        project={project}
        shots={workspace.shots}
        assets={workspace.assets}
        tasks={tasks}
        playing={playing}
        setPlaying={setPlaying}
        currentShot={currentShot}
        setCurrentShot={setCurrentShot}
        onSave={async () => {
          const saved = await api.saveVersion(project.id)
          await onRefreshWorkspace()
          onSetToast(`版本 v${saved.version} 已保存`)
        }}
        onEdit={() => onNavigate('storyboard')}
        onExport={onExportFilmMp4}
      />
    ),
    billing: (
      <BillingPage
        billing={billing}
        onPlanChange={async (plan) => {
          onSetBilling(await api.updatePlan(plan))
          await onRefreshSession()
          onSetToast(plan === 'member' ? '会员已开通，赠送 500 积分' : '已切换为免费版')
        }}
      />
    ),
    settings: (
      <SettingsPage
        key={project.id}
        project={project}
        account={account}
        onSave={onUpdateProject}
        onLogout={onLogout}
      />
    ),
  }

  return pages[activeStep] || pages.overview
}

function effectiveAssetNegativePrompt(asset) {
  return asset.negativePrompt?.trim() || negativePromptForAsset(asset)
}
