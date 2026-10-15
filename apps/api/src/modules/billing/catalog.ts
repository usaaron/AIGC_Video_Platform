import type { BillingPackage, Plan, SubscriptionSummary } from '@seqora/contracts'

export const BILLING_PACKAGES: BillingPackage[] = [
  {
    id: 'free',
    name: '免费版',
    description: '单人使用，保留平台水印，适合试用和草稿阶段。',
    priceCents: 0,
    currency: 'CNY',
    credits: 0,
    concurrency: 1,
    seats: 1,
    watermarkRequired: true,
    commercialLicenseIncluded: false,
    featured: false,
  },
  {
    id: 'member',
    name: '创作会员',
    description: '适合独立创作者，去水印并提升并发。',
    priceCents: 9_900,
    currency: 'CNY',
    credits: 500,
    concurrency: 3,
    seats: 1,
    watermarkRequired: false,
    commercialLicenseIncluded: true,
    featured: true,
  },
  {
    id: 'team',
    name: '团队版',
    description: '支持团队协作、共享项目和评论审批。',
    priceCents: 29_900,
    currency: 'CNY',
    credits: 2_500,
    concurrency: 6,
    seats: 5,
    watermarkRequired: false,
    commercialLicenseIncluded: true,
    featured: false,
  },
  {
    id: 'enterprise',
    name: '企业版',
    description: '大规模并发、商用授权和定制化部署。',
    priceCents: 0,
    currency: 'CNY',
    credits: 10_000,
    concurrency: 12,
    seats: 20,
    watermarkRequired: false,
    commercialLicenseIncluded: true,
    featured: false,
  },
]

export function packageById(packageId: string): BillingPackage | null {
  return BILLING_PACKAGES.find((item) => item.id === packageId) ?? null
}

export function packageForPlan(plan: Plan | SubscriptionSummary['packageId']): BillingPackage {
  return packageById(plan) ?? BILLING_PACKAGES[0]!
}

export function creditsForPlan(plan: Plan): number {
  return packageForPlan(plan).credits
}

export function concurrencyForPlan(plan: Plan): number {
  return packageForPlan(plan).concurrency
}

export function watermarkRequiredForPlan(plan: Plan): boolean {
  return packageForPlan(plan).watermarkRequired
}

export function commercialLicenseForPlan(plan: Plan): boolean {
  return packageForPlan(plan).commercialLicenseIncluded
}

export function defaultSubscriptionForTenant(
  tenantId: string,
  now = new Date().toISOString(),
): SubscriptionSummary {
  const base = packageById('free') ?? BILLING_PACKAGES[0]!
  return {
    tenantId,
    provider: 'mock',
    packageId: base.id,
    status: 'active',
    billingCycle: 'monthly',
    seatLimit: base.seats,
    activeSeats: 1,
    watermarkRequired: base.watermarkRequired,
    commercialLicenseEnabled: base.commercialLicenseIncluded,
    startsAt: now,
    renewsAt: null,
    updatedAt: now,
  }
}
