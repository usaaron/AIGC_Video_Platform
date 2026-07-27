import { Bot, FileUp, ImagePlus, LoaderCircle, LogOut, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../../components/ui'
import { AssetFields } from './AssetFields'
import {
  applyAssetCreationMode,
  ASSET_CREATION_MODES,
  buildAssetInput,
  inferAssetCreationMode,
} from './assetDraft'
import { ASSET_TABS, createDefaultAttributes, optionLabel } from './assetOptions'
import { CharacterWorkflow } from './CharacterWorkflow'
import { compileAssetPrompt, compileCharacterStagePrompt } from './promptCompiler'
import { ReferenceUploader } from './ReferenceUploader'

function createEditorDraft(asset, kind) {
  const initialAttributes = createDefaultAttributes(kind)
  return {
    sourceMode: asset.sourceMode || 'generate',
    name: asset.name || '',
    description: asset.description || '',
    promptMode: asset.promptMode || 'standard',
    customPromptMode: asset.customPromptMode || 'replace',
    customPrompt: asset.customPrompt || '',
    negativePrompt: asset.negativePrompt || '',
    references: asset.references || [],
    imageUrl: asset.imageUrl || null,
    attributes:
      asset.attributes?.type === kind ? { ...initialAttributes, ...asset.attributes } : initialAttributes,
  }
}

export function AssetEditor({
  asset,
  aspectRatio,
  tasks = [],
  onClose,
  onCreateDraft,
  onSave,
  onPersist,
  onGenerateStage,
  onGenerateAsset,
  onDelete,
  onUpload,
  onGetTrustedConfiguration,
  onListTrustedPortraits,
  onRegisterVirtualPortrait,
  onBindTrustedPortrait,
  onRefreshTrustedPortrait,
}) {
  const kind = asset.kind
  const sourceSuggestion = asset.suggestion || null
  const suggestionOnly = Boolean(sourceSuggestion && !asset.id)
  const [creationMode, setCreationMode] = useState(() => inferAssetCreationMode(asset))
  const [draft, setDraft] = useState(() => createEditorDraft(asset, kind))
  const [suggestionApplied, setSuggestionApplied] = useState(false)
  const [characterStage, setCharacterStage] = useState(() => {
    if (kind !== 'character' || draft?.attributes?.faceStatus !== 'approved') return 'face'
    return draft.attributes.bodyStatus === 'approved' ? 'turnaround' : 'body'
  })
  const [savingAction, setSavingAction] = useState(null)
  const [error, setError] = useState('')
  const [trustedConfiguration, setTrustedConfiguration] = useState(null)

  useEffect(() => {
    setCreationMode(inferAssetCreationMode(asset))
    setDraft(createEditorDraft(asset, kind))
    setSuggestionApplied(false)
    if (kind === 'character') {
      const nextAttributes = asset.attributes
      setCharacterStage(
        nextAttributes?.faceStatus !== 'approved'
          ? 'face'
          : nextAttributes.bodyStatus === 'approved'
            ? 'turnaround'
            : 'body',
      )
    }
  }, [asset.id, asset.editorKey])

  useEffect(() => {
    if (!asset.id || kind !== 'character') return
    const trustedPortrait = asset.attributes?.trustedPortrait
    if (!trustedPortrait) return
    setDraft((current) => ({
      ...current,
      attributes: {
        ...current.attributes,
        portraitSource: asset.attributes?.portraitSource || current.attributes.portraitSource,
        trustedPortrait,
      },
    }))
  }, [asset.id, asset.attributes?.portraitSource, asset.attributes?.trustedPortrait])

  useEffect(() => {
    if (kind !== 'character' || !onGetTrustedConfiguration) return
    let active = true
    void onGetTrustedConfiguration()
      .then((configuration) => {
        if (active) setTrustedConfiguration(configuration)
      })
      .catch(() => {
        if (active) setTrustedConfiguration({ configured: false, virtualRegistrationReady: false })
      })
    return () => {
      active = false
    }
  }, [kind, onGetTrustedConfiguration])
  const compileProviderPrompt = (value) =>
    kind === 'character'
      ? compileCharacterStagePrompt(value, aspectRatio, characterStage)
      : compileAssetPrompt(value, aspectRatio)
  const generatedPrompt = compileProviderPrompt(draft)
  const kindLabel = ASSET_TABS.find(([id]) => id === kind)?.[1]
  const directImport = creationMode === ASSET_CREATION_MODES.DIRECT
  const usesUpload = directImport || creationMode === ASSET_CREATION_MODES.REFERENCE
  const promptWorkbenchVisible = !directImport || (kind === 'character' && characterStage !== 'face')

  const inputFor = (nextDraft = draft) =>
    buildAssetInput({ asset, draft: nextDraft, kind, aspectRatio, creationMode })

  const validateDraft = (nextDraft) => {
    if (!nextDraft.name.trim()) throw new Error('请先填写资产名称')
    if (usesUpload && nextDraft.references.length === 0) {
      throw new Error(directImport ? '请先上传要直接使用的原图' : '请先上传至少一张生成参考图')
    }
  }

  const selectCreationMode = (mode) => {
    setCreationMode(mode)
    setDraft((current) => applyAssetCreationMode(current, mode))
  }

  const selectPromptMode = (mode) => {
    if (mode === 'standard') {
      setDraft((current) => ({ ...current, promptMode: 'standard' }))
      return
    }
    setDraft((current) => {
      const automaticDraft = {
        ...current,
        promptMode: 'standard',
        customPromptMode: 'replace',
        customPrompt: '',
      }
      return {
        ...current,
        promptMode: 'advanced',
        customPromptMode: 'replace',
        customPrompt: compileProviderPrompt(automaticDraft),
      }
    })
  }

  const applySourceSuggestion = (mode = 'full') => {
    if (!sourceSuggestion) return
    setDraft((current) => mergeSuggestionIntoDraft(current, sourceSuggestion, kind, mode))
    setSuggestionApplied(true)
  }

  const persistDraft = async (nextDraft) => {
    validateDraft(nextDraft)
    const input = inputFor(nextDraft)
    if (asset.id) {
      await onPersist?.(input)
      return { ...asset, ...input }
    }
    if (!onCreateDraft) throw new Error('资产草稿创建功能不可用')
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
    setSavingAction('save')
    setError('')
    try {
      await onSave(inputFor())
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSavingAction(null)
    }
  }

  const persistCharacterAttributes = async (attributes) => {
    const nextDraft = { ...draft, attributes }
    setDraft(nextDraft)
    await persistDraft(nextDraft)
  }

  const generateCharacterStage = async (stage, closeAfterQueue = false) => {
    if (!onGenerateStage) return
    if (stage === 'face' && directImport) throw new Error('直接使用原图无需生成，请将上传图片设为面部基准')
    const attributes = stage === 'turnaround' ? { ...draft.attributes, turnaround: true } : draft.attributes
    const nextDraft = { ...draft, attributes }
    setDraft(nextDraft)
    const persistedAsset = await persistDraft(nextDraft)
    const task = await onGenerateStage(
      persistedAsset,
      stage,
      compileCharacterStagePrompt(nextDraft, aspectRatio, stage),
    )
    if (!task) throw new Error('任务未能加入生成队列，请检查页面提示后重试')
    if (closeAfterQueue) onClose()
    return task
  }

  const generateAssetAndClose = async () => {
    if (!onGenerateAsset) return
    if (directImport) return
    setSavingAction('generate')
    setError('')
    try {
      const persistedAsset = await persistDraft(draft)
      const task = await onGenerateAsset(persistedAsset)
      if (!task) throw new Error('任务未能加入生成队列，请检查页面提示后重试')
      onClose()
    } catch (generationError) {
      setError(generationError.message)
    } finally {
      setSavingAction(null)
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
            {(kind !== 'character' || characterStage === 'face') && (
              <div
                className={`source-switch ${kind === 'audio' ? 'two-options' : ''}`}
                role="group"
                aria-label="资产来源"
              >
                <button
                  type="button"
                  className={directImport ? 'active' : ''}
                  onClick={() => selectCreationMode(ASSET_CREATION_MODES.DIRECT)}
                >
                  <FileUp size={17} />
                  <span>
                    <strong>{kind === 'audio' ? '上传音频' : '直接使用原图'}</strong>
                    <small>不生成 · 不扣积分</small>
                  </span>
                </button>
                {kind !== 'audio' && (
                  <button
                    type="button"
                    className={creationMode === ASSET_CREATION_MODES.REFERENCE ? 'active' : ''}
                    onClick={() => selectCreationMode(ASSET_CREATION_MODES.REFERENCE)}
                  >
                    <ImagePlus size={17} />
                    <span>
                      <strong>参考图再生成</strong>
                      <small>原图 + 提示词交给 Img2</small>
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className={creationMode === ASSET_CREATION_MODES.TEXT ? 'active' : ''}
                  onClick={() => selectCreationMode(ASSET_CREATION_MODES.TEXT)}
                >
                  <Bot size={17} />
                  <span>
                    <strong>{kind === 'audio' ? 'AI 音频草稿' : '纯提示词生成'}</strong>
                    <small>{kind === 'audio' ? '仅保存配置' : '不携带本地参考图'}</small>
                  </span>
                </button>
              </div>
            )}

            {usesUpload && (kind !== 'character' || characterStage === 'face') && (
              <ReferenceUploader
                kind={kind}
                mode={directImport ? 'direct' : 'reference'}
                limit={directImport ? 1 : undefined}
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

            {kind === 'character' && !suggestionOnly && (
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
                onGenerateAndClose={(stage) => generateCharacterStage(stage, true)}
                faceCreationMode={creationMode}
                settings={
                  characterStage !== 'turnaround' ? (
                    <section className="character-identity-settings">
                      <div className="character-identity-settings-head">
                        <div>
                          <span className="eyebrow">
                            {characterStage === 'face'
                              ? directImport
                                ? '身份与画风标签'
                                : '生成身份参数'
                              : '全身生成参数'}
                          </span>
                          <h3>{characterStage === 'face' ? '定义人物身份与画风' : '定义人物体型与背景'}</h3>
                        </div>
                        <p>
                          {characterStage === 'face'
                            ? directImport
                              ? '仅用于资产识别和后续镜头匹配，不会调用 Img2。'
                              : '这些选项会先写入提示词，再用于生成下方的面部身份锚点。'
                            : '全身生成会继承已确认面部，并叠加以下身体参数。'}
                        </p>
                      </div>
                      <AssetFields
                        attributes={draft.attributes}
                        characterStage={characterStage}
                        onChange={(attributes) => setDraft({ ...draft, attributes })}
                      />
                    </section>
                  ) : null
                }
                trustedConfiguration={trustedConfiguration}
                onListTrustedPortraits={onListTrustedPortraits}
                onRegisterVirtualPortrait={onRegisterVirtualPortrait}
                onBindTrustedPortrait={onBindTrustedPortrait}
                onRefreshTrustedPortrait={onRefreshTrustedPortrait}
                onEnsureAsset={async () => persistDraft(draft)}
              />
            )}

            {kind === 'character' && suggestionOnly && (
              <section className="character-identity-settings suggestion-only-identity">
                <div className="character-identity-settings-head">
                  <div>
                    <span className="eyebrow">人工确认</span>
                    <h3>确认人物基础字段</h3>
                  </div>
                  <p>
                    建议只作为参考。保存前请确认性别、年龄和身份设定，后续再到资产页生成面部、全身和三视图。
                  </p>
                </div>
                <AssetFields
                  attributes={draft.attributes}
                  characterStage="face"
                  onChange={(attributes) => setDraft({ ...draft, attributes })}
                />
              </section>
            )}

            {kind !== 'character' && (
              <AssetFields
                attributes={draft.attributes}
                characterStage={characterStage}
                onChange={(attributes) => setDraft({ ...draft, attributes })}
              />
            )}
          </section>

          {promptWorkbenchVisible ? (
            <aside className="prompt-workbench">
              <div className="prompt-workbench-head">
                <span>
                  <Sparkles size={16} />
                  提示词工作台
                </span>
                <strong>
                  {kind === 'character'
                    ? characterStage === 'face'
                      ? '1:1'
                      : characterStage === 'turnaround'
                        ? '16:9'
                        : aspectRatio
                    : '中文'}
                </strong>
              </div>
              {sourceSuggestion && (
                <SourceSuggestionPanel
                  suggestion={sourceSuggestion}
                  applied={suggestionApplied}
                  titleLabel={kind === 'character' ? '人物建议栏' : '建议栏'}
                  description="这里展示的是系统从剧本或小说事实源提取的建议，不会自动写入草稿。"
                  onApply={() => applySourceSuggestion('full')}
                  onApplyPrompt={() => applySourceSuggestion('prompt')}
                />
              )}
              <div className="prompt-mode-switch">
                <button
                  type="button"
                  className={draft.promptMode === 'standard' ? 'active' : ''}
                  onClick={() => selectPromptMode('standard')}
                >
                  标准模式
                </button>
                <button
                  type="button"
                  className={draft.promptMode === 'advanced' ? 'active' : ''}
                  onClick={() => selectPromptMode('advanced')}
                >
                  高级模式
                </button>
              </div>
              <label className="compiled-prompt">
                <span>
                  {draft.promptMode === 'advanced'
                    ? 'Provider 完整提示词（修改后直接传参）'
                    : '最终发送给 Provider'}
                </span>
                <textarea
                  readOnly={draft.promptMode !== 'advanced'}
                  value={draft.promptMode === 'advanced' ? draft.customPrompt : generatedPrompt}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      customPromptMode: 'replace',
                      customPrompt: event.target.value,
                    })
                  }
                />
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
                  <small className="field-hint">
                    进入高级模式时已复制系统完整提示词；选择完全覆盖后，上方内容不会再被系统追加或改写。
                  </small>
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
                <small className="field-hint">系统会按人物、场景、产品和画风自动合并质量保护规则。</small>
              </label>
              <div className="provider-payload-note">
                <strong>Img2 请求已准备</strong>
                <p>参考图、项目比例、属性、提示词和输出规格都会随生成任务提交。</p>
              </div>
            </aside>
          ) : (
            <aside className="prompt-workbench direct-asset-summary">
              <div className="prompt-workbench-head">
                <span>
                  <FileUp size={16} />
                  直接使用原图
                </span>
                <strong>0 积分</strong>
              </div>
              <div className="direct-asset-flow">
                <span>原图</span>
                <span>资产库</span>
                <span>分镜 / 视频参考</span>
              </div>
              <dl>
                <div>
                  <dt>图片生成</dt>
                  <dd>不调用 Img2</dd>
                </div>
                <div>
                  <dt>提示词</dt>
                  <dd>不提交生成提示词</dd>
                </div>
                <div>
                  <dt>素材说明</dt>
                  <dd>仅用于检索与镜头匹配</dd>
                </div>
              </dl>
            </aside>
          )}
        </div>

        <footer
          className={`asset-studio-actions ${kind !== 'character' && kind !== 'audio' && !directImport ? 'has-background-action' : ''}`}
        >
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
          {kind !== 'character' && kind !== 'audio' && !directImport && onGenerateAsset && (
            <button
              className="button secondary"
              type="button"
              disabled={savingAction !== null}
              onClick={() => void generateAssetAndClose()}
            >
              {savingAction === 'generate' ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <LogOut size={15} />
              )}
              {savingAction === 'generate' ? '正在加入队列' : '后台生成并退出'}
            </button>
          )}
          <button className="button primary" disabled={savingAction !== null}>
            {savingAction === 'save' ? '保存中…' : directImport ? '保存并直接使用' : '保存资产'}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}

function SourceSuggestionPanel({
  suggestion,
  applied,
  titleLabel = '建议提示词',
  description = '这里展示的是系统从剧本或小说事实源提取的建议，不会自动写入草稿。',
  onApply,
  onApplyPrompt,
}) {
  const facts = buildEditorSuggestionFacts(suggestion)
  return (
    <section className="asset-suggestion-panel">
      <div className="asset-suggestion-panel-head">
        <div>
          <span className="eyebrow">{titleLabel}</span>
          <h3>{suggestion.name || '未命名建议'}</h3>
          <p>{description}</p>
        </div>
        <div className="asset-suggestion-actions">
          <button className="button primary" type="button" onClick={onApply}>
            {applied ? '重新填入建议' : '填入建议'}
          </button>
          {suggestion.prompt && (
            <button className="button secondary" type="button" onClick={onApplyPrompt}>
              仅填提示词
            </button>
          )}
        </div>
      </div>
      {facts.length > 0 && (
        <dl className="asset-suggestion-facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {suggestion.prompt && (
        <div className="asset-suggestion-prompt">
          <strong>提示词</strong>
          <p>{suggestion.prompt}</p>
        </div>
      )}
      {suggestion.reason && <small>建议依据：{suggestion.reason}</small>}
    </section>
  )
}

function mergeSuggestionIntoDraft(draft, suggestion, kind, mode) {
  const promptPatch = suggestion.prompt
    ? {
        promptMode: 'advanced',
        customPromptMode: kind === 'character' ? 'append' : 'replace',
        customPrompt: suggestion.prompt,
      }
    : {}
  if (mode === 'prompt') {
    return {
      ...draft,
      ...promptPatch,
      negativePrompt: suggestion.negativePrompt || draft.negativePrompt,
    }
  }
  return {
    ...draft,
    name: suggestion.name || draft.name,
    description: suggestion.description || draft.description,
    ...promptPatch,
    negativePrompt: suggestion.negativePrompt || draft.negativePrompt,
    references: suggestion.references?.length ? suggestion.references : draft.references,
    imageUrl: suggestion.imageUrl || draft.imageUrl,
    attributes:
      suggestion.attributes?.type === kind
        ? { ...draft.attributes, ...suggestion.attributes, type: kind }
        : draft.attributes,
  }
}

function buildEditorSuggestionFacts(suggestion) {
  const attributes = suggestion.attributes || {}
  if (suggestion.kind === 'character') {
    if (attributes.subjectType === 'animal') {
      return [
        { label: '类型', value: '动物角色' },
        { label: '物种', value: attributes.species || suggestion.name || '未指定' },
        { label: '形态', value: attributes.anthropomorphic ? '拟人化' : '自然动物' },
        { label: '身份', value: suggestion.description || suggestion.reason || '未补充' },
      ]
    }
    return [
      {
        label: '性别',
        value: optionLabel('gender', attributes.gender || 'unspecified'),
      },
      { label: '年龄段', value: optionLabel('ageGroup', attributes.ageGroup || 'young') },
      { label: '精确年龄', value: attributes.exactAge ? String(attributes.exactAge) : '未指定' },
      { label: '身份', value: suggestion.description || suggestion.reason || '未补充' },
    ]
  }
  if (suggestion.kind === 'scene') {
    return [
      { label: '空间', value: attributes.space ? optionLabel('space', attributes.space) : '未指定' },
      {
        label: '场景',
        value: attributes.sceneType ? optionLabel('sceneType', attributes.sceneType) : '未指定',
      },
      { label: '时间', value: attributes.time ? optionLabel('time', attributes.time) : '未指定' },
      { label: '氛围', value: attributes.mood ? optionLabel('mood', attributes.mood) : '未指定' },
    ]
  }
  if (suggestion.kind === 'prop') {
    return [
      {
        label: '分类',
        value: attributes.category ? optionLabel('propCategory', attributes.category) : '未指定',
      },
      { label: '材质', value: attributes.material ? optionLabel('material', attributes.material) : '未指定' },
      { label: '视角', value: attributes.view ? optionLabel('view', attributes.view) : '未指定' },
      {
        label: '状态',
        value: attributes.condition ? optionLabel('condition', attributes.condition) : '未指定',
      },
    ]
  }
  if (suggestion.kind === 'costume') {
    return [
      { label: '对象', value: attributes.audience ? optionLabel('audience', attributes.audience) : '未指定' },
      {
        label: '类型',
        value: attributes.category ? optionLabel('costumeCategory', attributes.category) : '未指定',
      },
      { label: '季节', value: attributes.season ? optionLabel('season', attributes.season) : '未指定' },
      { label: '风格', value: attributes.design ? optionLabel('design', attributes.design) : '未指定' },
    ]
  }
  return []
}
