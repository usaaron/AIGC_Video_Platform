import './promptDimensionGuides.css'

const STYLE_DIMENSIONS = [
  { label: '艺术流派', items: ['古典', '近代', '现代', '当代', '装饰'] },
  { label: '表现媒介', items: ['油画', '水彩', '素描', '版画', '数字', '特殊'] },
  { label: '视觉类型', items: ['摄影', '影视', '插画', '动漫', '3D', '实验'] },
  { label: '美学主题', items: ['科幻', '复古', '自然', '暗黑', '国潮', '建筑'] },
  { label: '情感调性', items: ['轻盈', '沉重', '强烈', '柔和', '奇异'] },
]

const COMPOSITION_DIMENSIONS = [
  {
    label: '画幅比例',
    items: [
      { label: '1:1', note: '方形' },
      { label: '3:4', note: '竖版' },
      { label: '4:3', note: '横版' },
      { label: '16:9', note: '电影' },
      { label: '9:16', note: '竖屏' },
      { label: '2.35:1', note: '宽银幕' },
      { label: '21:9', note: '超宽' },
    ],
  },
  {
    label: '景别',
    items: [
      { label: '极远景', note: '环境为主' },
      { label: '远景', note: '展现场景' },
      { label: '全景', note: '人物与环境' },
      { label: '中景', note: '人物为主' },
      { label: '近景', note: '情感表达' },
      { label: '特写', note: '突出细节' },
      { label: '大特写', note: '极致细节' },
    ],
  },
  {
    label: '视角',
    items: [
      { label: '平视', note: '平等中性' },
      { label: '俯视', note: '掌控感' },
      { label: '仰视', note: '崇高感' },
      { label: '鸟瞰', note: '全局视野' },
      { label: '虫视', note: '微观视角' },
      { label: '荷兰角', note: '不稳定感' },
      { label: '第一人称', note: '沉浸代入' },
    ],
  },
  {
    label: '构图法则',
    items: [
      { label: '中心构图', note: '突出主体' },
      { label: '三分法', note: '平衡和谐' },
      { label: '对称构图', note: '稳定庄重' },
      { label: '引导线', note: '引导视线' },
      { label: '框架构图', note: '增强层次' },
      { label: '留白构图', note: '意境氛围' },
      { label: '填充构图', note: '饱满冲击' },
      { label: '重复构图', note: '节奏韵律' },
      { label: '黄金螺旋', note: '自然美感' },
    ],
  },
]

const LIGHTING_DIMENSIONS = [
  {
    label: '光源类型',
    items: [
      { label: '自然光', note: '决定基调' },
      { label: '人工光', note: '可控塑形' },
      { label: '环境光', note: '融入空间' },
      { label: '特殊光', note: '制造记忆点' },
    ],
  },
  {
    label: '光照方向',
    items: [
      { label: '正面', note: '清晰直观' },
      { label: '侧面', note: '层次更强' },
      { label: '逆光', note: '轮廓突出' },
      { label: '顶光', note: '压迫感' },
      { label: '底光', note: '戏剧化' },
      { label: '环绕光', note: '包裹主体' },
    ],
  },
  {
    label: '光线质量',
    items: [
      { label: '硬光', note: '边界明确' },
      { label: '软光', note: '柔和稳定' },
      { label: '体积光', note: '空气层次' },
      { label: '反射光', note: '材质反馈' },
      { label: '折射光', note: '透明质感' },
    ],
  },
  {
    label: '光影氛围',
    items: [
      { label: '明亮通透', note: '轻盈干净' },
      { label: '明暗对比', note: '情绪张力' },
      { label: '低调暗调', note: '神秘压抑' },
      { label: '色彩光', note: '风格强化' },
      { label: '动态光', note: '速度故事' },
    ],
  },
]

const STYLE_ALIASES = {
  电影感: ['影视'],
  '影视 CG风格': ['影视', '3D'],
  '3D 国漫风格': ['3D', '动漫', '国潮'],
  '2D 国漫风格': ['动漫', '国潮', '插画'],
  日漫风格: ['动漫'],
  绘本风格: ['插画', '柔和'],
  仿真人风格: ['摄影', '自然'],
}

