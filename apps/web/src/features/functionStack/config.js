export const FUNCTION_STACK_ITEMS = [
  {
    id: 'agent-studio',
    label: '一句成片',
    title: '对话一句成片',
    eyebrow: '创作助手',
    description: '从几个想法开始，确认方案后逐步完成作品。',
  },
  {
    id: 'image-studio',
    label: '生图大师',
    title: '生图大师',
    eyebrow: '图像创作',
    description: '描述画面，加入参考图，探索你的视觉风格。',
  },
  {
    id: 'writing-studio',
    label: '剧本大师',
    title: '剧本大师',
    eyebrow: '长篇创作',
    description: '长篇故事的世界观、人物关系与分集规划空间。',
  },
]

export const FUNCTION_STACK_IDS = new Set(FUNCTION_STACK_ITEMS.map((item) => item.id))
