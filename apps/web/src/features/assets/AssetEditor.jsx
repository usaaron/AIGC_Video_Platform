import { Trash2, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { IconButton } from '../../components/ui'
import { AssetFields } from './AssetFields'
import { AssetPromptWorkbench } from './AssetPromptWorkbench'
import { AssetSourceSwitch } from './AssetSourceSwitch'
import { CharacterWorkflow } from './CharacterWorkflow'
import { ReferenceUploader } from './ReferenceUploader'
import { useAssetEditorDraft } from './useAssetEditorDraft'

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
  const {
    kind,
    kindLabel,
    draft,
    setDraft,
    characterStage,
    setCharacterStage,
    saving,
    error,
    promptBadge,
    promptBlueprint,
    generatedPrompt,
    handleSubmit,
    persistCharacterAttributes,
    generateCharacterStage,
  } = useAssetEditorDraft({
    asset,
    aspectRatio,
    onCreateDraft,
    onSave,
    onPersist,
    onGenerateStage,
  })
  const canChooseSource = kind !== 'character' || characterStage === 'face'

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
            {canChooseSource && (
              <AssetSourceSwitch
                sourceMode={draft.sourceMode}
                onChange={(sourceMode) => setDraft({ ...draft, sourceMode })}
              />
            )}

            {draft.sourceMode === 'import' && canChooseSource && (
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
                  placeholder={namePlaceholderFor(kind)}
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

          <AssetPromptWorkbench
            kind={kind}
            draft={draft}
            setDraft={setDraft}
            promptBadge={promptBadge}
            promptBlueprint={promptBlueprint}
            generatedPrompt={generatedPrompt}
          />
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

function namePlaceholderFor(kind) {
  if (kind === 'character') return '例如：女主角林夏'
  if (kind === 'scene') return '例如：雨夜车站'
  return '资产名称'
}