const COMPOSITION_ALIASES = {
  头肩构图: ['近景'],
  全身: ['全景'],
  半身: ['中景'],
  头像: ['近景'],
  平视镜头: ['平视'],
  航拍: ['鸟瞰'],
  广角: ['远景'],
  居中: ['中心构图'],
  三分: ['三分法'],
  对称: ['对称构图'],
  画面比例: [],
}

const LIGHTING_ALIASES = {
  自然日光: ['自然光', '明亮通透'],
  黄金时刻: ['自然光', '明亮通透'],
  均匀柔光: ['软光', '正面'],
  柔光: ['软光'],
  柔和补光: ['人工光', '软光'],
  棚拍: ['人工光', '软光'],
  夜景光线: ['环境光', '低调暗调'],
  霓虹: ['环境光', '色彩光'],
  侧光: ['侧面'],
  侧逆光: ['侧面', '逆光'],
  逆光: ['逆光'],
  顶光: ['顶光'],
  底光: ['底光'],
  环境反射: ['环境光', '反射光'],
  雨面反光: ['反射光'],
  反光: ['反射光'],
  折射: ['折射光'],
  雾气散射光: ['环境光', '软光', '体积光'],
  局部高光: ['明暗对比'],
  低阴影: ['软光'],
  统一光线: ['软光'],
}

const DIMENSION_GUIDES = [
  {
    key: 'style',
    className: 'style-guide',
    number: '01',
    title: '风格',
    subtitle: '5维定义画面艺术调性',
    dimensions: STYLE_DIMENSIONS,
    aliases: STYLE_ALIASES,
    slogan: '风格是定调第一步',
    ariaLabel: '风格五维速查',
  },
  {
    key: 'composition',
    className: 'composition-guide',
    number: '02',
    title: '构图',
    subtitle: '4维构建画面空间结构',
    dimensions: COMPOSITION_DIMENSIONS,
    aliases: COMPOSITION_ALIASES,
    slogan: '构图是画面骨架',
    ariaLabel: '构图四维速查',
  },
  {
    key: 'lighting',
    className: 'lighting-guide',
    number: '06',
    title: '光影',
    subtitle: '4维塑造画面立体感与氛围',
    dimensions: LIGHTING_DIMENSIONS,
    aliases: LIGHTING_ALIASES,
    slogan: '光影是灵魂',
    ariaLabel: '光影四维速查',
  },
]

export function PromptDimensionGuides({ sections }) {
  const valuesByKey = new Map(sections.map((section) => [section.key, section.value || '']))
  return (
    <div className="dimension-guide-stack">
      {DIMENSION_GUIDES.map((guide) => (
        <DimensionGuide activeValue={valuesByKey.get(guide.key) || ''} guide={guide} key={guide.key} />
      ))}
    </div>
  )
}

function DimensionGuide({ activeValue, guide }) {
  const activeTerms = getActiveTerms(activeValue, guide)
  return (
    <div className={`dimension-guide ${guide.className}`} aria-label={guide.ariaLabel}>
      <div className="dimension-guide-head">
        <span>
          {guide.number} {guide.title}
        </span>
        <strong>{guide.subtitle}</strong>
      </div>
      <div className="dimension-guide-grid">
        {guide.dimensions.map((dimension, index) => (
          <div className="dimension-column" key={dimension.label}>
            <strong className="dimension-column-title">
              <small>{index + 1}</small>
              {dimension.label}
            </strong>
            <div className="dimension-options">
              {dimension.items.map((item) => {
                const label = getItemLabel(item)
                return (
                  <span
                    className={activeTerms.has(label) ? 'dimension-option active' : 'dimension-option'}
                    key={label}
                  >
                    <span className="dimension-item-label">{label}</span>
                    {typeof item === 'object' && item.note && <small>{item.note}</small>}
                  </span>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <p>{guide.slogan}</p>
    </div>
  )
}

function getActiveTerms(activeValue, guide) {
  const terms = new Set()
  Object.entries(guide.aliases).forEach(([keyword, aliases]) => {
    if (activeValue.includes(keyword)) aliases.forEach((alias) => terms.add(alias))
  })
  guide.dimensions.forEach((dimension) => {
    dimension.items.forEach((item) => {
      const label = getItemLabel(item)
      if (activeValue.includes(label)) terms.add(label)
    })
  })
  return terms
}

function getItemLabel(item) {
  return typeof item === 'string' ? item : item.label
}
