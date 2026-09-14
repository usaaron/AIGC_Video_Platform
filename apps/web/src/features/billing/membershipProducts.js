// Display-only sample terms and prices. A future checkout must use server-confirmed products.
export const MEMBERSHIP_PLANS = [
  { id: 'member-month', title: '月度会员', months: 1, amountFen: 4900 },
  { id: 'member-quarter', title: '季度会员', months: 3, amountFen: 12900 },
  { id: 'member-year', title: '年度会员', months: 12, amountFen: 45900 },
]

// Matches the existing member entitlement. Changes here do not change server-side billing rules.
export const MEMBER_BENEFITS = { monthlyCredits: 500, concurrency: 3 }
