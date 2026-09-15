import { SCRIPT_OPERATION_CREDITS, episodePlanSchema, suggestEpisodePlan } from '@seqora/contracts'
import './episodePlan.css'
import { useEffect, useRef } from 'react'

export function EpisodePlanEditor({ plan, onChange, onCancel, onConfirm, busy }) {
  const valid = episodePlanSchema.safeParse(plan).success
  const panel = useRef(null)
  useEffect(() => {
    panel.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    panel.current?.focus({ preventScroll: true })
  }, [])
  return (
    <section ref={panel} tabIndex={-1} className="episode-plan-editor" aria-label="分集计划">
      <header>
        <div>
          <span className="eyebrow">先确认，再生成</span>
          <h2>将素材改编成多集网剧</h2>
          <p>{plan.reason}。你可以调整集数与每集内容；原稿会保留在编辑区。</p>
        </div>
        <label>
          计划集数（调整后重新分配原稿）{' '}
          <input
            type="number"
            min="2"
            max="100"
            value={plan.episodes.length}
            onChange={(event) => {
              const count = Number(event.target.value)
              if (count >= 2 && count <= 100)
                onChange({
                  ...plan,
                  episodes: suggestEpisodePlan(plan.original, plan.seconds, count).episodes.map(
                    (episode, index) => ({ ...episode, title: `第 ${(plan.startNumber || 1) + index} 集` }),
                  ),
                })
            }}
          />
        </label>
      </header>
      <p>
        按顺序扩写，自动衔接前集结尾。每集 {SCRIPT_OPERATION_CREDITS.generate} 积分，预计共{' '}
        {plan.episodes.length * SCRIPT_OPERATION_CREDITS.generate} 积分；失败保留已完成集，重试时跳过。
      </p>
      <div className="episode-plan-list">
        {plan.episodes.map((episode, index) => (
          <label key={index}>
            <input
              aria-label={`第${index + 1}集标题`}
              maxLength={120}
              value={episode.title}
              onChange={(event) =>
                onChange({
                  ...plan,
                  episodes: plan.episodes.map((item, i) =>
                    i === index ? { ...item, title: event.target.value } : item,
                  ),
                })
              }
            />
            <textarea
              aria-label={`第${index + 1}集素材`}
              rows={5}
              maxLength={10_000}
              value={episode.source}
              onChange={(event) =>
                onChange({
                  ...plan,
                  episodes: plan.episodes.map((item, i) =>
                    i === index ? { ...item, source: event.target.value } : item,
                  ),
                })
              }
            />
          </label>
        ))}
      </div>
      {!valid && <p role="alert">请填写每集标题和素材；单集素材最多 1 万字，总量最多 10 万字。</p>}
      <footer>
        <button className="button secondary" disabled={busy} onClick={onCancel}>
          返回修改原稿
        </button>
        <button className="button primary" disabled={busy || !valid} onClick={onConfirm}>
          {busy ? '正在提交' : `确认并生成 ${plan.episodes.length} 集`}
        </button>
      </footer>
    </section>
  )
}
