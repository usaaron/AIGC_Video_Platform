import type { Asset, ScriptCreativeDirection } from '@seqora/contracts'
import { headExcerpt } from './shotPlanning.js'

export function assetSummary(assets: Asset[]): string {
  if (!assets.length) return '暂无，请根据原始素材建立一致的人物、场景和道具设定'
  return assets
    .slice(0, 16)
    .map((asset) => {
      const parts = [
        `${asset.kind}:${asset.name}`,
        asset.description ? `说明：${headExcerpt(asset.description, 220)}` : '',
        asset.prompt ? `生成提示词：${headExcerpt(asset.prompt, 260)}` : '',
        assetAttributeSummary(asset),
      ].filter(Boolean)
      return parts.join('；')
    })
    .join('；')
}

export function assetSuggestionSummary(assets: Asset[]): string {
  if (!assets.length) return '暂无；只建立剧本明确且可复用的核心资产'
  return assets
    .slice(0, 12)
    .map((asset) => {
      const details = [
        `${asset.kind}:${asset.name}`,
        asset.description ? headExcerpt(asset.description, 120) : '',
        assetAttributeSummary(asset),
      ]
        .filter(Boolean)
        .join('；')
      return details
    })
    .join('｜')
}

export function assetAttributeSummary(asset: Asset): string {
  const attributes = asset.attributes
  if (attributes.type === 'character') {
    return `结构化身份：${[
      attributes.subjectType,
      attributes.gender,
      attributes.exactAge ? `${attributes.exactAge}岁` : attributes.ageGroup,
      attributes.species,
      attributes.visualStyle,
      attributes.bodyType,
      attributes.background,
    ]
      .filter(Boolean)
      .join('、')}`
  }
  if (attributes.type === 'scene') {
    return `结构化场景：${[
      attributes.space,
      attributes.sceneType,
      attributes.era,
      attributes.time,
      attributes.weather,
      attributes.mood,
      attributes.camera,
      attributes.visualStyle,
    ]
      .filter(Boolean)
      .join('、')}`
  }
  if (attributes.type === 'prop') {
    return `结构化物品：${[
      attributes.category,
      attributes.material,
      attributes.condition,
      attributes.view,
      attributes.background,
      attributes.visualStyle,
    ]
      .filter(Boolean)
      .join('、')}`
  }
  if (attributes.type === 'costume') {
    return `结构化服装：${[
      attributes.audience,
      attributes.category,
      attributes.season,
      attributes.design,
      attributes.presentation,
      attributes.visualStyle,
    ]
      .filter(Boolean)
      .join('、')}`
  }
  if (attributes.type === 'brand') {
    return `结构化品牌：${[
      attributes.brandType,
      attributes.usage,
      attributes.layout,
      attributes.exactText,
      attributes.palette,
      attributes.visualStyle,
    ]
      .filter(Boolean)
      .join('、')}`
  }
  return ''
}

const directionLabels: Record<keyof ScriptCreativeDirection, Record<string, string>> = {
  style: {
    auto: '由 AI 根据题材自动选择',
    photorealistic: '仿真人电影感',
    'cinematic-cg': '电影级 CG',
    'chinese-3d': '国漫三维',
    'chinese-2d': '国漫二维',
    anime: '日系动画',
    storybook: '绘本风格',
  },
  composition: {
    auto: '由 AI 根据题材自动选择',
    'rule-of-thirds': '三分法构图',
    centered: '中心构图',
    symmetry: '对称构图',
    'negative-space': '留白构图',
    dynamic: '动态斜线构图',
  },
  lighting: {
    auto: '由 AI 根据题材自动选择',
    'natural-soft': '自然柔光',
    'high-contrast': '高反差硬光',
    'low-key': '低调暗光',
    backlight: '逆光轮廓光',
    neon: '霓虹彩光',
  },
  camera: {
    auto: '由 AI 根据题材自动选择',
    restrained: '克制稳定运镜',
    immersive: '沉浸跟随运镜',
    dynamic: '动态动作运镜',
    documentary: '纪录片手持感',
    suspense: '悬疑压迫运镜',
  },
  focus: {
    balanced: '剧情、人物和对白均衡',
    scene: '优先展开场景与空间',
    character: '优先展开人物动作与情绪',
    dialogue: '优先展开对白与表演反应',
  },
}

export function directionSummary(direction: ScriptCreativeDirection): string {
  return [
    `风格：${directionLabels.style[direction.style] || direction.style}`,
    `构图：${directionLabels.composition[direction.composition] || direction.composition}`,
    `光影：${directionLabels.lighting[direction.lighting] || direction.lighting}`,
    `运镜：${directionLabels.camera[direction.camera] || direction.camera}`,
    `扩写重点：${directionLabels.focus[direction.focus] || direction.focus}`,
  ].join('；')
}
