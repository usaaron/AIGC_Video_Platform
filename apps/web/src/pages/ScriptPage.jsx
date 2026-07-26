import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Clapperboard,
  Clock3,
  Crown,
  Image,
  LoaderCircle,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
} from 'lucide-react'
import { IconButton, PageHeader } from '../components/ui'
import { AssetEditor } from '../features/assets/AssetEditor'
import { NovelImportPanel } from '../features/novel/NovelImportPanel'
import { QuickStartModal } from '../features/quickStart/QuickStartModal'
import { AssetSuggestionsPanel, assetSuggestionKey } from '../features/script/AssetSuggestionsPanel'
import { DEFAULT_SCRIPT_DIRECTION, SCRIPT_OPERATION_CREDITS } from '@seqora/contracts'

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

const REVIEW_LABELS = {
  plot: '剧情结构',
  character: '角色动机',
  dialogue: '对白表演',
  style: '风格统一',
  composition: '构图执行',
  lighting: '光影设计',
  camera: '运镜节奏',
}

export function ScriptPage({
  project,
  billing,
  onSave,
  onReview,
  onImportNovel,
  onPreviewNovelSplit,
  onListNovels,
  onGetNovel,
  onGetNovelSummaries,
  onGenerateNovelSummaries,
  onGetNovelStoryBible,
  onGenerateNovelStoryBible,
  onSuggestNovelAssets,
  onGenerateNovelChapterAdaptation,
  onSuggestAssets,
  onCreateAsset,
  onUpload,
  onPlanQuickStart,
  onExecuteQuickStart,
  onUpgrade,
  onNext,
}) {
  const [script, setScript] = useState(project.script)
  const [saved, setSaved] = useState(true)
  const [saving, setSaving] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [review, setReview] = useState(null)
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
  const isMember = billing?.plan === 'member'
  const busy = saving || reviewing || quickStartState === 'starting'

  useEffect(() => {
    setScript(project.script)
    setSaved(true)
    setReview(null)
    setError('')
  }, [project.id, project.script])

  useEffect(() => {
    setAssetSuggestionStatus('idle')
    setAssetSuggestionResult(null)
    setAssetSuggestionError('')
    setCreatingAssetKeys(new Set())
    setCreatedAssetKeys(new Set())
  }, [project.id])

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
    setReview(null)
    setAssetSuggestionStatus('idle')
    setAssetSuggestionError('')
  }

  const suggestAssetsForScript = async (value) => {
    const source = value.trim()
    if (!source) return
    setAssetSuggestionStatus('suggesting')
    setAssetSuggestionError('')
    try {
      setAssetSuggestionResult(await onSuggestAssets(source, DEFAULT_SCRIPT_DIRECTION))
      setCreatedAssetKeys(new Set())
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
    setReview(null)
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

  const analyze = async () => {
    if (!isMember) {
      onUpgrade()
      return
    }
    if (billing.credits < SCRIPT_OPERATION_CREDITS.review) {
      setError(`专业审核需要 ${SCRIPT_OPERATION_CREDITS.review} 积分，当前剩余 ${billing.credits} 积分`)
      return
    }
    if (!script.trim()) {
      setError('请先填写剧本内容')
      return
    }
    setReviewing(true)
    setError('')
    try {
      setReview(await onReview(script, DEFAULT_SCRIPT_DIRECTION))
    } catch (reviewError) {
      setError(reviewError.message)
    } finally {
      setReviewing(false)
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
      setQuickStartPlan(await onPlanQuickStart())
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
        description="写作和制作审核集中在同一个工作区。"
      >
        <input ref={fileInput} className="hidden-input" type="file" accept=".txt,.md" onChange={upload} />
        <button className="button secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
          <Upload size={16} /> 导入文本
        </button>
        <button
          className="button primary"
          disabled={saving || saved || !script.trim()}
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

      {activeScriptSection === 'novel' && (
        <section className="script-section-panel script-novel-section" aria-label="小说上传与章节">
          <NovelImportPanel
            project={project}
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
            onGenerateChapterAdaptation={onGenerateNovelChapterAdaptation}
            onCreateAsset={onCreateAsset}
            onUpload={onUpload}
            aspectRatio={project.aspectRatio}
            onUseAdaptedScript={useAdaptedNovelScript}
          />
        </section>
      )}

      {activeScriptSection === 'writing' && (
        <>
          <div className={`script-workspace ${inspectorOpen ? 'with-inspector' : 'without-inspector'}`}>
            <section className="script-document" aria-busy={reviewing}>
              <div className="script-document-toolbar">
                <div className="script-block-actions" role="group" aria-label="插入剧本结构">
                  {INSERT_BLOCKS.map(({ key, label, icon: Icon, value }) => (
                    <button className="format-button" key={key} onClick={() => insert(value)}>
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
              </div>
              <div className="script-document-footer">
                <span>{count} 字</span>
                <span>{paragraphCount} 段</span>
                <span>约 {estimatedMinutes} 分钟</span>
                <button disabled={saving || saved || !script.trim()} onClick={() => void save()}>
                  {saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
                  {saving ? '保存中' : saved ? '已保存' : '保存'}
                </button>
              </div>
            </section>

            {inspectorOpen && (
              <aside className={`script-inspector ${reviewing ? 'is-reviewing' : ''}`} aria-busy={reviewing}>
                <div className="script-inspector-head">
                  <div>
                    <span className="eyebrow">制作检查</span>
                    <h2>{review ? `${review.score} 分` : '剧本概况'}</h2>
                  </div>
                  {reviewing && <LoaderCircle size={18} className="spin" />}
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
                <button
                  className={`button analysis-review-button ${isMember ? 'primary member' : 'locked'}`}
                  onClick={() => void analyze()}
                  disabled={reviewing || !script.trim()}
                >
                  {reviewing ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : isMember ? (
                    <ShieldCheck size={16} />
                  ) : (
                    <Crown size={16} />
                  )}
                  {reviewing
                    ? '正在审核'
                    : isMember
                      ? `专业审核剧本 · ${SCRIPT_OPERATION_CREDITS.review} 积分`
                      : '会员专业审核'}
                </button>
                {review ? (
                  <div className="review-result">
                    <p className="review-verdict">{review.verdict}</p>
                    <div className="review-priorities">
                      <strong>优先修改</strong>
                      {review.priorityActions.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                    <div className="review-dimensions">
                      {review.dimensions.map((dimension) => (
                        <article key={dimension.key}>
                          <div>
                            <strong>{REVIEW_LABELS[dimension.key] || dimension.key}</strong>
                            <b>{dimension.score}</b>
                          </div>
                          <p>{dimension.finding}</p>
                          <small>{dimension.suggestion}</small>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="script-review-empty">
                    {Object.values(REVIEW_LABELS).map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                )}
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
        </>
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
            setCreatedAssetKeys((current) => new Set(current).add(suggestedAssetEditor.suggestionKey))
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
