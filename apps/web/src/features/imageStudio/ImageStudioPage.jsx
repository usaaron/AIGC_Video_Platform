import { useEffect, useMemo, useRef, useState } from 'react'
import { Film, ShieldCheck, Zap } from 'lucide-react'
import {
  IMAGE2_CREDITS_PER_IMAGE,
  IMAGE2_MAX_INPUT_IMAGES,
  IMAGE2_MAX_REFERENCE_IMAGES,
  IMAGE2_PROVIDER_DISPLAY_NAME,
} from '@seqora/contracts'
import { ImageResultGallery } from './ImageResultGallery'
import { PromptComposer } from './PromptComposer'
import { ReferenceStrip } from './ReferenceStrip'
import { createImage2Batch, deleteImage2Task, uploadGeneratedResult, uploadReference } from './image2Client'
import { image2ResultCacheRecords, groupImage2Batches, mergeImage2Tasks } from './image2Results'
import { image2BatchInputFromTask, image2EditFormFromTask } from './image2TaskParameters'
import {
  cacheImageResults,
  loadCachedImageResults,
  releaseCachedImageResults,
  removeCachedImageResult,
} from './imageResultCache'

export function ImageStudioPage({
  project,
  billing,
  tasks = [],
  image2ProviderStatus = null,
  onRefresh,
  onOpenBilling,
}) {
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState('auto')
  const [quality, setQuality] = useState('low')
  const [imageCount, setImageCount] = useState(1)
  const [references, setReferences] = useState([])
  const [assist, setAssist] = useState({ promptOptimization: false, referenceVision: false })
  const [nextReferenceNumber, setNextReferenceNumber] = useState(1)
  const [insertRequest, setInsertRequest] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [resultAction, setResultAction] = useState(null)
  const [message, setMessage] = useState('')
  const [cachedResults, setCachedResults] = useState([])
  const [hiddenResultIds, setHiddenResultIds] = useState([])
  const [selectedBatchId, setSelectedBatchId] = useState(null)
  const controlsStageRef = useRef(null)

  const availableCredits = availableCreditsForBilling(billing)
  const estimatedCredits = imageCount * IMAGE2_CREDITS_PER_IMAGE
  const visibleTasks = useMemo(
    () => tasks.filter((task) => !hiddenResultIds.includes(task.id)),
    [hiddenResultIds, tasks],
  )
  const mergedTasks = useMemo(
    () => mergeImage2Tasks(visibleTasks, cachedResults, project?.id),
    [cachedResults, project?.id, visibleTasks],
  )
  const batches = useMemo(() => groupImage2Batches(mergedTasks, project?.id), [mergedTasks, project?.id])
  const liveCacheRecords = useMemo(() => image2ResultCacheRecords(tasks, project?.id), [tasks, project?.id])
  const liveCacheSignature = liveCacheRecords
    .map((record) => `${record.id}:${record.url}:${record.savedAt}`)
    .join('|')
  const promptWarnings = useMemo(() => getPromptReferenceWarnings(prompt, references), [prompt, references])
  const selectedBatch = batches.find((batch) => batch.batchId === selectedBatchId) ?? batches[0] ?? null
  const providerConfigured = image2ProviderStatus === 'configured'
  const providerStatusMessage = providerConfigured ? '' : '序幕 image2 服务尚未配置，当前无法提交批次。'
  const handleRoleChange = (mediaId, role) => {
    const nextReferences = references.map((item) => {
      if (item.mediaId === mediaId) return { ...item, role }
      if (role === 'subject' && item.role === 'subject') return { ...item, role: 'style' }
      return item
    })
    if (
      nextReferences.filter((reference) => reference.role !== 'subject').length > IMAGE2_MAX_REFERENCE_IMAGES
    ) {
      setMessage(`引用图最多 ${IMAGE2_MAX_REFERENCE_IMAGES} 张；5 张输入图时需保留 1 张主体图`)
      return
    }
    setReferences(nextReferences)
    if (role === 'subject') setMessage('主体图最多 1 张，已将所选图片设为主体')
  }

  useEffect(() => {
    let active = true
    setHiddenResultIds([])
    setCachedResults([])
    setSelectedBatchId(null)
    if (!project?.id) return undefined
    loadCachedImageResults(project.id)
      .then((results) => {
        if (active) setCachedResults(results)
      })
      .catch(() => {
        if (active) setMessage('本机结果缓存读取失败，当前仍可使用服务器结果')
      })
    return () => {
      active = false
    }
  }, [project?.id])

  useEffect(() => {
    return () => releaseCachedImageResults(cachedResults)
  }, [cachedResults])

  useEffect(() => {
    if (!project?.id || !liveCacheRecords.length) return undefined
    let active = true
    cacheImageResults(liveCacheRecords)
      .then(() => loadCachedImageResults(project.id))
      .then((results) => {
        if (active) setCachedResults(results)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [liveCacheSignature, liveCacheRecords, project?.id])

  const handleUpload = async (files) => {
    if (!project?.id) {
      setMessage('请先选择项目')
      return
    }
    const selectedFiles = Array.isArray(files) ? files : [files]
    const remainingSlots = IMAGE2_MAX_INPUT_IMAGES - references.length
    if (remainingSlots <= 0) {
      setMessage(`最多上传 ${IMAGE2_MAX_INPUT_IMAGES} 张引用图`)
      return
    }
    const acceptedFiles = selectedFiles.slice(0, remainingSlots)
    const trimmedCount = selectedFiles.length - acceptedFiles.length
    setUploading(true)
    setMessage('')
    const uploadedReferences = []
    let nextNumber = nextReferenceNumber
    let hasSubject = references.some((reference) => reference.role === 'subject')
    try {
      for (const file of acceptedFiles) {
        const media = await uploadReference(project.id, file)
        const role = hasSubject ? 'style' : 'subject'
        hasSubject = hasSubject || role === 'subject'
        uploadedReferences.push({
          mediaId: media.id,
          url: media.url,
          role,
          inputNumber: nextNumber,
        })
        nextNumber += 1
      }
      setReferences((current) => [...current, ...uploadedReferences])
      setNextReferenceNumber(nextNumber)
      setMessage(
        trimmedCount > 0
          ? `已添加 ${uploadedReferences.length} 张，当前最多保留 ${IMAGE2_MAX_INPUT_IMAGES} 张`
          : `已添加 ${uploadedReferences.length} 张引用图`,
      )
    } catch (error) {
      if (uploadedReferences.length) {
        setReferences((current) => [...current, ...uploadedReferences])
        setNextReferenceNumber(nextNumber)
      }
      setMessage(error.message || '引用图上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async () => {
    const cleanPrompt = prompt.trim()
    if (!project?.id) {
      setMessage('请先选择项目')
      return
    }
    if (!providerConfigured) {
      setMessage(providerStatusMessage)
      return
    }
    if (!cleanPrompt) {
      setMessage('请先输入提示词')
      return
    }
    if (estimatedCredits > availableCredits) {
      setMessage(`当前可用 ${availableCredits} 积分，本批预计 ${estimatedCredits} 积分`)
      return
    }
    setSubmitting(true)
    setMessage(assist.promptOptimization || assist.referenceVision ? '正在由服务端处理高级辅助能力' : '')
    try {
      const result = await createImage2Batch({
        clientRequestId: nextClientRequestId(),
        projectId: project.id,
        prompt: cleanPrompt,
        ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
        aspectRatio,
        quality,
        imageCount,
        assist,
        references: references.map((reference) => ({
          mediaId: reference.mediaId,
          role: reference.role,
          referenceNumber: reference.inputNumber,
        })),
      })
      setSelectedBatchId(result.batchId)
      setMessage(
        promptWarnings.length
          ? `${result.tasks.length} 张图片已进入队列，引用检查提醒：${promptWarnings.join('；')}`
          : `${result.tasks.length} 张图片已进入队列`,
      )
      await onRefresh?.()
    } catch (error) {
      setMessage(error.message || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await onRefresh?.()
    } catch (error) {
      setMessage(error.message || '队列刷新失败')
    } finally {
      setRefreshing(false)
    }
  }

  const handleRedo = async (task) => {
    if (!project?.id) throw new Error('请先选择项目')
    if (!providerConfigured) throw new Error(providerStatusMessage)
    if (availableCredits < IMAGE2_CREDITS_PER_IMAGE) {
      throw new Error(`当前可用 ${availableCredits} 积分，重做需要 ${IMAGE2_CREDITS_PER_IMAGE} 积分`)
    }

    setResultAction({ type: 'redo', taskId: task.id })
    setMessage('')
    try {
      const result = await createImage2Batch({
        clientRequestId: nextClientRequestId(),
        ...image2BatchInputFromTask(task, project.id),
      })
      setSelectedBatchId(result.batchId)
      await onRefresh?.()
      setMessage('已按原任务参数提交 1 张图片')
      return result
    } catch (error) {
      setMessage(error.message || '重做提交失败')
      throw error
    } finally {
      setResultAction(null)
    }
  }

  const handleEditResult = async (task, image) => {
    if (!project?.id) throw new Error('请先选择项目')
    setResultAction({ type: 'edit', taskId: task.id })
    setMessage('')
    try {
      const media = await uploadGeneratedResult(project.id, image)
      const form = image2EditFormFromTask(task, media)
      setPrompt(form.prompt)
      setNegativePrompt(form.negativePrompt)
      setAspectRatio(form.aspectRatio)
      setQuality(form.quality)
      setImageCount(form.imageCount)
      setAssist(form.assist)
      setReferences(form.references)
      setNextReferenceNumber(form.nextReferenceNumber)
      setInsertRequest(null)
      setMessage('已把当前结果设为主体图，可修改提示词后再次生成')
      requestAnimationFrame(() => {
        controlsStageRef.current?.scrollIntoView({
          behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth',
          block: 'start',
        })
      })
      return media
    } catch (error) {
      setMessage(error.message || '结果图转为主体图失败')
      throw error
    } finally {
      setResultAction(null)
    }
  }

  const handleUseAsReference = async (task, image) => {
    if (!project?.id) throw new Error('请先选择项目')
    if (references.length >= IMAGE2_MAX_INPUT_IMAGES) {
      throw new Error(`最多保留 ${IMAGE2_MAX_INPUT_IMAGES} 张输入图`)
    }
    if (
      references.filter((reference) => reference.role !== 'subject').length >= IMAGE2_MAX_REFERENCE_IMAGES
    ) {
      throw new Error(`引用图最多 ${IMAGE2_MAX_REFERENCE_IMAGES} 张`)
    }

    setResultAction({ type: 'reference', taskId: task.id })
    setMessage('')
    try {
      const media = await uploadGeneratedResult(project.id, image)
      const reference = {
        mediaId: media.id,
        url: media.url,
        role: 'style',
        inputNumber: nextReferenceNumber,
      }
      setReferences((current) => [...current, reference])
      setNextReferenceNumber((current) => Math.max(current, reference.inputNumber + 1))
      setMessage(`已将当前结果加入引用图，编号为图 ${reference.inputNumber}`)
      requestAnimationFrame(() => {
        controlsStageRef.current?.scrollIntoView({
          behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth',
          block: 'start',
        })
      })
      return media
    } catch (error) {
      setMessage(error.message || '结果图转为引用图失败')
      throw error
    } finally {
      setResultAction(null)
    }
  }

  const handleDeleteResult = async (task) => {
    if (!project?.id) throw new Error('请先选择项目')
    setResultAction({ type: 'delete', taskId: task.id })
    setMessage('')
    try {
      try {
        await deleteImage2Task(task.id)
      } catch (error) {
        if (error?.status !== 404) throw error
      }
      await removeCachedImageResult(task.id)
      setCachedResults((current) => current.filter((result) => result.id !== task.id))
      setHiddenResultIds((current) => (current.includes(task.id) ? current : [...current, task.id]))
      await onRefresh?.()
      setMessage('已从结果记录中删除图片，已消耗积分不会退回')
    } catch (error) {
      setMessage(error.message || '删除图片失败')
      throw error
    } finally {
      setResultAction(null)
    }
  }

  if (!project) {
    return (
      <section
        className="tool-studio-frame image-studio-frame image2-workbench"
        aria-label="序幕 image2 工作台"
      >
        <div className="image2-empty-workspace">
          <Film size={28} />
          <strong>请选择项目</strong>
          <span>序幕 image2 会把批次任务写入当前项目。</span>
        </div>
      </section>
    )
  }

  return (
    <section
      className="tool-studio-frame image-studio-frame image2-workbench"
      aria-label="序幕 image2 工作台"
    >
      <header className="image2-toolbar">
        <div className="image2-toolbar-title">
          <span className="eyebrow">IMAGE2</span>
          <strong>{IMAGE2_PROVIDER_DISPLAY_NAME}</strong>
          <small>{project.name}</small>
        </div>
        <div className="image2-toolbar-metrics">
          <span>
            <Zap size={14} fill="currentColor" /> {availableCredits} 积分
          </span>
          <span className={estimatedCredits > availableCredits ? 'warning' : ''}>
            本批 {estimatedCredits}
          </span>
          <span className={providerConfigured ? '' : 'warning'}>
            <ShieldCheck size={14} /> {providerConfigured ? '服务端结算' : '序幕 image2 未配置'}
          </span>
        </div>
        <button className="button secondary image2-toolbar-billing" type="button" onClick={onOpenBilling}>
          积分账单
        </button>
      </header>

      <div className="image-studio-layout image2-layout">
        <div className="image2-results-stage">
          <ImageResultGallery
            batch={selectedBatch}
            batches={batches}
            selectedBatchId={selectedBatch?.batchId ?? null}
            onSelectBatch={setSelectedBatchId}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            onRedo={handleRedo}
            onEdit={handleEditResult}
            onUseAsReference={handleUseAsReference}
            onDelete={handleDeleteResult}
          />
        </div>

        <div ref={controlsStageRef} className="image2-controls-stage">
          <PromptComposer
            prompt={prompt}
            negativePrompt={negativePrompt}
            availableCredits={availableCredits}
            estimatedCredits={estimatedCredits}
            aspectRatio={aspectRatio}
            quality={quality}
            imageCount={imageCount}
            onAspectRatioChange={setAspectRatio}
            onQualityChange={setQuality}
            onImageCountChange={setImageCount}
            assist={assist}
            onAssistChange={setAssist}
            submitting={submitting}
            disabled={
              submitting ||
              uploading ||
              Boolean(resultAction) ||
              !providerConfigured ||
              estimatedCredits > availableCredits
            }
            insertRequest={insertRequest}
            error={message || providerStatusMessage}
            onPromptChange={setPrompt}
            onNegativePromptChange={setNegativePrompt}
            onSubmit={handleSubmit}
          />
          <ReferenceStrip
            references={references}
            uploading={uploading}
            disabled={uploading || Boolean(resultAction) || references.length >= IMAGE2_MAX_INPUT_IMAGES}
            warnings={promptWarnings}
            onUpload={handleUpload}
            onRemove={(mediaId) =>
              setReferences((current) => current.filter((item) => item.mediaId !== mediaId))
            }
            onRoleChange={handleRoleChange}
            onInsertReference={(number) =>
              setInsertRequest({ text: `图 ${number}`, nonce: `${number}-${Date.now()}` })
            }
          />
        </div>
      </div>
    </section>
  )
}

function availableCreditsForBilling(billing) {
  if (!billing) return 0
  if (billing.billingScope === 'organization')
    return billing.organizationPool?.credits ?? billing.credits ?? 0
  return billing.credits ?? 0
}

function nextClientRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `image2-${Date.now()}`
}

const SOFT_REFERENCE_ROLES = new Set(['style', 'composition', 'color'])

export function getPromptReferenceWarnings(prompt, references) {
  const warnings = []
  const byNumber = new Map(
    references
      .map((reference) => [positiveReferenceNumber(reference.inputNumber), reference])
      .filter(([number]) => number > 0),
  )

  for (const number of promptReferenceNumbers(prompt)) {
    const reference = byNumber.get(number)
    if (!reference) {
      warnings.push(`图 ${number} 不存在，请确认引用编号。`)
      continue
    }
    if (reference.role === 'subject' && isSubjectReferenceRoleConflict(prompt, number)) {
      warnings.push(`图 ${number} 当前标为主体，但提示词像是在把它当成服装、配饰或风格参考，可能混淆。`)
    }
  }

  const nonSubjectReferences = references.filter((reference) => reference.role !== 'subject')
  const softReferenceCount = nonSubjectReferences.filter((reference) =>
    SOFT_REFERENCE_ROLES.has(reference.role),
  ).length
  if (nonSubjectReferences.length > 3 || softReferenceCount > 1) {
    warnings.push('引用图片较多或风格差异较大时可能互相冲突，建议主体 1 张 + 参考 1-3 张。')
  }

  return [...new Set(warnings)]
}

function promptReferenceNumbers(prompt) {
  const numbers = new Set()
  const pattern = /图\s*([0-9０-９]+)/g
  let match = pattern.exec(String(prompt || ''))

  while (match) {
    const number = normalizePromptDigit(match[1])
    if (number) numbers.add(number)
    match = pattern.exec(String(prompt || ''))
  }

  return [...numbers].sort((left, right) => left - right)
}

function normalizePromptDigit(value) {
  const number = Number(
    String(value || '').replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10)),
  )
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0
}

function positiveReferenceNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0
}

function isSubjectReferenceRoleConflict(prompt, imageNumber) {
  const text = String(prompt || '').replace(/\s+/g, '')
  const numberText = String(imageNumber)
  const fullWidthNumber = numberText.replace(/[0-9]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 0xff10 - 48),
  )
  const imagePattern = `图\\s*(?:${escapeRegExp(numberText)}|${escapeRegExp(fullWidthNumber)})`
  const referenceWords = '(?:衣服|服装|穿搭|穿上|帽子|头饰|配饰|饰品|风格|画风|构图|色调|滤镜)'
  return (
    new RegExp(`${imagePattern}.{0,12}${referenceWords}`).test(text) ||
    new RegExp(`${referenceWords}.{0,12}${imagePattern}`).test(text)
  )
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
