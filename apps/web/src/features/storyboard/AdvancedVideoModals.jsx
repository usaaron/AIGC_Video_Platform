import { useState } from 'react'
import { Clapperboard, Sparkles, Wand2, X } from 'lucide-react'
import { IconButton } from '../../components/ui'
import {
  ADVANCED_VIDEO_MODES,
  AGENT_FILM_TEMPLATES,
  VIDEO_TEMPLATE_MARKETPLACE,
  advancedVideoModeById,
  agentFilmPlanForProject,
} from './advancedVideoTools'

export function AdvancedVideoModal({ shot, credits = 0, onClose, onSubmit }) {
  const [modeId, setModeId] = useState('video-to-video')
  const [templateId, setTemplateId] = useState('')
  const [sourceVideoUrl, setSourceVideoUrl] = useState('')
  const [sourceImageUrls, setSourceImageUrls] = useState('')
  const [firstFrameUrl, setFirstFrameUrl] = useState(shot.imageUrl || '')
  const [lastFrameUrl, setLastFrameUrl] = useState('')
  const [maskUrl, setMaskUrl] = useState('')
  const [backgroundReferenceUrl, setBackgroundReferenceUrl] = useState('')
  const [lightingPreset, setLightingPreset] = useState('')
  const [upscaleFactor, setUpscaleFactor] = useState('2')
  const [lipSyncAudioUrl, setLipSyncAudioUrl] = useState('')
  const [extendSeconds, setExtendSeconds] = useState('4')
  const mode = advancedVideoModeById(modeId)
  const canSubmit = credits >= mode.estimatedCredits

  const selectTemplate = (template) => {
    setTemplateId(template.id)
    setModeId(template.modeId)
    if (template.metadata?.lightingPreset) setLightingPreset(template.metadata.lightingPreset)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal advanced-video-modal"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          if (!canSubmit) return
          void onSubmit(mode.id, {
            templateId,
            sourceVideoUrl,
            sourceImageUrls,
            firstFrameUrl,
            lastFrameUrl,
            maskUrl,
            backgroundReferenceUrl,
            lightingPreset,
            upscaleFactor,
            lipSyncAudioUrl,
            extendSeconds,
            estimatedCredits: mode.estimatedCredits,
          })
        }}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">高级视频</span>
            <h2>{shot.title}</h2>
          </div>
          <IconButton label="关闭" type="button" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>

        <div className="advanced-mode-grid">
          {ADVANCED_VIDEO_MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={modeId === item.id ? 'active' : ''}
              onClick={() => setModeId(item.id)}
            >
              <span>{item.label}</span>
              <strong>{item.title}</strong>
              <small>{item.description}</small>
            </button>
          ))}
        </div>

        <section className="advanced-video-section">
          <div className="shot-tool-head">
            <div>
              <span>模板市场</span>
              <strong>{templateId || '未选择模板'}</strong>
            </div>
          </div>
          <div className="template-market-grid">
            {VIDEO_TEMPLATE_MARKETPLACE.map((template) => (
              <button
                key={template.id}
                type="button"
                className={templateId === template.id ? 'active' : ''}
                onClick={() => selectTemplate(template)}
              >
                <span>{template.category}</span>
                <strong>{template.title}</strong>
                <small>{template.description}</small>
              </button>
            ))}
          </div>
        </section>

        <div className="advanced-form-grid">
          <label>
            <span>源视频 URL</span>
            <input value={sourceVideoUrl} onChange={(event) => setSourceVideoUrl(event.target.value)} />
          </label>
          <label>
            <span>首帧 URL</span>
            <input value={firstFrameUrl} onChange={(event) => setFirstFrameUrl(event.target.value)} />
          </label>
          <label>
            <span>尾帧 URL</span>
            <input value={lastFrameUrl} onChange={(event) => setLastFrameUrl(event.target.value)} />
          </label>
          <label>
            <span>遮罩 URL</span>
            <input value={maskUrl} onChange={(event) => setMaskUrl(event.target.value)} />
          </label>
          <label>
            <span>背景参考 URL</span>
            <input
              value={backgroundReferenceUrl}
              onChange={(event) => setBackgroundReferenceUrl(event.target.value)}
            />
          </label>
          <label>
            <span>口型音频 URL</span>
            <input value={lipSyncAudioUrl} onChange={(event) => setLipSyncAudioUrl(event.target.value)} />
          </label>
          <label>
            <span>延长秒数</span>
            <input
              type="number"
              min="1"
              max="60"
              value={extendSeconds}
              onChange={(event) => setExtendSeconds(event.target.value)}
            />
          </label>
          <label>
            <span>放大倍率</span>
            <select value={upscaleFactor} onChange={(event) => setUpscaleFactor(event.target.value)}>
              <option value="2">2x</option>
              <option value="4">4x</option>
            </select>
          </label>
          <label>
            <span>灯光预设</span>
            <select value={lightingPreset} onChange={(event) => setLightingPreset(event.target.value)}>
              <option value="">按提示词判断</option>
              <option value="soft-window">柔和窗光</option>
              <option value="studio-softbox">棚拍柔光箱</option>
              <option value="clean-front-key">正面干净主光</option>
              <option value="matched-environment">匹配环境光</option>
            </select>
          </label>
          <label className="advanced-wide-field">
            <span>图片参考 URL（每行一个）</span>
            <textarea value={sourceImageUrls} onChange={(event) => setSourceImageUrls(event.target.value)} />
          </label>
        </div>

        <div className="advanced-budget-row">
          <span>
            当前模式预计 {mode.estimatedCredits} 积分，余额 {credits}。
          </span>
          {!canSubmit && <strong>积分不足</strong>}
        </div>

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit" disabled={!canSubmit}>
            <Clapperboard size={16} /> 提交高级任务
          </button>
        </div>
      </form>
    </div>
  )
}

