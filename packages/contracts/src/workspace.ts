import { z } from 'zod'
import { planSchema } from './account.js'
import { roleSchema } from './auth.js'

export const projectSharePermissionSchema = z.enum(['view', 'comment', 'edit'])
export const projectShareStatusSchema = z.enum(['active', 'revoked'])
export const projectCommentTargetSchema = z.enum(['project', 'asset', 'shot', 'film'])
export const projectCommentStatusSchema = z.enum(['pending', 'approved', 'rejected'])
export const checkoutProviderSchema = z.enum(['mock', 'stripe', 'wechat-pay', 'alipay'])
export const checkoutStatusSchema = z.enum(['created', 'pending', 'completed', 'cancelled', 'expired'])
export const subscriptionStatusSchema = z.enum(['trialing', 'active', 'past_due', 'cancelled', 'expired'])
export const billingCycleSchema = z.enum(['monthly', 'yearly'])

export const workspaceMemberSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1).max(80),
  roles: z.array(roleSchema).min(1),
  plan: planSchema,
  credits: z.number().int().nonnegative(),
  canManageBilling: z.boolean(),
  canApproveComments: z.boolean(),
  isOwner: z.boolean(),
  status: z.enum(['active', 'disabled']),
  joinedAt: z.string().datetime(),
})

export const projectShareSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  sharedWithUserId: z.string().min(1).nullable(),
  sharedWithEmail: z.string().email().nullable(),
  permission: projectSharePermissionSchema,
  commentApprovalRequired: z.boolean(),
  status: projectShareStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const createProjectShareSchema = z
  .object({
    sharedWithUserId: z.string().min(1).optional(),
    sharedWithEmail: z.string().email().optional(),
    permission: projectSharePermissionSchema.default('view'),
    commentApprovalRequired: z.boolean().default(true),
  })
  .refine(
    (input) => Boolean(input.sharedWithUserId || input.sharedWithEmail),
    'Share requires a user id or email',
  )

export const updateProjectShareSchema = z
  .object({
    permission: projectSharePermissionSchema.optional(),
    commentApprovalRequired: z.boolean().optional(),
    status: projectShareStatusSchema.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required')

export const projectCommentSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  targetType: projectCommentTargetSchema,
  targetId: z.string().max(128),
  authorUserId: z.string().min(1).nullable(),
  authorName: z.string().min(1).max(80),
  body: z.string().min(1).max(2_000),
  status: projectCommentStatusSchema,
  reviewedByUserId: z.string().min(1).nullable(),
  reviewedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const createProjectCommentSchema = z.object({
  targetType: projectCommentTargetSchema.default('project'),
  targetId: z.string().max(128).default(''),
  authorName: z.string().min(1).max(80).optional(),
  body: z.string().min(1).max(2_000),
})

export const reviewProjectCommentSchema = z.object({
  status: z.enum(['approved', 'rejected']),
})

export const usageSummarySchema = z.object({
  generatedAt: z.string().datetime(),
  periodDays: z.number().int().positive(),
  creditsSpent: z.number().int().nonnegative(),
  tasksCreated: z.number().int().nonnegative(),
  imageTasks: z.number().int().nonnegative(),
  videoTasks: z.number().int().nonnegative(),
  audioTasks: z.number().int().nonnegative(),
  activeShares: z.number().int().nonnegative(),
  pendingComments: z.number().int().nonnegative(),
  activeMembers: z.number().int().nonnegative(),
  watermarkTasks: z.number().int().nonnegative(),
})

export const billingPackageSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(300),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  credits: z.number().int().nonnegative(),
  concurrency: z.number().int().positive(),
  seats: z.number().int().positive(),
  watermarkRequired: z.boolean(),
  commercialLicenseIncluded: z.boolean(),
  featured: z.boolean(),
})

export const subscriptionSummarySchema = z.object({
  tenantId: z.string().min(1),
  provider: checkoutProviderSchema,
  packageId: z.string().min(1).max(64),
  status: subscriptionStatusSchema,
  billingCycle: billingCycleSchema,
  seatLimit: z.number().int().positive(),
  activeSeats: z.number().int().nonnegative(),
  watermarkRequired: z.boolean(),
  commercialLicenseEnabled: z.boolean(),
  startsAt: z.string().datetime(),
  renewsAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
})

export const checkoutSessionSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  provider: checkoutProviderSchema,
  packageId: z.string().min(1).max(64),
  status: checkoutStatusSchema,
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  url: z.string().min(1).max(2_000),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const createCheckoutSessionSchema = z.object({
  packageId: z.string().min(1).max(64),
  billingCycle: billingCycleSchema.default('monthly'),
})

export const projectCollaborationSchema = z.object({
  members: z.array(workspaceMemberSchema),
  shares: z.array(projectShareSchema),
  comments: z.array(projectCommentSchema),
  usage: usageSummarySchema,
  packages: z.array(billingPackageSchema),
  subscription: subscriptionSummarySchema,
  checkoutSessions: z.array(checkoutSessionSchema),
})

export type ProjectSharePermission = z.infer<typeof projectSharePermissionSchema>
export type ProjectShareStatus = z.infer<typeof projectShareStatusSchema>
export type ProjectCommentStatus = z.infer<typeof projectCommentStatusSchema>
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>
export type ProjectShare = z.infer<typeof projectShareSchema>
export type CreateProjectShare = z.infer<typeof createProjectShareSchema>
export type UpdateProjectShare = z.infer<typeof updateProjectShareSchema>
export type ProjectComment = z.infer<typeof projectCommentSchema>
export type CreateProjectComment = z.infer<typeof createProjectCommentSchema>
export type ReviewProjectComment = z.infer<typeof reviewProjectCommentSchema>
export type UsageSummary = z.infer<typeof usageSummarySchema>
export type BillingPackage = z.infer<typeof billingPackageSchema>
export type SubscriptionSummary = z.infer<typeof subscriptionSummarySchema>
export type CheckoutSession = z.infer<typeof checkoutSessionSchema>
export type CreateCheckoutSession = z.infer<typeof createCheckoutSessionSchema>
export type ProjectCollaboration = z.infer<typeof projectCollaborationSchema>
