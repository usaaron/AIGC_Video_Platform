export const FUNCTION_STACK_ITEMS = [
  {
    id: 'agent-studio',
    label: '一句成片',
    title: '对话一句成片',
    eyebrow: 'AGENT STUDIO / 01',
    description: '从创作意图进入剧本、资产、分镜与成片编排。',
  },
  {
    id: 'image-studio',
    label: '图片大师',
    title: '图片大师',
    eyebrow: 'IMAGE STUDIO / 02',
    description: '独立管理人物、场景、物品与视觉参考图。',
  },
  {
    id: 'writing-studio',
    label: '剧本大师',
    title: '剧本大师',
    eyebrow: 'WRITING ROOM / 03',
    description: '长篇故事的世界观、人物关系与分集规划空间。',
  },
]

export const FUNCTION_STACK_IDS = new Set(FUNCTION_STACK_ITEMS.map((item) => item.id))
