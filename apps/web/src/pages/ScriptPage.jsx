import {
  ArrowRight,
  BadgeCheck,
  Clapperboard,
  Clock3,
  Image,
  Save,
  Sparkles,
  Upload,
  UserRound,
} from 'lucide-react'
import { PageHeader } from '../components/ui'

export function ScriptPage({ script, setScript, saved, onSave, onGenerate, onNext }) {
  const count = script.replace(/\s/g, '').length

  return (
    <div className="page editor-page">
      <PageHeader
        eyebrow="第 1 步 · 剧本"
        title="把故事变成可制作的剧本"
        description="直接输入、上传，或让 AI 从一个想法开始扩写。"
      >
        <button className="button secondary">
          <Upload size={16} /> 上传剧本
        </button>
        <button className="button primary" onClick={onGenerate}>
          <Sparkles size={16} /> AI 生成
        </button>
      </PageHeader>
      <div className="script-layout">
        <section className="script-editor">
          <div className="editor-toolbar">
            <div>
              <button className="format-button">场景</button>
              <button className="format-button">角色</button>
              <button className="format-button">对白</button>
            </div>
            <span>
              {saved ? (
                <>
                  <BadgeCheck size={14} /> 已保存
                </>
              ) : (
                '有未保存修改'
              )}
            </span>
          </div>
          <textarea
            value={script}
            onChange={(event) => setScript(event.target.value)}
            placeholder="写下故事内容，或者点击 AI 生成……"
          />
          <div className="editor-footer">
            <span>{count} 字 · 预计 2 分钟</span>
            <button onClick={onSave}>
              <Save size={14} /> 保存剧本
            </button>
          </div>
        </section>
        <aside className="analysis-panel">
          <div className="analysis-head">
            <span className="spark-icon">
              <Sparkles size={17} />
            </span>
            <div>
              <h3>剧本分析</h3>
              <p>随内容自动更新</p>
            </div>
          </div>
          <div className="analysis-score">
            <div>
              <strong>86</strong>
              <span>完整度</span>
            </div>
            <div className="score-ring" />
          </div>
          <div className="analysis-list">
            <div>
              <span>
                <UserRound size={15} /> 主要角色
              </span>
              <strong>2 人</strong>
            </div>
            <div>
              <span>
                <Image size={15} /> 场景
              </span>
              <strong>2 个</strong>
            </div>
            <div>
              <span>
                <Clapperboard size={15} /> 建议镜头
              </span>
              <strong>5 个</strong>
            </div>
            <div>
              <span>
                <Clock3 size={15} /> 预计时长
              </span>
              <strong>2 分钟</strong>
            </div>
          </div>
          <div className="tip-box">
            <Sparkles size={15} />
            <p>故事钩子清晰。可以补充林夏父亲失踪的细节，加强人物动机。</p>
          </div>
        </aside>
      </div>
      <div className="sticky-actions">
        <span>下一步将自动识别剧本中的人物、场景与道具。</span>
        <button className="button primary" onClick={onNext}>
          提取角色资产 <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}
