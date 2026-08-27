import type { AdminComplianceRiskCategory, AdminComplianceSeverity } from '@seqora/contracts'

export type ComplianceRiskTermGroup = {
  severity: AdminComplianceSeverity
  reason: string
  terms: string[]
  requiresAny?: string[]
  excludeNear?: string[]
  window?: number
}

export type ComplianceRiskRule = {
  category: AdminComplianceRiskCategory
  label: string
  defaultSeverity: AdminComplianceSeverity
  groups: ComplianceRiskTermGroup[]
}

export type ComplianceRiskPolicyProfile = {
  id: string
  label: string
  reason: string
  projectContentTypes?: string[]
  contextTerms?: string[]
  categoryThresholds: Partial<Record<AdminComplianceRiskCategory, AdminComplianceSeverity>>
}

export const complianceRiskPolicyProfiles: ComplianceRiskPolicyProfile[] = [
  {
    id: 'film-production',
    label: '影视创作语境',
    reason:
      '项目或提示词处于影视剧本、分镜、镜头、道具或特效创作语境，低/中风险描述先降噪，明确高危仍保留审查。',
    projectContentTypes: ['short-drama', 'animation'],
    contextTerms: [
      '影视剧本',
      '短剧剧本',
      '剧本',
      '分镜',
      '镜头',
      '场景',
      '角色',
      '道具',
      '特效',
      '拍摄',
      '剪辑',
    ],
    categoryThresholds: {
      graphic_violence: 'high',
      sexual_content: 'medium',
      terrorism: 'high',
      self_harm: 'high',
    },
  },
  {
    id: 'historical-documentary',
    label: '历史纪录片语境',
    reason: '提示词处于历史纪录片、史料、博物馆或中立讲解语境，历史名词和事件描述按更高阈值上报。',
    contextTerms: [
      '历史纪录片',
      '纪录片',
      '史料',
      '历史研究',
      '历史教材',
      '博物馆',
      '二战',
      '反法西斯',
      '中立讲解',
      '中立报道',
    ],
    categoryThresholds: {
      political_sensitive: 'high',
      extremism: 'high',
      graphic_violence: 'high',
    },
  },
  {
    id: 'medical-education',
    label: '医学科普语境',
    reason: '提示词处于医学科普、临床教学、急救或病理讲解语境，医学伤情描述按更高阈值上报。',
    contextTerms: [
      '医学科普',
      '医学教学',
      '临床教学',
      '急救科普',
      '手术教学',
      '解剖学',
      '病理',
      '医学院',
      '康复训练',
      '安全教育',
    ],
    categoryThresholds: {
      graphic_violence: 'high',
      self_harm: 'critical',
    },
  },
]

export const complianceHumanBodyContextTerms = [
  '人体',
  '身体',
  '皮肤',
  '肌肤',
  '胸部',
  '乳房',
  '臀部',
  '大腿',
  '腿部',
  '肩膀',
  '腰部',
  '腹部',
  '胸',
  '臀',
  '腿',
  '性感',
  '内衣',
  '泳衣',
  '裸照',
]

export const complianceNonHumanExposureContextTerms = [
  '岩石',
  '岩壁',
  '岩层',
  '山体',
  '山峰',
  '山脊',
  '山坡',
  '高山',
  '雪山',
  '地表',
  '地貌',
  '石壁',
  '石块',
  '石头',
  '雕塑',
  '石像',
  '艺术',
  '建筑',
  '机械',
  '金属',
  '电线',
  '线路',
  '土层',
  '露岩',
  '裸岩',
]

