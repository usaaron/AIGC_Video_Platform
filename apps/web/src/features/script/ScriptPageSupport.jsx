import { ArrowRight, Sparkles } from 'lucide-react'
import { AssetSuggestionsPanel } from './AssetSuggestionsPanel'
import { SCRIPT_ASSET_SUGGESTION_COPY } from './scriptPageConfig'
import { CircleHelp } from 'lucide-react'

export function ScriptHelp({ label, children }) {
  return (
    <span className="script-inline-help" tabIndex={0} aria-label={label}>
      <CircleHelp size={14} />
      <span role="tooltip">{children}</span>
    </span>
  )
}

export function TextTimingSummary({ timing }) {
  const firstTokenWaitMs = numberOrNull(timing.firstTokenWaitMs)
  const responseHeadersMs = numberOrNull(timing.responseHeadersMs)
  const providerMs = numberOrNull(timing.providerMs ?? timing.generationMs)
  const appProcessingMs = numberOrNull(timing.appProcessingMs)
  const queueWaitMs = numberOrNull(timing.queueWaitMs)
  const totalMs = numberOrNull(timing.totalMs)
  const extraModelCalls = Math.max(0, Number(timing.extraModelCalls) || 0)
  return (
    <section className="script-timing-summary" aria-label="最近一次剧本生成耗时">
      <div>
        <span className="eyebrow">最近一次生成</span>
        <strong>总耗时 {formatMilliseconds(totalMs)}</strong>
      </div>
      <dl>
        <div>
          <dt>排队</dt>
          <dd>{formatMilliseconds(queueWaitMs)}</dd>
        </div>
        <div>
          <dt>连接响应</dt>
          <dd>{formatMilliseconds(responseHeadersMs)}</dd>
        </div>
        <div>
          <dt>响应后首字</dt>
          <dd>{formatMilliseconds(firstTokenWaitMs)}</dd>
        </div>
        <div>
          <dt>模型总耗时</dt>
          <dd>{formatMilliseconds(providerMs)}</dd>
        </div>
        <div>
          <dt>校验与写回</dt>
          <dd>{formatMilliseconds(appProcessingMs)}</dd>
        </div>
      </dl>
      {extraModelCalls > 0 && <small>本次触发 {extraModelCalls} 次额外修复模型调用</small>}
    </section>
  )
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function formatMilliseconds(value) {
  if (value === null) return '未记录'
  if (value < 1_000) return `${Math.round(value)}ms`
  return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}s`
}

export function ScriptAssetSuggestions({ assetSuggestions, isSeries, skipAssetSuggestions, stopping }) {
  return (
    <AssetSuggestionsPanel
      status={assetSuggestions.status}
      result={assetSuggestions.result}
      error={assetSuggestions.error}
      creatingKeys={assetSuggestions.creatingKeys}
      createdKeys={assetSuggestions.createdKeys}
      onRefresh={() => void assetSuggestions.extractFast()}
      onCancel={() => void assetSuggestions.stop()}
      onFastExtract={() => void assetSuggestions.extractFast()}
      onSkip={() => void skipAssetSuggestions()}
      stopping={stopping}
      onInspect={assetSuggestions.openEditor}
      onDeleteSuggestion={assetSuggestions.dismissSuggestion}
      onCreateAndGenerate={assetSuggestions.createAndGenerate}
      onImportSelected={assetSuggestions.importSelected}
      onGenerateSelected={assetSuggestions.generateSelected}
      allowCostume={!isSeries}
      copy={{
        ...SCRIPT_ASSET_SUGGESTION_COPY,
        title: isSeries ? '扫描全部已保存剧集，合并人物造型、场景和物品' : '扫描脚本，建立可复用资产',
        refresh: assetSuggestions.result
          ? SCRIPT_ASSET_SUGGESTION_COPY.refreshAgain
          : SCRIPT_ASSET_SUGGESTION_COPY.refresh,
      }}
    />
  )
}

export function ScriptFlowActions({ saved, disabled, onContinue }) {
  return (
    <section className="script-flow-actions">
      <div>
        <span className="eyebrow">下一步</span>
        <strong>从当前剧本建立核心资产</strong>
        <small>{saved ? '当前版本已保存' : '继续时会先保存当前版本'}</small>
      </div>
      <div>
        <button className="button primary" disabled={disabled} onClick={() => void onContinue()}>
          进入资产设计 <ArrowRight size={16} />
        </button>
      </div>
    </section>
  )
}

export function ScriptGenerationMessages({
  textGenerationUnavailable,
  textGenerationStatusMessage,
  latestFailedScriptTask,
  generationWarnings,
  latestTextTiming,
}) {
  return (
    <>
      {textGenerationUnavailable && (
        <div className="script-generation-note" role="alert">
          <CircleHelp size={15} />
          <span>{textGenerationStatusMessage}</span>
        </div>
      )}

      {latestFailedScriptTask && (
        <div className="script-generation-note script-generation-note-error" role="alert">
          <CircleHelp size={15} />
          <span>
            <strong>本次剧本任务已停止</strong>
            <span>{latestFailedScriptTask.error || '生成未完成，请检查当前草稿后重试。'}</span>
            <small>已生成的剧集草稿不会被删除；请先保存当前剧集，再继续生成下一集。</small>
          </span>
        </div>
      )}

      {generationWarnings.length > 0 && (
        <div className="script-generation-note" role="status">
          <Sparkles size={15} />
          <span>{generationWarnings.slice(0, 2).join('；')}</span>
        </div>
      )}

      {latestTextTiming && <TextTimingSummary timing={latestTextTiming} />}
    </>
  )
}