export function AgentFilmModal({ project, shots, assets, credits = 0, onClose, onSubmit }) {
  const [templateId, setTemplateId] = useState(AGENT_FILM_TEMPLATES[0].id)
  const [isSubmitting, setSubmitting] = useState(false)
  const plan = agentFilmPlanForProject(project, shots, assets, templateId)
  const canSubmit = plan.items.length > 0 && credits >= plan.estimatedCredits

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit(templateId)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal agent-film-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">Agent 整片</span>
            <h2>自动生成整片任务</h2>
          </div>
          <IconButton label="关闭" type="button" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>

        <div className="agent-template-grid">
          {AGENT_FILM_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className={templateId === template.id ? 'active' : ''}
              onClick={() => setTemplateId(template.id)}
            >
              <Wand2 size={16} />
              <strong>{template.title}</strong>
              <small>{template.description}</small>
            </button>
          ))}
        </div>

        <div className="agent-plan-summary">
          <div>
            <span>镜头数</span>
            <strong>{plan.items.length}</strong>
          </div>
          <div>
            <span>预计积分</span>
            <strong>{plan.estimatedCredits}</strong>
          </div>
          <div>
            <span>模板</span>
            <strong>{plan.videoTemplate?.title || '-'}</strong>
          </div>
        </div>

        <div className="agent-plan-list">
          {plan.items.map((item) => (
            <span key={item.shot.id}>
              {String(item.shot.order || 0).padStart(2, '0')} · {item.shot.title} ·{' '}
              {advancedVideoModeById(item.modeId).label}
            </span>
          ))}
        </div>

        <div className="advanced-budget-row">
          <span>
            余额 {credits}，本次最高消耗 {plan.estimatedCredits} 积分。
          </span>
          {!canSubmit && <strong>无法提交</strong>}
        </div>

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            type="button"
            disabled={!canSubmit || isSubmitting}
            onClick={submit}
          >
            <Sparkles size={16} /> {isSubmitting ? '提交中' : '确认提交'}
          </button>
        </div>
      </div>
    </div>
  )
}
