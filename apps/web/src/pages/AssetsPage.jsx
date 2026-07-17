import {
  ArrowRight,
  BadgeCheck,
  Check,
  Gauge,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { IconButton, PageHeader } from '../components/ui'
import { DEMO_CHARACTERS, DEMO_SCENES } from '../data/demoData'

export function AssetsPage({ tab, setTab, member, onGenerateAll, onGenerate, onNext }) {
  const assets = tab === 'characters' ? DEMO_CHARACTERS : DEMO_SCENES

  return (
    <div className="page">
      <PageHeader
        eyebrow="第 2 步 · 角色资产"
        title="让角色与世界保持一致"
        description="资产会在后续每个分镜中复用，先确认再继续。"
      >
        <button className="button secondary">
          <Plus size={16} /> 手动添加
        </button>
        <button className="button primary" onClick={onGenerateAll}>
          <Sparkles size={16} /> {member ? '全部并发生成' : '生成下一个'}
        </button>
      </PageHeader>
      <div className="asset-tabs">
        <button className={tab === 'characters' ? 'active' : ''} onClick={() => setTab('characters')}>
          人物 <span>2</span>
        </button>
        <button className={tab === 'scenes' ? 'active' : ''} onClick={() => setTab('scenes')}>
          场景 <span>2</span>
        </button>
        <button disabled>
          道具 <span>1</span>
        </button>
      </div>
      <div className="asset-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input placeholder="搜索资产" />
        </div>
        <div className="generation-note">
          <Gauge size={15} /> {member ? '会员模式：最多同时生成 3 项' : '免费模式：完成一项后才能生成下一项'}
        </div>
      </div>
      <div className="asset-grid">
        {assets.map((asset) => (
          <article className="asset-card" key={asset.id}>
            <div className="asset-image">
              <img src={asset.image} alt={asset.name} />
              <span>{asset.status || asset.type}</span>
              <IconButton label="更多操作">
                <MoreHorizontal size={18} />
              </IconButton>
            </div>
            <div className="asset-body">
              <div className="asset-title">
                <div>
                  <h3>{asset.name}</h3>
                  <p>{asset.role || asset.type}</p>
                </div>
                <span className="asset-check">
                  <Check size={13} />
                </span>
              </div>
              <label>生成提示词</label>
              <p className="prompt-text">{asset.prompt}</p>
              <div className="asset-actions">
                <button onClick={() => onGenerate(asset.name)}>
                  <RefreshCw size={14} /> 重新生成
                </button>
                <button>编辑</button>
              </div>
            </div>
          </article>
        ))}
        <button className="add-asset">
          <span>
            <Plus size={21} />
          </span>
          <strong>添加{tab === 'characters' ? '人物' : '场景'}</strong>
          <small>上传图片或 AI 生成</small>
        </button>
      </div>
      <div className="sticky-actions">
        <span>
          <BadgeCheck size={15} /> 已确认 3 项资产，还有 1 项待确认。
        </span>
        <button className="button primary" onClick={onNext}>
          进入分镜设计 <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}
