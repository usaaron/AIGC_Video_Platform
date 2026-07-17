import { z } from 'zod'

export const adminOverviewSchema = z.object({
  users: z.number().int().nonnegative(),
  activeTasks: z.number().int().nonnegative(),
  creditsConsumedToday: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
})

export type AdminOverview = z.infer<typeof adminOverviewSchema>
