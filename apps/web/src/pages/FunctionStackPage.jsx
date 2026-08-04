import {
  ArrowUp,
  BookOpenText,
  Check,
  ChevronRight,
  CircleDashed,
  Clock3,
  FileText,
  ImagePlus,
  Layers3,
  MessageSquareText,
  Mic2,
  Palette,
  Plus,
  Settings2,
  Sparkles,
  UsersRound,
  WandSparkles,
} from 'lucide-react'
import { BrandMark } from '../components/BrandMark'
import { PageHeader } from '../components/ui'
import { FUNCTION_STACK_ITEMS } from '../features/functionStack/config'

export function FunctionStackPage({ tool }) {
  const item = FUNCTION_STACK_ITEMS.find((entry) => entry.id === tool) ?? FUNCTION_STACK_ITEMS[0]

  return (
    <div className={`page tool-studio-page ${item.id}`}>
      <PageHeader eyebrow={item.eyebrow} title={item.title} description={item.description}>
        <span className="tool-development-badge">
          <CircleDashed size={13} /> UI 预览 · 开发中
        </span>
      </PageHeader>
      {item.id === 'agent-studio' ? <AgentStudio /> : null}
      {item.id === 'image-studio' ? <ImageStudio /> : null}
      {item.id === 'writing-studio' ? <WritingStudio /> : null}
    </div>
  )
}

