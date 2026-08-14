import { useEffect, useMemo, useState } from 'react'
import { Film, ShieldCheck, Zap } from 'lucide-react'
import {
  IMAGE2_CREDITS_PER_IMAGE,
  IMAGE2_MAX_REFERENCES,
  IMAGE2_PROVIDER_DISPLAY_NAME,
} from '@seqora/contracts'
import { ImageResultGallery } from './ImageResultGallery'
import { PromptComposer } from './PromptComposer'
import { ReferenceStrip } from './ReferenceStrip'
import { createImage2Batch, uploadReference } from './image2Client'

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
  const [selectedBatchId, setSelectedBatchId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')

  const availableCredits = availableCreditsForBilling(billing)
  const estimatedCredits = imageCount * IMAGE2_CREDITS_PER_IMAGE
  const batches = useMemo(() => groupImage2Batches(tasks, project?.id), [tasks, project?.id])
  const selectedBatch = batches.find((batch) => batch.batchId === selectedBatchId) ?? batches[0] ?? null
  const providerConfigured = image2ProviderStatus === 'configured'
  const providerStatusMessage = providerConfigured
    ? ''
    : '序幕 image2 服务尚未配置，当前无法提交批次。'

  useEffect(() => {
    if (!selectedBatchId && batches[0]) setSelectedBatchId(batches[0].batchId)
    if (selectedBatchId && !batches.some((batch) => batch.batchId === selectedBatchId)) {
      setSelectedBatchId(batches[0]?.batchId ?? null)
    }
  }, [batches, selectedBatchId])

  const handleUpload = async (file) => {
    if (!project?.id) {
      setMessage('请先选择项目')
      return
    }
    if (references.length >= IMAGE2_MAX_REFERENCES) {
      setMessage(`最多上传 ${IMAGE2_MAX_REFERENCES} 张引用图`)
      return
    }
    setUploading(true)
    setMessage('')
    try {
      const media = await uploadReference(project.id, file)
      setReferences((current) => [
        ...current,
        { mediaId: media.id, url: media.url, role: 'subject' },
      ])
    } catch (error) {
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
    setMessage('')
    try {
      const result = await createImage2Batch({
        clientRequestId: nextClientRequestId(),
        projectId: project.id,
        prompt: cleanPrompt,
        ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
        aspectRatio,
        quality,
        imageCount,
        referenceMediaIds: references.map((reference) => reference.mediaId),
      })
      setSelectedBatchId(result.batchId)
      setMessage(`${result.tasks.length} 张图片已进入队列`)
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

  if (!project) {
    return (
      <section className="tool-studio-frame image-studio-frame image2-workbench" aria-label="序幕 image2 工作台">
        <div className="image2-empty-workspace">
          <Film size={28} />
          <strong>请选择项目</strong>
          <span>序幕 image2 会把批次任务写入当前项目。</span>
        </div>
      </section>
    )
  }

  return (
    <section className="tool-studio-frame image-studio-frame image2-workbench" aria-label="序幕 image2 工作台">
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
          <span className={estimatedCredits > availableCredits ? 'warning' : ''}>本批 {estimatedCredits}</span>
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
          <ImageResultGallery batch={selectedBatch} refreshing={refreshing} onRefresh={handleRefresh} />
        </div>

        <div className="image2-controls-stage">
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
            submitting={submitting}
            disabled={submitting || uploading || !providerConfigured || estimatedCredits > availableCredits}
            error={message || providerStatusMessage}
            onPromptChange={setPrompt}
            onNegativePromptChange={setNegativePrompt}
            onSubmit={handleSubmit}
          />
          <ReferenceStrip
            references={references}
            uploading={uploading}
            disabled={uploading || references.length >= IMAGE2_MAX_REFERENCES}
            onUpload={handleUpload}
            onRemove={(mediaId) => setReferences((current) => current.filter((item) => item.mediaId !== mediaId))}
            onRoleChange={(mediaId, role) =>
              setReferences((current) =>
                current.map((item) => (item.mediaId === mediaId ? { ...item, role } : item)),
              )
            }
          />
        </div>
      </div>
    </section>
  )
}

function availableCreditsForBilling(billing) {
  if (!billing) return 0
  if (billing.billingScope === 'organization') return billing.organizationPool?.credits ?? billing.credits ?? 0
  return billing.credits ?? 0
}

function groupImage2Batches(tasks, projectId) {
  const groups = new Map()
  for (const task of tasks) {
    const batchId = typeof task.metadata?.image2BatchId === 'string' ? task.metadata.image2BatchId : null
    if (!batchId || task.projectId !== projectId) continue
    if (!groups.has(batchId)) groups.set(batchId, [])
    groups.get(batchId).push(task)
  }
  return [...groups.entries()]
    .map(([batchId, batchTasks]) => summarizeBatch(batchId, batchTasks))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

function summarizeBatch(batchId, tasks) {
  const sortedTasks = [...tasks].sort((left, right) => {
    const leftIndex = Number(left.metadata?.batchIndex ?? 0)
    const rightIndex = Number(right.metadata?.batchIndex ?? 0)
    return leftIndex - rightIndex
  })
  const latest = sortedTasks.reduce((current, task) =>
    Date.parse(task.updatedAt) > Date.parse(current.updatedAt) ? task : current,
  )
  const totalCount = Number(sortedTasks[0]?.metadata?.batchSize ?? sortedTasks.length)
  const completedCount = sortedTasks.filter((task) => task.status === 'completed').length
  const runningCount = sortedTasks.filter((task) => task.status === 'running').length
  const queuedCount = sortedTasks.filter((task) => task.status === 'queued' || task.status === 'paused').length
  const failedCount = sortedTasks.filter((task) => task.status === 'failed' || task.status === 'cancelled').length
  return {
    batchId,
    tasks: sortedTasks,
    label: `批次 ${shortBatchId(batchId)}`,
    totalCount,
    completedCount,
    runningCount,
    queuedCount,
    failedCount,
    estimatedCredits: sortedTasks.reduce((total, task) => total + (task.estimatedCredits || 0), 0),
    updatedAt: latest.updatedAt,
  }
}

function shortBatchId(batchId) {
  return batchId.replace(/^image2-/, '').slice(0, 8)
}

function nextClientRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `image2-${Date.now()}`
}
