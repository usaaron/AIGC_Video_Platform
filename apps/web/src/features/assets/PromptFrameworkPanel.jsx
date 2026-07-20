import { Activity, BadgeCheck, Boxes, Check, Copy, Search, Sparkles, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { IconButton } from '../../components/ui'
import { PromptDimensionGuides } from './PromptDimensionGuides'
import { QUALITY_GROUPS } from './promptCompiler'
import './promptFramework.css'

const IMAGE_FRAMEWORK_META = {
  style: {
    icon: Sparkles,
    example: '从艺术流派、表现媒介、视觉类型、美学主题、情感调性五维定调',
  },
  composition: {
    icon: Search,
    example: '从画幅比例、景别、视角、构图法则四维搭建画面骨架',
  },
  subject: {
    icon: UsersRound,
    example: '如：人物、动物、建筑、物品数量、外观、服饰、颜色',
  },
  action: {
    icon: Activity,
    example: '如：站立、奔跑、跳跃、凝视、挥手、战斗、舞蹈、思考',
  },
  scene: {
    icon: Boxes,
    example: '如：城市、森林、海边、室内、未来世界、古代街道、宇宙',
  },
  lighting: {
    icon: Sparkles,
    example: '从光源类型、光照方向、光线质量、光影氛围四维塑造立体感',
  },
  detail: {
    icon: Search,
    example: '如：服装纹理、物体材质、背景元素、道具、环境细节',
  },
  quality: {
    icon: BadgeCheck,
    example: '如：高分辨率、超清、精细、8K、杰作、专业摄影、RAW',
  },
}

const AUDIO_FRAMEWORK_META = {
  style: { icon: Sparkles, example: '如：配乐、环境音、人声、音效、氛围铺底' },
  composition: { icon: Search, example: '如：10 秒、30 秒、可循环、干净收尾' },
  subject: { icon: UsersRound, example: '如：女声旁白、雨声、脚步声、城市环境音' },
  action: { icon: Activity, example: '如：平静、紧张、递进、爆发、渐弱' },
  scene: { icon: Boxes, example: '如：中文、英文、室内、街道、远景空间' },
  lighting: { icon: Sparkles, example: '如：温暖、低沉、清亮、颗粒感、广播质感' },
  detail: { icon: Search, example: '如：无底噪、首尾自然、不要人声、保留空间感' },
  quality: { icon: BadgeCheck, example: '如：音质清晰、层次稳定、无明显底噪' },
}

export function PromptFrameworkPanel({ blueprint }) {
  const [copyState, setCopyState] = useState('')
  const activeTerms = new Set([...blueprint.qualityTerms, ...blueprint.negativeTerms])
  const isAudio = blueprint.formula[0] === '类型'
  const frameworkMeta = isAudio ? AUDIO_FRAMEWORK_META : IMAGE_FRAMEWORK_META

  const copyPrompt = () => {
    if (!navigator.clipboard) {
      setCopyState('当前浏览器不支持复制')
      return
    }
    void navigator.clipboard
      .writeText(blueprint.finalPrompt)
      .then(() => setCopyState('已复制'))
      .catch(() => setCopyState('复制失败'))
  }

  return (
    <section className="prompt-framework" aria-label="提示词结构">
      <div className="framework-head">
        <div className="framework-title">
          <span>
            <Sparkles size={15} />
            提示词万能框架
          </span>
          <h3>{isAudio ? 'AI 音频提示词结构' : 'AI 生图提示词万能框架'}</h3>
          <p>{isAudio ? '用结构化声音描述稳定输出音频资产。' : '掌握结构化提示词，让 AI 精准懂你所想。'}</p>
        </div>
        <IconButton label="复制提示词" className="framework-copy" type="button" onClick={copyPrompt}>
          <Copy size={15} />
        </IconButton>
      </div>
      {copyState && <span className="framework-copy-state">{copyState}</span>}

      <div className="formula-panel">
        <span>提示词公式</span>
        <div className="formula-strip" aria-label={blueprint.formula.join(' + ')}>
          {blueprint.formula.map((label, index) => (
            <strong key={label}>
              {label}
              {index < blueprint.formula.length - 1 && <small>+</small>}
            </strong>
          ))}
        </div>
        <p>{isAudio ? '类型清楚、情绪明确、声音细节可执行。' : '结构清晰、要素完整、表达精准、画面出色。'}</p>
      </div>

      {!isAudio && <PromptDimensionGuides sections={blueprint.sections} />}

      <div className="framework-grid">
        {blueprint.sections.map((section) => (
          <article className="framework-card" key={section.key}>
            <FrameworkCardHead meta={frameworkMeta[section.key]} section={section} />
            <p>{section.hint}</p>
            <small>{frameworkMeta[section.key]?.example}</small>
            <b>{section.value || '待补充'}</b>
          </article>
        ))}
      </div>

      <div className="quality-lookup">
        <div className="quality-lookup-head">
          <strong>质量词速查区</strong>
          <span>{blueprint.negativeTerms.length} 个负面词建议</span>
        </div>
        <div className="quality-group-grid">
          {QUALITY_GROUPS.map((group) => (
            <div className="quality-group" key={group.key}>
              <strong>{group.label}</strong>
              <div>
                {group.items.map((item) => {
                  const active =
                    activeTerms.has(item) ||
                    blueprint.finalPrompt.includes(item) ||
                    blueprint.suggestedNegativePrompt.includes(item)
                  return (
                    <span className={active ? 'active' : ''} key={item}>
                      {active && <Check size={10} />}
                      {item}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="negative-suggestion">
          <strong>建议负面提示词</strong>
          <p>{blueprint.suggestedNegativePrompt}</p>
        </div>
      </div>
    </section>
  )
}

function FrameworkCardHead({ meta, section }) {
  const Icon = meta?.icon || Sparkles
  return (
    <div className="framework-card-head">
      <span>{section.index}</span>
      <strong>{section.label}</strong>
      <Icon size={16} />
    </div>
  )
}