export const complianceRiskRules: ComplianceRiskRule[] = [
  {
    category: 'terrorism',
    label: '涉恐/爆炸物',
    defaultSeverity: 'high',
    groups: [
      {
        severity: 'critical',
        reason: '直接命中涉恐或袭击类核心词',
        terms: ['恐怖袭击', '恐怖组织', '劫持', '人质', '袭击机场', 'jihad', 'terrorist'],
      },
      {
        severity: 'high',
        reason: '爆炸物词与制作、投放或袭击上下文同时出现',
        terms: ['炸弹', '爆炸物', '炸药', '爆破', '自制炸药'],
        requiresAny: [
          '制作',
          '教程',
          '配方',
          '安装',
          '引爆',
          '袭击',
          '杀伤',
          '隐藏',
          '投放',
          '机场',
          '人群',
          '车站',
          '学校',
        ],
        excludeNear: ['电影特效', '爆炸效果', '视觉效果', '烟花', '烟火', '比喻', '夸张表达'],
        window: 44,
      },
    ],
  },
  {
    category: 'sexual_content',
    label: '涉黄/性内容',
    defaultSeverity: 'medium',
    groups: [
      {
        severity: 'high',
        reason: '直接命中明确性内容或性侵害词',
        terms: ['色情', '性行为', '成人视频', '未成年性', '强奸', '性侵', 'porn', 'rape'],
      },
      {
        severity: 'medium',
        reason: '裸露词与人体部位上下文同时出现',
        terms: ['裸露', '裸体', '裸照', '露点', '私密部位'],
        requiresAny: complianceHumanBodyContextTerms,
        excludeNear: complianceNonHumanExposureContextTerms,
      },
      {
        severity: 'low',
        reason: '性感服饰词与成人人物、写真或镜头上下文同时出现',
        terms: ['性感', '内衣', '泳衣', '透视装', '露背', '低胸'],
        requiresAny: ['人物', '人体', '身体', '模特', '写真', '姿势', '挑逗', '镜头', '女性', '男性', '成人'],
        excludeNear: ['服装设计', '服装参考', '穿搭', '电商', '产品图', '布料', '颜色', '色调', '泳装产品'],
      },
    ],
  },
  {
    category: 'graphic_violence',
    label: '极端血腥暴力',
    defaultSeverity: 'medium',
    groups: [
      {
        severity: 'high',
        reason: '直接命中极端血腥或残虐暴力词',
        terms: [
          '肢解',
          '虐杀',
          '斩首',
          '内脏',
          '残肢',
          '酷刑',
          '爆头',
          '血肉模糊',
          '断肢',
          'gore',
          'beheading',
        ],
      },
      {
        severity: 'medium',
        reason: '血腥伤害词与暴力、死亡或犯罪上下文同时出现',
        terms: ['血腥', '流血', '血迹', '伤口', '尸体'],
        requiresAny: ['暴力', '打斗', '杀戮', '恐怖', '受伤', '死亡', '枪击', '砍杀', '战场', '犯罪', '镜头'],
        excludeNear: ['血色晚霞', '血色天空', '红色颜料', '番茄汁', '医学教学', '手术教学', '急救科普'],
      },
    ],
  },
  {
    category: 'political_sensitive',
    label: '政治敏感',
    defaultSeverity: 'medium',
    groups: [
      {
        severity: 'medium',
        reason: '命中政治敏感词且未处于新闻、教材或科普语境',
        terms: ['政治敏感', '敏感政治', '政变', '颠覆', '分裂国家', '台独', '港独', '藏独', '疆独'],
        excludeNear: ['历史教材', '新闻摘要', '中立报道', '政策科普', '课堂讲解'],
      },
      {
        severity: 'high',
        reason: '直接命中煽动性政治风险词',
        terms: ['煽动政变', '武装颠覆', '分裂国家教程'],
      },
    ],
  },
  {
    category: 'extremism',
    label: '极端主义/仇恨',
    defaultSeverity: 'medium',
    groups: [
      {
        severity: 'high',
        reason: '直接命中极端主义、仇恨或种族灭绝词',
        terms: ['极端主义', '种族清洗', '仇恨宣言', '大屠杀', 'genocide'],
      },
      {
        severity: 'medium',
        reason: '命中纳粹相关词且未处于历史研究或反法西斯语境',
        terms: ['纳粹', 'nazi'],
        excludeNear: ['历史纪录片', '历史教材', '二战博物馆', '反法西斯', '历史研究'],
      },
      {
        severity: 'high',
        reason: '直接命中纳粹宣传或崇拜词',
        terms: ['纳粹宣传', '纳粹崇拜', 'nazi propaganda', 'nazi salute'],
      },
    ],
  },
  {
    category: 'self_harm',
    label: '自伤自杀',
    defaultSeverity: 'medium',
    groups: [
      {
        severity: 'high',
        reason: '命中自伤自杀词且未处于预防、求助或康复语境',
        terms: ['自杀', '自残', '割腕', '上吊', '服毒', 'suicide', 'self-harm'],
        excludeNear: [
          '预防',
          '劝阻',
          '心理健康',
          '求助',
          '公益',
          '热线',
          '治疗',
          '康复',
          '反自杀',
          '危机干预',
        ],
      },
      {
        severity: 'critical',
        reason: '直接命中自伤自杀方法或教程词',
        terms: ['自杀方法', '自杀教程', '自残教程', '如何自杀', 'suicide method'],
      },
    ],
  },
  {
    category: 'other',
    label: '其他违法/高危',
    defaultSeverity: 'medium',
    groups: [
      {
        severity: 'high',
        reason: '直接命中诈骗、洗钱、盗刷或绕审教程词',
        terms: ['诈骗教程', '洗钱教程', '盗刷教程', '钓鱼网站', '窃取密码', '绕过审核', '绕过风控'],
      },
      {
        severity: 'medium',
        reason: '违法高危词与购买、制作、泄露或批量收集上下文同时出现',
        terms: ['毒品', '冰毒', '海洛因', '可卡因', '银行卡', '身份证', '隐私信息'],
        requiresAny: ['购买', '贩卖', '制作', '教程', '泄露', '盗取', '套现', '批量', '收集'],
        excludeNear: ['禁毒宣传', '反诈宣传', '隐私保护', '安全教育', '法治宣传'],
      },
    ],
  },
]