function AgentStudio() {
  return (
    <section className="tool-studio-frame agent-studio-frame" aria-label="一句成片 Agent 预览">
      <header className="tool-frame-header">
        <div className="tool-frame-identity">
          <BrandMark size={18} spin />
          <div>
            <strong>序幕TV Director</strong>
            <span>多阶段创作编排</span>
          </div>
        </div>
        <div className="tool-frame-status">
          <i /> 方案待确认
        </div>
      </header>
      <div className="agent-studio-layout">
        <aside className="agent-run-rail">
          <span className="tool-section-label">本次生产链路</span>
          {[
            ['创作理解', '完成', Check],
            ['故事规划', '准备中', WandSparkles],
            ['资产规划', '待执行', UsersRound],
            ['分镜导演', '待执行', Layers3],
            ['生成与成片', '待执行', Clock3],
          ].map(([label, state, Icon], index) => (
            <div className={`agent-run-step ${index === 1 ? 'active' : ''}`} key={label}>
              <span>
                <Icon size={14} />
              </span>
              <div>
                <strong>{label}</strong>
                <small>{state}</small>
              </div>
            </div>
          ))}
          <div className="agent-run-estimate">
            <span>预计产出</span>
            <strong>60 秒 · 9:16</strong>
            <small>约 14 个镜头 / 22 分钟</small>
          </div>
        </aside>
        <div className="agent-conversation">
          <div className="agent-conversation-date">
            <span>创作会话 001</span>
            <i />
            <span>今天</span>
          </div>
          <article className="agent-message user">
            <span>你</span>
            <p>
              帮我制作一支 60 秒的赛博悬疑短片。女主在停运车站醒来，发现每块屏幕都在播放她五分钟后的画面。
            </p>
          </article>
          <article className="agent-message system">
            <span>
              <BrandMark size={14} />
            </span>
            <div>
              <strong>已建立制作方案</strong>
              <p>竖屏短片，冷静克制的近未来质感。以“提前五分钟的影像”为核心悬念，结尾完成第一次反转。</p>
              <div className="agent-plan-strip">
                {['5 场剧情', '3 个核心资产', '14 个镜头', '尾帧承接'].map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </div>
          </article>
          <div className="agent-thinking-line">
            <span /> 正在整理可确认的故事大纲
          </div>
          <div className="agent-composer">
            <Plus size={17} />
            <textarea aria-label="创作要求" placeholder="继续描述时长、人物、风格或参考内容..." readOnly />
            <button type="button" disabled aria-label="发送创作要求" title="功能开发中">
              <ArrowUp size={17} />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function ImageStudio() {
  const references = [
    ['/demo/room.jpg', '暖光书房', '场景'],
    ['/demo/station.jpg', '霓虹街区', '场景'],
    ['/demo/rain.jpg', '荒漠公路', '视觉'],
  ]

  return (
    <section className="tool-studio-frame image-studio-frame" aria-label="图片大师预览">
      <header className="tool-frame-header">
        <div className="tool-frame-identity">
          <span className="tool-frame-mark">
            <ImagePlus size={18} />
          </span>
          <div>
            <strong>新建视觉任务</strong>
            <span>人物 · 场景 · 物品 · 参考图</span>
          </div>
        </div>
        <div className="tool-frame-status muted">未保存草稿</div>
      </header>
      <div className="image-studio-layout">
        <aside className="image-control-rail">
          <span className="tool-section-label">生成类型</span>
          <div className="image-mode-list">
            {[
              ['人物设定', UsersRound],
              ['场景概念', Palette],
              ['物品设计', Sparkles],
            ].map(([label, Icon], index) => (
              <button type="button" className={index === 0 ? 'active' : ''} key={label} disabled>
                <Icon size={15} /> {label} <ChevronRight size={14} />
              </button>
            ))}
          </div>
          <span className="tool-section-label">输出设置</span>
          <dl className="image-output-settings">
            <div>
              <dt>模型</dt>
              <dd>Nano Banana</dd>
            </div>
            <div>
              <dt>比例</dt>
              <dd>1:1</dd>
            </div>
            <div>
              <dt>数量</dt>
              <dd>4 张</dd>
            </div>
          </dl>
          <button className="tool-settings-button" type="button" disabled>
            <Settings2 size={15} /> 高级设置
          </button>
        </aside>
        <div className="image-studio-canvas">
          <div className="image-prompt-line">
            <MessageSquareText size={17} />
            <span>年轻女性调查员，冷静神情，影视 CG 角色设定，透明背景，均匀平光...</span>
            <button type="button" disabled>
              生成
            </button>
          </div>
          <div className="image-reference-grid">
            {references.map(([src, label, type]) => (
              <figure key={label}>
                <img src={src} alt={label} />
                <figcaption>
                  <span>{type}</span>
                  <strong>{label}</strong>
                </figcaption>
              </figure>
            ))}
            <div className="image-reference-empty">
              <ImagePlus size={22} />
              <span>新结果</span>
            </div>
          </div>
          <footer className="image-canvas-footer">
            <span>参考图不会自动写入项目资产</span>
            <strong>0 / 4 正在生成</strong>
          </footer>
        </div>
      </div>
    </section>
  )
}

function WritingStudio() {
  return (
    <section className="tool-studio-frame writing-studio-frame" aria-label="剧本大师预览">
      <header className="tool-frame-header">
        <div className="tool-frame-identity">
          <span className="tool-frame-mark">
            <BookOpenText size={18} />
          </span>
          <div>
            <strong>长篇项目 · 未命名</strong>
            <span>世界观与分集规划</span>
          </div>
        </div>
        <div className="tool-frame-status writing-studio-live">
          <i /> 结构草稿 · 自动保存
        </div>
      </header>
      <div className="writing-studio-progress" aria-label="剧本大师工作流预览">
        <div className="active">
          <span>01</span>
          <strong>输入种子</strong>
          <small>当前阶段</small>
        </div>
        <div>
          <span>02</span>
          <strong>大纲候选</strong>
          <small>等待确认</small>
        </div>
        <div>
          <span>03</span>
          <strong>设定档案</strong>
          <small>确认后生成</small>
        </div>
        <div>
          <span>04</span>
          <strong>分集规划</strong>
          <small>长剧本输出</small>
        </div>
      </div>
      <div className="writing-studio-layout">
        <aside className="writing-module-rail">
          <span className="tool-section-label">故事资料库</span>
          {[
            ['故事总纲', FileText, '01'],
            ['人物关系', UsersRound, '08'],
            ['世界设定', Sparkles, '12'],
            ['分集大纲', Layers3, '60'],
            ['对白素材', Mic2, '24'],
          ].map(([label, Icon, count], index) => (
            <button type="button" className={index === 0 ? 'active' : ''} key={label} disabled>
              <Icon size={15} />
              <span>{label}</span>
              <small>{count}</small>
            </button>
          ))}
        </aside>
        <article className="writing-document">
          <header>
            <span>STORY BIBLE / V0.1</span>
            <strong>《倒计时车站》故事总纲</strong>
            <small>1,284 字 · 最后编辑于 2 分钟前</small>
          </header>
          <div className="writing-document-body">
            <h2>核心命题</h2>
            <p>当一个人提前看见自己的选择，她是在改变未来，还是正在完成未来？</p>
            <h2>第一幕 · 失序</h2>
            <p>
              调查员岚星在停运车站醒来。站内所有屏幕比现实快五分钟，画面中的她正沿着一条从未走过的通道奔跑。
            </p>
            <h2>人物动力</h2>
            <p>岚星必须在列车重新启动前找到屏幕信号源，同时确认画面里不断接近她的人究竟是谁。</p>
            <span className="writing-cursor" aria-hidden="true" />
          </div>
        </article>
        <aside className="writing-insight-rail">
          <span className="tool-section-label">结构检查</span>
          <div className="writing-score">
            <strong>82</strong>
            <span>叙事完整度</span>
          </div>
          {[
            ['核心冲突', '明确', true],
            ['人物目标', '明确', true],
            ['中段升级', '待补充', false],
            ['结尾钩子', '已建立', true],
          ].map(([label, state, ready]) => (
            <div className="writing-check" key={label}>
              <span className={ready ? 'ready' : ''}>
                {ready ? <Check size={11} /> : <CircleDashed size={11} />}
              </span>
              <div>
                <strong>{label}</strong>
                <small>{state}</small>
              </div>
            </div>
          ))}
          <button type="button" disabled>
            <Sparkles size={14} /> 深度分析
          </button>
        </aside>
      </div>
    </section>
  )
}
