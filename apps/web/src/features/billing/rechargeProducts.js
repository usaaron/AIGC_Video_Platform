// Display-only sample prices. Replace after pricing is confirmed; never submit these amounts to checkout.
export const RECHARGE_PACKS = [
  { id: 'credits-100', credits: 100, amountFen: 1000, label: '轻量体验' },
  { id: 'credits-500', credits: 500, amountFen: 4500, label: '日常创作' },
  { id: 'credits-1000', credits: 1000, amountFen: 8800, label: '进阶创作' },
  { id: 'credits-3000', credits: 3000, amountFen: 24800, label: '项目储备' },
  { id: 'credits-5000', credits: 5000, amountFen: 39800, label: '高频创作' },
  { id: 'credits-10000', credits: 10000, amountFen: 76800, label: '批量制作' },
]

export function formatRechargePrice(amountFen) {
  return (amountFen / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: amountFen % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
}
