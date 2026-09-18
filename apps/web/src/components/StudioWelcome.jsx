import { ArrowRight, ArrowUpRight, BookOpenText, ImagePlus, PackageOpen, Plus } from 'lucide-react'
import { StudioAtmosphere } from './StudioAtmosphere'

export function StudioWelcome({ empty = false, onCreate, onContinue, onNavigate }) {
  return (
    <>
      <section className="studio-hero" aria-label={empty ? '新项目欢迎页' : '创作工作台'}>
        <div className="studio-hero-copy">
          <span className="studio-kicker">
            <i /> {empty ? '欢迎来到序幕 TV' : '序幕 · 你的电影创作空间'}
          </span>
          <h1>
            每一个想象，
            <br />
            <em>都值得上场。</em>
          </h1>
          <p>
            写下故事，定义角色，把每一幕变成画面。
            <br />
            从第一个灵感，到属于你的作品。
          </p>
          <div className="studio-hero-actions">
            <button className="button primary" onClick={onCreate}>
              <Plus size={18} />
              {empty ? '创建第一个项目' : '开始新创作'}
              <ArrowRight size={17} />
            </button>
            {onContinue && (
              <button className="studio-text-action" onClick={onContinue}>
                继续最近项目 <ArrowUpRight size={16} />
              </button>
            )}
          </div>
          <span className="studio-hero-footnote">
            “序幕起，好戏生。” <i /> YOUR STORY STARTS HERE
          </span>
        </div>
        <StudioAtmosphere />
      </section>
      {onNavigate && (
        <nav className="studio-launchers" aria-label="创作工具">
          {[
            {
              id: 'writing-studio',
              icon: BookOpenText,
              label: '网剧创作',
              hint: '从灵感到长篇故事',
              detail: '构思世界、规划分集、打磨剧本',
              tone: 'silver',
            },
            {
              id: 'image-studio',
              icon: ImagePlus,
              label: '生图大师',
              hint: '让想象先有模样',
              detail: '输入描述或参考图，探索视觉风格',
              tone: 'gold',
            },
            {
              id: 'library',
              icon: PackageOpen,
              label: '资产库',
              hint: '让好素材再次发光',
              detail: '管理图片、剧本和提示词模板',
              tone: 'blue',
            },
          ].map(({ id, icon: Icon, label, hint, detail, tone }) => (
            <button
              key={id}
              className={`studio-launcher ${tone}`}
              onClick={() => (id === 'writing-studio' ? onCreate() : onNavigate(id))}
            >
              <span className="studio-launcher-icon">
                <Icon size={22} strokeWidth={1.5} />
              </span>
              <span>
                <small>{hint}</small>
                <strong>{label}</strong>
                <span>{detail}</span>
              </span>
              <ArrowUpRight size={18} className="studio-launcher-arrow" />
            </button>
          ))}
        </nav>
      )}
    </>
  )
}
