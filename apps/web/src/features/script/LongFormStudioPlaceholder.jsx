import {
  BookOpenText,
  GitBranch,
  Globe2,
  MapPinned,
  Network,
  Sparkles,
  Upload,
  UsersRound,
} from 'lucide-react'

const SOURCE_OPTIONS = [
  { id: 'short-script', label: '同步短剧本', icon: BookOpenText },
  { id: 'idea', label: '故事想法', icon: Sparkles },
  { id: 'novel-excerpt', label: '小说片段', icon: Upload },
]

const DEVELOPMENT_MODULES = [
  { label: '人物卡', description: '身份、欲望、缺陷与成长弧', icon: UsersRound },
  { label: '人物关系', description: '关系强度、秘密与冲突变化', icon: Network },
  { label: '世界观', description: '规则、历史、社会与力量体系', icon: Globe2 },
  { label: '基本设定', description: '题材边界、时代与叙事约束', icon: BookOpenText },
  { label: '地理设定', description: '地点层级、路线与空间关系', icon: MapPinned },
  { label: '分卷分集', description: '主线推进、钩子与回收节点', icon: GitBranch },
]

export function LongFormStudioPlaceholder({
  source,
  value,
  shortScript,
  onSourceChange,
  onChange,
  onSyncShortScript,
}) {
  const placeholder =
    source === 'idea'
      ? '写下核心人物、矛盾、题材和结局方向……'
      : source === 'novel-excerpt'
        ? '粘贴一部分小说内容，后续将提取人物、世界设定和故事主线……'
        : '点击“同步当前短剧本”，以现有内容作为长篇扩写种子。'

  return (
    <section className="long-form-studio" aria-label="长剧本生成建设中">
      <header className="long-form-studio-head">
        <div>
          <span className="long-form-symbol">
            <BookOpenText size={19} />
          </span>
          <div>
            <span className="eyebrow">LONG FORM STUDIO</span>
            <h2>长剧本生成</h2>
          </div>
        </div>
        <span className="development-badge">待开发</span>
      </header>

      <div className="long-form-process" aria-label="长剧本生成流程">
        {['输入创作种子', '生成 3～5 个大纲', '确认大纲', '生成设定模块'].map((label, index) => (
          <div key={label} className={index === 0 ? 'active' : ''}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{label}</strong>
          </div>
        ))}
      </div>

      <div className="long-form-layout">
        <section className="long-form-input-panel">
          <div className="long-form-panel-head">
            <div>
              <span className="eyebrow">创作种子</span>
              <strong>选择内容来源</strong>
            </div>
            <span>{value.replace(/\s/g, '').length.toLocaleString()} 字</span>
          </div>

          <div className="long-form-source-switch" role="group" aria-label="长剧本内容来源">
            {SOURCE_OPTIONS.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                className={source === id ? 'active' : ''}
                aria-pressed={source === id}
                onClick={() => onSourceChange(id)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>

          <textarea
            value={value}
            rows={13}
            maxLength={100_000}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
          />

          <div className="long-form-input-actions">
            <button
              type="button"
              className="button"
              disabled={!shortScript.trim()}
              onClick={onSyncShortScript}
            >
              <BookOpenText size={15} /> 同步当前短剧本
            </button>
            <button
              type="button"
              className="button primary"
              disabled
              title="待开发：接入长篇编剧 Agent 后开放"
            >
              <Sparkles size={15} /> 生成 3～5 个大纲
            </button>
          </div>
        </section>

        <aside className="long-form-module-panel">
          <div className="long-form-panel-head">
            <div>
              <span className="eyebrow">大纲确认后</span>
              <strong>自动建立创作档案</strong>
            </div>
          </div>
          <div className="long-form-module-list">
            {DEVELOPMENT_MODULES.map(({ label, description, icon: Icon }) => (
              <div key={label}>
                <Icon size={16} />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
                <em>待生成</em>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <section className="long-form-outline-stage" aria-label="候选大纲区">
        <div className="long-form-panel-head">
          <div>
            <span className="eyebrow">候选方案</span>
            <strong>用户确认一个大纲后，才进入人物与世界设定</strong>
          </div>
          <span>3～5 个方案</span>
        </div>
        <div className="long-form-outline-slots">
          {['A', 'B', 'C'].map((label) => (
            <div key={label}>
              <span>OUTLINE {label}</span>
              <strong>等待生成</strong>
            </div>
          ))}
        </div>
      </section>
    </section>
  )
}
