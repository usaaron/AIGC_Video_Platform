import { Bot, FileUp, Sparkles, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../../components/ui'
import { AssetFields } from './AssetFields'
import { ASSET_TABS, createDefaultAttributes } from './assetOptions'
import { CharacterWorkflow } from './CharacterWorkflow'
import { buildPromptBlueprint } from './promptCompiler'
import { PromptFrameworkPanel } from './PromptFrameworkPanel'
import { ReferenceUploader } from './ReferenceUploader'

export function AssetEditor({
  asset,
  aspectRatio,
  tasks = [],
  onClose,
  onCreateDraft,
  onSave,
  onPersist,
  onGenerateStage,
  onDelete,
  onUpload,
}) {
  const kind = asset.kind
  const [draft, setDraft] = useState(() => ({
    sourceMode: asset.sourceMode || 'generate',
    name: asset.name || '',
    description: asset.description || '',
    promptMode: asset.promptMode || 'standard',
    customPromptMode: asset.customPromptMode || 'append',
    customPrompt: asset.customPrompt || '',
    negativePrompt: asset.negativePrompt || '',
    references: asset.references || [],
    attributes: asset.attributes?.type === kind ? asset.attributes : createDefaultAttributes(kind),
  }))
  const [characterStage, setCharacterStage] = useState(() => {
    if (kind !== 'character' || draft?.attributes?.faceStatus !== 'approved') return 'face'
    return draft.attributes.bodyStatus === 'approved' ? 'turnaround' : 'body'
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const stageForPrompt = kind === 'character' ? characterStage : null
  const promptBlueprint = buildPromptBlueprint(draft, aspectRatio, stageForPrompt)
  const generatedPrompt = promptBlueprint.finalPrompt
  const kindLabel = ASSET_TABS.find(([id]) => id === kind)?.[1]
  const providerFieldLabel = kind === 'audio' ? '音频生成字段' : '图片生成字段'
  const promptBadge =
    kind === 'audio'
      ? '音频'
      : kind === 'character'
        ? characterStage === 'face'
          ? '1:1'
          : characterStage === 'turnaround'
            ? '16:9'
            : aspectRatio
        : aspectRatio

  const assetInputFor = (nextDraft) => {
    const blueprint = buildPromptBlueprint(nextDraft, aspectRatio, stageForPrompt)
    return {
      ...(asset.id ? {} : { kind }),
      ...nextDraft,
      prompt: blueprint.finalPrompt,
      negativePrompt: nextDraft.negativePrompt.trim() || blueprint.suggestedNegativePrompt,
      imageUrl:
        kind === 'audio'
          ? null
          : nextDraft.attributes.turnaroundReferences?.find((output) => output.view === 'front')?.url ||
            nextDraft.attributes.bodyReference?.url ||
            nextDraft.attributes.faceReference?.url ||
            nextDraft.references[0]?.url ||
            asset.imageUrl ||
            null,
      ...(asset.id ? { status: asset.status } : {}),
    }
  }

  const inputFor = (nextDraft = draft) => assetInputFor(nextDraft)

  const validateDraft = (nextDraft) => {
    if (!nextDraft.name.trim()) throw new Error('请先填写资产名称')
    if (nextDraft.sourceMode === 'import' && nextDraft.references.length === 0) {
      throw new Error('本地导入模式至少需要上传一个文件')
    }
  }

  const persistCharacterDraft = async (nextDraft) => {
    validateDraft(nextDraft)
    const input = inputFor(nextDraft)
    if (asset.id) {
      await onPersist?.(input)
      return { ...asset, ...input }
    }
    if (!onCreateDraft) throw new Error('人物草稿创建功能不可用')
    const created = await onCreateDraft(input)
    return { ...created, ...input }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    try {
      validateDraft(draft)
    } catch (validationError) {
      setError(validationError.message)
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(inputFor())
    } catch (saveError) {
      setError(saveError.message)
      setSaving(false)
    }
  }

  const persistCharacterAttributes = async (attributes) => {
    const nextDraft = { ...draft, attributes }
    setDraft(nextDraft)
    await persistCharacterDraft(nextDraft)
  }

  const generateCharacterStage = async (stage, view = null) => {
    if (!onGenerateStage) return
    const attributes = stage === 'turnaround' ? { ...draft.attributes, turnaround: true } : draft.attributes
    const nextDraft = { ...draft, attributes }
    setDraft(nextDraft)
    const persistedAsset = await persistCharacterDraft(nextDraft)
    await onGenerateStage(
      persistedAsset,
      stage,
      buildPromptBlueprint(nextDraft, aspectRatio, stage).finalPrompt,
      view,
    )
  }

  return createPortal(
    <div className="modal-backdrop asset-editor-backdrop" onMouseDown={onClose}>
      <form className="asset-studio" onSubmit={handleSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <header className="asset-studio-head">
          <div>
            <span className="eyebrow">{asset.id ? `编辑${kindLabel}` : `新建${kindLabel}`}</span>
            <h2>{asset.id ? asset.name : `创建${kindLabel}资产`}</h2>
          </div>
          <div className="ratio-lock">
            <span>继承项目比例</span>
            <strong>{aspectRatio}</strong>
          </div>
          <IconButton label="关闭" type="button" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>

        <div className="asset-studio-body">
          <section className="asset-studio-form">
            {(kind !== 'character' || characterStage === 'face') && (
              <div className="source-switch" role="group" aria-label="资产来源">
                <button
                  type="button"
                  className={draft.sourceMode === 'generate' ? 'active' : ''}
                  onClick={() => setDraft({ ...draft, sourceMode: 'generate' })}
                >
                  <Bot size={17} />
                  <span>
                    <strong>AI 生成</strong>
                    <small>使用 Img2 创建新资产</small>
                  </span>
                </button>
                <button
                  type="button"
                  className={draft.sourceMode === 'import' ? 'active' : ''}
                  onClick={() => setDraft({ ...draft, sourceMode: 'import' })}
                >
                  <FileUp size={17} />
                  <span>
                    <strong>本地导入</strong>
                    <small>直接使用或作为 Img2 参考</small>
                  </span>
                </button>
              </div>
            )}

            {draft.sourceMode === 'import' && (kind !== 'character' || characterStage === 'face') && (
              <ReferenceUploader
                kind={kind}
                references={draft.references}
                onChange={(references) => setDraft({ ...draft, references })}
                onUpload={onUpload}
              />
            )}

            <div className="asset-core-fields">
              <label>
                <span>资产名称</span>
                <input
                  required
                  value={draft.name}
                  placeholder={`例如：${kind === 'character' ? '女主角林夏' : kind === 'scene' ? '雨夜车站' : '资产名称'}`}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label>
                <span>补充描述</span>
                <textarea
                  value={draft.description}
                  placeholder="填写外观、用途和故事中的关键特征"
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </label>
            </div>

            {kind === 'character' && (
              <CharacterWorkflow
                assetId={asset.id}
                assetName={draft.name}
                stage={characterStage}
                attributes={draft.attributes}
                references={draft.references}
                tasks={tasks}
                onStageChange={setCharacterStage}
                onAttributesChange={(attributes) => setDraft({ ...draft, attributes })}
                onPersist={persistCharacterAttributes}
                onGenerate={generateCharacterStage}
              />
            )}

            <AssetFields
              attributes={draft.attributes}
              characterStage={characterStage}
              onChange={(attributes) => setDraft({ ...draft, attributes })}
            />
          </section>

          <aside className="prompt-workbench">
            <div className="prompt-workbench-head">
              <span>
                <Sparkles size={16} />
                提示词工作台
              </span>
              <strong>{promptBadge}</strong>
            </div>
            <div className="prompt-mode-switch">
              <button
                type="button"
                className={draft.promptMode === 'standard' ? 'active' : ''}
                onClick={() => setDraft({ ...draft, promptMode: 'standard' })}
              >
                标准模式
              </button>
              <button
                type="button"
                className={draft.promptMode === 'advanced' ? 'active' : ''}
                onClick={() => setDraft({ ...draft, promptMode: 'advanced' })}
              >
                高级模式
              </button>
            </div>
            <PromptFrameworkPanel blueprint={promptBlueprint} />
            <label className="compiled-prompt">
              <span>最终提示词</span>
              <textarea readOnly value={generatedPrompt} />
            </label>
            {draft.promptMode === 'advanced' && (
              <>
                <div className="custom-prompt-mode">
                  <button
                    type="button"
                    className={draft.customPromptMode === 'append' ? 'active' : ''}
                    onClick={() => setDraft({ ...draft, customPromptMode: 'append' })}
                  >
                    追加内容
                  </button>
                  <button
                    type="button"
                    className={draft.customPromptMode === 'replace' ? 'active' : ''}
                    onClick={() => setDraft({ ...draft, customPromptMode: 'replace' })}
                  >
                    完全覆盖
                  </button>
                </div>
                <label>
                  <span>高级自定义提示词</span>
                  <textarea
                    value={draft.customPrompt}
                    placeholder="补充镜头语言、细节要求或完全自定义提示词"
                    onChange={(event) => setDraft({ ...draft, customPrompt: event.target.value })}
                  />
                </label>
              </>
            )}
            <label>
              <span>负面提示词</span>
              <textarea
                className="negative-prompt"
                value={draft.negativePrompt}
                placeholder={promptBlueprint.suggestedNegativePrompt}
                onChange={(event) => setDraft({ ...draft, negativePrompt: event.target.value })}
              />
            </label>
            <div className="provider-payload-note">
              <strong>{providerFieldLabel}</strong>
              <p>最终提示词、负面提示词、参考图、项目比例和结构化属性会随生成任务提交。</p>
            </div>
          </aside>
        </div>

        <footer className="asset-studio-actions">
          <div>
            {onDelete && (
              <button className="button danger" type="button" onClick={onDelete}>
                <Trash2 size={15} />
                删除资产
              </button>
            )}
          </div>
          {error && <span className="asset-save-error">{error}</span>}
          <button className="button secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={saving}>
            {saving ? '保存中…' : '保存资产'}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}
