import { Bot, FileUp, Sparkles, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../../components/ui'
import { AssetFields } from './AssetFields'
import { ASSET_TABS, createDefaultAttributes } from './assetOptions'
import { compileAssetPrompt } from './promptCompiler'
import { ReferenceUploader } from './ReferenceUploader'

export function AssetEditor({ asset, aspectRatio, onClose, onSave, onDelete, onUpload }) {
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const generatedPrompt = compileAssetPrompt(draft, aspectRatio)
  const kindLabel = ASSET_TABS.find(([id]) => id === kind)?.[1]

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (draft.sourceMode === 'import' && draft.references.length === 0) {
      setError('本地导入模式至少需要上传一个文件')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave({
        ...(asset.id ? {} : { kind }),
        ...draft,
        prompt: generatedPrompt,
        imageUrl: kind === 'audio' ? null : draft.references[0]?.url || asset.imageUrl || null,
        ...(asset.id ? { status: asset.status } : {}),
      })
    } catch (saveError) {
      setError(saveError.message)
      setSaving(false)
    }
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

            {draft.sourceMode === 'import' && (
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

            <AssetFields
              attributes={draft.attributes}
              onChange={(attributes) => setDraft({ ...draft, attributes })}
            />
          </section>

          <aside className="prompt-workbench">
            <div className="prompt-workbench-head">
              <span>
                <Sparkles size={16} />
                提示词工作台
              </span>
              <strong>中文</strong>
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
            <label className="compiled-prompt">
              <span>最终发送给 Provider</span>
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
                placeholder="例如：畸形肢体、额外手指、模糊、文字水印"
                onChange={(event) => setDraft({ ...draft, negativePrompt: event.target.value })}
              />
            </label>
            <div className="provider-payload-note">
              <strong>Img2 请求已准备</strong>
              <p>参考图、项目比例、属性、提示词和输出规格都会随生成任务提交。</p>
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
