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
    label: '序幕 image2',
    title: '序幕 image2',
    eyebrow: 'IMAGE STUDIO / 02',
    description: '文本生成图、引用图与 1-20 张批次任务共用序幕TV积分。',
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
