import { Aperture } from 'lucide-react'
import { StudioAtmosphere } from './StudioAtmosphere'

export function StudioAuthScene({
  label = '序幕TV 创作工作台',
  kicker = '序幕TV™ · AI CINEMATIC STUDIO',
  title = (
    <>
      “序幕起，<em>好戏生。</em>”
    </>
  ),
  description,
}) {
  return (
    <section className="login-scene" aria-label={label}>
      <StudioAtmosphere />
      <div className="login-scene-frame" aria-hidden="true">
        <span>01</span>
        <span>序幕TV™ ORIGINALS</span>
      </div>
      <div className="login-brand">
        <span>
          <Aperture size={20} />
        </span>
        <div>
          <strong>
            序幕TV<sup className="login-brand-mark">™</sup>
          </strong>
          <small>序幕TV创作工作台</small>
        </div>
      </div>
      <div className="login-story">
        <span>{kicker}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        <div className="login-story-timeline" aria-hidden="true">
          <i />
          <span>00:00:01</span>
        </div>
      </div>
      <div className="login-scene-footer" aria-hidden="true">
        <span>FRAME 01</span>
        <i />
        <span>24 FPS</span>
      </div>
    </section>
  )
}
