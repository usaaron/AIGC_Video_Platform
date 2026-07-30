import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Camera,
  Clapperboard,
  Clock3,
  Image,
  Lightbulb,
  LoaderCircle,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Save,
  Sparkles,
  Upload,
  UserRound,
} from 'lucide-react'
import { IconButton, PageHeader } from '../components/ui'
import { AssetEditor } from '../features/assets/AssetEditor'
import { NovelImportPanel } from '../features/novel/NovelImportPanel'
import { QuickStartModal } from '../features/quickStart/QuickStartModal'
import { AssetSuggestionsPanel, assetSuggestionKey } from '../features/script/AssetSuggestionsPanel'
import {
  restoreScriptAssetSuggestionsCache,
  saveScriptAssetSuggestionsCache,
} from '../features/script/assetSuggestionCache'
import { DEFAULT_SCRIPT_DIRECTION, SCRIPT_OPERATION_CREDITS } from '@seqora/contracts'

const DEFAULT_TEXT_MODEL = 'glm-5.2'
const TEXT_MODEL_OPTIONS = [
  { value: 'glm-5.2', label: 'GLM 5.2' },
  { value: 'glm-5.2-fast', label: 'GLM 5.2 Fast' },
  { value: 'kimi-k3', label: 'Kimi K3' },
  { value: 'kimi-k3-thinking', label: 'Kimi K3 Thinking' },
  { value: 'gpt-5.6', label: '序幕-SEQORA 5.6' },
  { value: 'gpt-5.5', label: '序幕-SEQORA 5.5' },
  { value: 'gpt-5.4', label: '序幕-SEQORA 5.4' },
  { value: 'deepseekV3', label: 'DeepSeek V3' },
]

const DIRECTION_FIELDS = [
  {
    key: 'style',
    label: '视觉风格',
    icon: Sparkles,
    options: [
      ['auto', 'AI 自动匹配'],
      ['photorealistic', '仿真人电影感'],
      ['cinematic-cg', '电影级 CG'],
      ['chinese-3d', '国漫三维'],
      ['chinese-2d', '国漫二维'],
      ['anime', '日系动画'],
      ['storybook', '绘本风格'],
    ],
  },
  {
    key: 'composition',
    label: '构图',
    icon: Image,
    options: [
      ['auto', 'AI 自动匹配'],
      ['rule-of-thirds', '三分法'],
      ['centered', '中心构图'],
      ['symmetry', '对称构图'],
      ['negative-space', '留白构图'],
      ['dynamic', '动态斜线'],
    ],
  },
  {
    key: 'lighting',
    label: '光影',
    icon: Lightbulb,
    options: [
      ['auto', 'AI 自动匹配'],
      ['natural-soft', '自然柔光'],
      ['high-contrast', '高反差硬光'],
      ['low-key', '低调暗光'],
      ['backlight', '逆光轮廓光'],
      ['neon', '霓虹彩光'],
    ],
  },
  {
    key: 'camera',
    label: '运镜',
    icon: Camera,
    options: [
      ['auto', 'AI 自动匹配'],
      ['restrained', '克制稳定'],
      ['immersive', '沉浸跟随'],
      ['dynamic', '动态动作'],
      ['documentary', '纪录片手持'],
      ['suspense', '悬疑压迫'],
    ],
  },
]

const FOCUS_OPTIONS = [
  ['balanced', '均衡'],
  ['scene', '场景'],
  ['character', '角色'],
  ['dialogue', '对白'],
]

const INSERT_BLOCKS = [
  {
    key: 'scene',
    label: '场景卡',
    icon: Image,
    value: '场景：地点｜内/外｜时间｜天气\n画面：环境主体、空间层次、关键道具\n视觉：构图｜光影｜运镜\n',
  },
  {
    key: 'character',
    label: '角色卡',
    icon: UserRound,
    value: '角色：姓名｜身份｜当前目标\n外观：服装、状态、关键识别特征\n动作：起势、过程、结束｜情绪：\n',
  },
  {
    key: 'dialogue',
    label: '对白段',
    icon: MessageSquare,
    value: '对白：\n角色名（情绪/动作）：台词\n反应：对方的表情、视线或动作\n',
  },
]

const SCRIPT_SECTIONS = [
  {
    id: 'writing',
    label: '剧本编写',
    description: '输入、保存和检查',
    icon: Clapperboard,
  },
  {
    id: 'novel',
    label: '小说上传与章节',
    description: '导入长文本，切分章节并生成概要',
    icon: Upload,
  },
]

export function ScriptPage({
  project,
  billing,
  onSave,
  onImportNovel,
  onPreviewNovelSplit,
  onListNovels,
  onGetNovel,
  onGetNovelSummaries,
  onGenerateNovelSummaries,
  onGetNovelStoryBible,
  onGenerateNovelStoryBible,
  onGenerateNovelChapterAdaptation,
  onSuggestNovelAssets,
  onSuggestAssets,
  onEnrich,
  onCreateAsset,
  onUpload,
  onPlanQuickStart,
  onExecuteQuickStart,
  onNext,
}) {
  const [script, setScript] = useState(project.script)
  const [saved, setSaved] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [enrichWarnings, setEnrichWarnings] = useState([])
  const [textModel, setTextModel] = useState(DEFAULT_TEXT_MODEL)
  const [direction, setDirection] = useState(DEFAULT_SCRIPT_DIRECTION)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [activeScriptSection, setActiveScriptSection] = useState('writing')
  const [error, setError] = useState('')
  const [quickStartOpen, setQuickStartOpen] = useState(false)
  const [quickStartState, setQuickStartState] = useState('idle')
  const [quickStartPlan, setQuickStartPlan] = useState(null)
  const [quickStartResult, setQuickStartResult] = useState(null)
  const [quickStartError, setQuickStartError] = useState('')
  const [assetSuggestionStatus, setAssetSuggestionStatus] = useState('idle')
  const [assetSuggestionResult, setAssetSuggestionResult] = useState(null)
  const [assetSuggestionError, setAssetSuggestionError] = useState('')
  const [creatingAssetKeys, setCreatingAssetKeys] = useState(() => new Set())
  const [createdAssetKeys, setCreatedAssetKeys] = useState(() => new Set())
  const [suggestedAssetEditor, setSuggestedAssetEditor] = useState(null)
  const fileInput = useRef(null)
  const textArea = useRef(null)
  const count = script.replace(/\s/g, '').length
  const paragraphCount = script.split(/\n+/).filter(Boolean).length
  const characterCount = script.trim() ? Math.max(1, new Set(script.match(/角色：[^，。]+/g) || []).size) : 0
  const suggestedShots = script.trim() ? Math.min(12, Math.max(1, paragraphCount)) : 0
  const estimatedMinutes = script.trim() ? Math.max(1, Math.ceil(count / 120)) : 0
  const busy = saving || enriching || quickStartState === 'starting'

  useEffect(() => {
    const cachedAssetSuggestions = restoreScriptAssetSuggestionsCache(project.id, project.script)
    const nextScript = cachedAssetSuggestions?.sourceScript ?? project.script
    setScript(nextScript)
    setSaved(nextScript === project.script)
    setEnrichWarnings([])
    setError('')
    setTextModel(cachedAssetSuggestions?.model || DEFAULT_TEXT_MODEL)
    setDirection(cachedAssetSuggestions?.direction || DEFAULT_SCRIPT_DIRECTION)
    setAssetSuggestionStatus(cachedAssetSuggestions?.result ? 'ready' : 'idle')
    setAssetSuggestionResult(cachedAssetSuggestions?.result || null)
    setAssetSuggestionError('')
    setCreatingAssetKeys(new Set())
    setCreatedAssetKeys(cachedAssetSuggestions?.createdKeys || new Set())
  }, [project.id, project.script])

  useEffect(() => {
    setQuickStartOpen(false)
    setQuickStartState('idle')
    setQuickStartPlan(null)
    setQuickStartResult(null)
    setQuickStartError('')
  }, [project.id])

  const update = (value) => {
    setScript(value)
    setSaved(false)
    setEnrichWarnings([])
    setAssetSuggestionStatus('idle')
    setAssetSuggestionError('')
  }

  const suggestAssetsForScript = async (value) => {
    const source = value.trim()
    if (!source) return
    setAssetSuggestionStatus('suggesting')
    setAssetSuggestionError('')
    try {
      const result = await onSuggestAssets(source, direction, textModel)
      setAssetSuggestionResult(result)
      setCreatedAssetKeys(new Set())
      saveScriptAssetSuggestionsCache(project.id, source, direction, textModel, result, [])
    } catch (suggestError) {
      setAssetSuggestionError(suggestError.message)
    } finally {
      setAssetSuggestionStatus('ready')
    }
  }

  const openSuggestedAssetEditor = (asset) => {
    const key = assetSuggestionKey(asset)
    setAssetSuggestionError('')
    setSuggestedAssetEditor({
      kind: asset.kind,
      suggestion: asset,
      suggestionKey: key,
      editorKey: crypto.randomUUID(),
    })
  }

  const useAdaptedNovelScript = async (adaptedScript) => {
    const nextScript = adaptedScript.trim()
    if (!nextScript) {
      setError('章节改编剧本为空')
      return
    }
    setSaving(true)
    setError('')
    try {
      setScript(nextScript)
      await onSave(nextScript)
      setSaved(true)
      setActiveScriptSection('writing')
      void suggestAssetsForScript(nextScript)
      requestAnimationFrame(() => textArea.current?.focus())
    } catch (saveError) {
      setSaved(false)
      setError(saveError.message)
      throw saveError
    } finally {
      setSaving(false)
    }
  }

  const insert = (value) => {
    const element = textArea.current
    const start = element?.selectionStart ?? script.length
    const end = element?.selectionEnd ?? script.length
    const prefix =
      script && start === 0 ? '' : script && !script.endsWith('\n') && start === script.length ? '\n\n' : ''
    const next = `${script.slice(0, start)}${prefix}${value}${script.slice(end)}`
    update(next)
    requestAnimationFrame(() => {
      element?.focus()
      const cursor = start + prefix.length + value.length
      element?.setSelectionRange(cursor, cursor)
    })
  }

  const upload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      update(await file.text())
      setActiveScriptSection('writing')
    } catch (uploadError) {
      setError(uploadError.message)
    }
    event.target.value = ''
  }

  const save = async () => {
    if (!script.trim()) {
      setError('请先填写剧本内容')
      return false
    }
    setSaving(true)
    setError('')
    try {
      await onSave(script)
      setSaved(true)
      return true
    } catch (saveError) {
      setError(saveError.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const enrich = async () => {
    if (!script.trim()) {
      setError('请先填写剧本内容')
      return
    }
    if (billing.credits < SCRIPT_OPERATION_CREDITS.enrich) {
      setError(`AI 扩写需要 ${SCRIPT_OPERATION_CREDITS.enrich} 积分，当前剩余 ${billing.credits} 积分`)
      return
    }
    setEnriching(true)
    setError('')
    setEnrichWarnings([])
    try {
      const result = await onEnrich(script, direction, textModel)
      const nextScript = result.script?.trim()
      if (!nextScript) throw new Error('AI 扩写结果为空')
      setScript(nextScript)
      setSaved(true)
      setEnrichWarnings(result.warnings || [])
      void suggestAssetsForScript(nextScript)
      requestAnimationFrame(() => textArea.current?.focus())
    } catch (enrichError) {
      setError(enrichError.message)
    } finally {
      setEnriching(false)
    }
  }

  const openQuickStart = async () => {
    if (!script.trim()) {
      setError('请先填写剧本内容')
      return
    }
    setQuickStartOpen(true)
    setQuickStartState('analyzing')
    setQuickStartPlan(null)
    setQuickStartResult(null)
    setQuickStartError('')
    try {
      if (!saved && !(await save())) throw new Error('剧本保存失败')
      setQuickStartPlan(await onPlanQuickStart(textModel))
      setQuickStartState('ready')
    } catch (quickError) {
      setQuickStartError(quickError.message)
      setQuickStartState('error')
    }
  }

  const continueToAssets = async () => {
    if (!saved && !(await save())) return
    onNext()
  }

  return (
    <div className="page editor-page script-page-redesign">
      <PageHeader
        eyebrow="剧本工作台"
        title={`《${project.name}》剧本`}
        description="写作和制作准备集中在同一个工作区。"
      >
        <input ref={fileInput} className="hidden-input" type="file" accept=".txt,.md" onChange={upload} />
        <button className="button secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
          <Upload size={16} /> 导入文本
        </button>
        <button
          className="button primary"
          disabled={busy || saved || !script.trim()}
          onClick={() => void save()}
        >
          {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
          {saving ? '保存中' : saved ? '已保存' : '保存剧本'}
        </button>
        <button
          className="button quick-start-trigger"
          disabled={busy || !script.trim()}
          onClick={() => void openQuickStart()}
        >
          <Sparkles size={16} /> 一键尝鲜
        </button>
      </PageHeader>

      <div className="script-setup-row">
        <section className="script-section-nav" aria-label="剧本工作区小项">
          {SCRIPT_SECTIONS.map(({ id, label, description, icon: Icon }) => (
            <button
              type="button"
              key={id}
              className={activeScriptSection === id ? 'active' : ''}
              aria-pressed={activeScriptSection === id}
              onClick={() => setActiveScriptSection(id)}
            >
              <Icon size={18} />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </button>
          ))}
        </section>

        <div className="script-model-bar">
          <label className="script-model-field">
            <span>文本模型</span>
            <select value={textModel} disabled={busy} onChange={(event) => setTextModel(event.target.value)}>
              {TEXT_MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {activeScriptSection === 'novel' && (
        <section className="script-section-panel script-novel-section" aria-label="小说上传与章节">
          <NovelImportPanel
            project={project}
            textModel={textModel}
            disabled={busy}
            onImportNovel={onImportNovel}
            onPreviewNovelSplit={onPreviewNovelSplit}
            onListNovels={onListNovels}
            onGetNovel={onGetNovel}
            onGetNovelSummaries={onGetNovelSummaries}
            onGenerateNovelSummaries={onGenerateNovelSummaries}
            onGetNovelStoryBible={onGetNovelStoryBible}
            onGenerateNovelStoryBible={onGenerateNovelStoryBible}
            onSuggestNovelAssets={onSuggestNovelAssets}
            aspectRatio={project.aspectRatio}
            onGenerateChapterAdaptation={onGenerateNovelChapterAdaptation}
            onCreateAsset={onCreateAsset}
            onUpload={onUpload}
            onUseAdaptedScript={useAdaptedNovelScript}
          />
        </section>
      )}

      {activeScriptSection === 'writing' && (
        <div className="script-writing-stack">
          <section className="script-direction-bar" aria-label="AI 扩写方向">
            <div className="script-direction-title">
              <span className="direction-symbol">
                <Sparkles size={17} />
              </span>
              <div>
                <span className="eyebrow">AI 扩写方向</span>
                <strong>选择扩写重点，再补齐画面语言和剧情衔接</strong>
              </div>
            </div>
            <div className="script-direction-controls">
              {DIRECTION_FIELDS.map(({ key, label, icon: Icon, options }) => (
                <label key={key}>
                  <span>
                    <Icon size={13} /> {label}
                  </span>
                  <select
                    value={direction[key]}
                    disabled={busy}
                    onChange={(event) => {
                      setDirection((current) => ({ ...current, [key]: event.target.value }))
                    }}
                  >
                    {options.map(([value, optionLabel]) => (
                      <option key={value} value={value}>
                        {optionLabel}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="script-direction-footer">
              <div className="direction-focus" role="group" aria-label="扩写重点">
                <span>扩写重点</span>
                {FOCUS_OPTIONS.map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={direction.focus === value ? 'active' : ''}
                    aria-pressed={direction.focus === value}
                    disabled={busy}
                    onClick={() => {
                      setDirection((current) => ({ ...current, focus: value }))
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                className="button direction-detail-button"
                disabled={busy || !script.trim()}
                onClick={() => void enrich()}
              >
                {enriching ? <LoaderCircle size={16} className="spin" /> : <Clapperboard size={16} />}
                {enriching ? '正在扩写' : `AI 扩写 · ${SCRIPT_OPERATION_CREDITS.enrich} 积分`}
              </button>
            </div>
          </section>

          <div className={`script-workspace ${inspectorOpen ? 'with-inspector' : 'without-inspector'}`}>
            <section className="script-document" aria-busy={enriching}>
              <div className="script-document-toolbar">
                <div className="script-block-actions" role="group" aria-label="插入剧本结构">
                  {INSERT_BLOCKS.map(({ key, label, icon: Icon, value }) => (
                    <button className="format-button" key={key} disabled={busy} onClick={() => insert(value)}>
                      <Icon size={14} /> {label}
                    </button>
                  ))}
                </div>
                <div className="script-document-status">
                  <span className={saved ? 'saved' : 'unsaved'}>
                    <BadgeCheck size={14} /> {saved ? '已同步' : '未保存'}
                  </span>
                  <IconButton
                    label={inspectorOpen ? '收起剧本检查' : '打开剧本检查'}
                    type="button"
                    onClick={() => setInspectorOpen((current) => !current)}
                  >
                    {inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                  </IconButton>
                </div>
              </div>
              <div className="script-textarea-wrap">
                <textarea
                  ref={textArea}
                  value={script}
                  onChange={(event) => update(event.target.value)}
                  placeholder="写下故事内容，或插入场景、角色和对白结构……"
                />
                {enriching && (
                  <div className="script-processing-overlay" role="status">
                    <LoaderCircle size={22} className="spin" />
                    <strong>AI 正在扩写剧本</strong>
                    <span>会补齐风格、构图、光影、运镜和衔接，并写回当前剧本。</span>
                  </div>
                )}
              </div>
              <div className="script-document-footer">
                <span>{count} 字</span>
                <span>{paragraphCount} 段</span>
                <span>约 {estimatedMinutes} 分钟</span>
                <button disabled={busy || saved || !script.trim()} onClick={() => void save()}>
                  {saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
                  {saving ? '保存中' : saved ? '已保存' : '保存'}
                </button>
              </div>
            </section>

            {inspectorOpen && (
              <aside className="script-inspector">
                <div className="script-inspector-head">
                  <div>
                    <span className="eyebrow">制作概况</span>
                    <h2>剧本概况</h2>
                  </div>
                </div>
                <div className="script-metrics">
                  <div>
                    <UserRound size={15} />
                    <span>主要角色</span>
                    <strong>{characterCount}</strong>
                  </div>
                  <div>
                    <Image size={15} />
                    <span>有效段落</span>
                    <strong>{paragraphCount}</strong>
                  </div>
                  <div>
                    <Clapperboard size={15} />
                    <span>建议镜头</span>
                    <strong>{suggestedShots}</strong>
                  </div>
                  <div>
                    <Clock3 size={15} />
                    <span>文本时长</span>
                    <strong>{estimatedMinutes}m</strong>
                  </div>
                </div>
              </aside>
            )}
          </div>

          <AssetSuggestionsPanel
            status={assetSuggestionStatus}
            result={assetSuggestionResult}
            error={assetSuggestionError}
            creatingKeys={creatingAssetKeys}
            createdKeys={createdAssetKeys}
            onRefresh={() => void suggestAssetsForScript(script)}
            onInspect={openSuggestedAssetEditor}
          />

          {enrichWarnings.length > 0 && (
            <div className="script-enrich-warnings" role="status">
              {enrichWarnings.slice(0, 3).map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          )}

          {error && (
            <p className="operation-error" role="alert">
              {error}
            </p>
          )}

          <section className="script-flow-actions">
            <div>
              <span className="eyebrow">下一步</span>
              <strong>从当前剧本建立核心资产</strong>
              <small>{saved ? '当前版本已保存' : '继续时会先保存当前版本'}</small>
            </div>
            <div>
              <button
                className="button primary"
                disabled={busy || !script.trim()}
                onClick={() => void continueToAssets()}
              >
                进入资产设计 <ArrowRight size={16} />
              </button>
            </div>
          </section>
        </div>
      )}

      {suggestedAssetEditor && (
        <AssetEditor
          key={suggestedAssetEditor.editorKey}
          asset={suggestedAssetEditor}
          aspectRatio={project.aspectRatio}
          tasks={[]}
          onUpload={onUpload}
          onClose={() => setSuggestedAssetEditor(null)}
          onSave={async (input) => {
            const created = await onCreateAsset(input)
            setCreatedAssetKeys((current) => {
              const next = new Set(current).add(suggestedAssetEditor.suggestionKey)
              saveScriptAssetSuggestionsCache(
                project.id,
                script,
                direction,
                textModel,
                assetSuggestionResult,
                next,
              )
              return next
            })
            setSuggestedAssetEditor(null)
            return created
          }}
        />
      )}

      {quickStartOpen && (
        <QuickStartModal
          state={quickStartState}
          plan={quickStartPlan}
          result={quickStartResult}
          error={quickStartError}
          credits={billing.credits}
          onClose={() => quickStartState !== 'starting' && setQuickStartOpen(false)}
          onRetry={() => void openQuickStart()}
          onStart={async () => {
            setQuickStartState('starting')
            setQuickStartError('')
            try {
              const result = await onExecuteQuickStart({
                clientRequestId: crypto.randomUUID(),
                sourceScriptHash: quickStartPlan.sourceScriptHash,
                assets: quickStartPlan.assets,
              })
              setQuickStartResult(result)
              setQuickStartState('complete')
            } catch (quickError) {
              setQuickStartError(quickError.message)
              setQuickStartState('ready')
            }
          }}
          onViewAssets={() => {
            setQuickStartOpen(false)
            onNext()
          }}
        />
      )}
    </div>
  )
}
