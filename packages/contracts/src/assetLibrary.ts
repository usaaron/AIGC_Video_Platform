import { z } from 'zod'
import { mediaObjectSchema } from './media.js'

export const assetLibraryKindSchema = z.enum([
  'character',
  'scene',
  'prop',
  'costume',
  'brand',
  'audio',
  'image',
  'script',
  'video',
  'final-cut',
])

export const assetLibraryCreateKindSchema = z.enum(['audio', 'image', 'script', 'video', 'final-cut'])

export const assetLibraryTagsSchema = z.array(z.string().trim().min(1).max(50)).max(30)

const assetLibraryItemBaseSchema = z.object({
  id: z.string().min(1).max(128),
  tenantId: z.string().min(1).max(128),
  ownerUserId: z.string().min(1).max(128),
  kind: assetLibraryKindSchema,
  title: z.string().min(1).max(160),
  description: z.string().max(1_000),
  sourceProjectId: z.string().min(1).max(128).nullable(),
  sourceProjectName: z.string().min(1).max(160).nullable(),
  sourceAssetId: z.string().min(1).max(128).nullable(),
  sourceTaskId: z.string().min(1).max(128).nullable(),
  sourceMediaId: z.string().min(1).max(128).nullable(),
  sourceSnapshot: z.record(z.string(), z.unknown()),
  contentHash: z.string().min(1).max(128),
  contentType: z.string().min(1).max(160),
  sizeBytes: z.number().int().positive(),
  duplicateOfItemId: z.string().min(1).max(128).nullable(),
  currentVersion: z.number().int().positive(),
  tags: assetLibraryTagsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  restoredAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
})

export const assetLibraryItemRecordSchema = assetLibraryItemBaseSchema.extend({
  storageKey: z.string().min(1).max(2_000),
  previewStorageKey: z.string().min(1).max(2_000).nullable(),
})

export const assetLibraryItemSchema = assetLibraryItemBaseSchema

export const assetLibraryItemViewSchema = assetLibraryItemSchema.extend({
  previewUrl: z.string().min(1).max(2_000),
  downloadUrl: z.string().min(1).max(2_000),
  packageUrl: z.string().min(1).max(2_000),
})

export const listAssetLibraryItemsQuerySchema = z.object({
  kind: assetLibraryKindSchema.optional(),
  sourceProjectId: z.string().min(1).max(128).optional(),
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(50).optional(),
  deleted: z.enum(['active', 'trashed', 'all']).default('active'),
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
})

const createAssetLibraryItemBaseSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000).default(''),
  tags: assetLibraryTagsSchema.default([]),
  sourceSnapshot: z.record(z.string(), z.unknown()).default({}),
})

export const createAssetLibraryItemSchema = z.discriminatedUnion('sourceType', [
  createAssetLibraryItemBaseSchema.extend({
    sourceType: z.literal('media'),
    kind: z.enum(['image', 'audio']),
    projectId: z.string().min(1).max(128),
    mediaId: z.string().min(1).max(128),
    sourceTaskId: z.string().min(1).max(128).optional(),
  }),
  createAssetLibraryItemBaseSchema.extend({
    sourceType: z.literal('text'),
    kind: z.literal('script'),
    projectId: z.string().min(1).max(128),
    content: z.string().trim().min(1).max(200_000),
  }),
  createAssetLibraryItemBaseSchema.extend({
    sourceType: z.literal('task'),
    kind: z.enum(['video', 'final-cut']),
    projectId: z.string().min(1).max(128),
    taskId: z.string().min(1).max(128),
  }),
])

const createAssetLibraryVersionBaseSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(1_000).optional(),
  tags: assetLibraryTagsSchema.optional(),
  sourceSnapshot: z.record(z.string(), z.unknown()).default({}),
})

export const createAssetLibraryItemVersionSchema = z.discriminatedUnion('sourceType', [
  createAssetLibraryVersionBaseSchema.extend({
    sourceType: z.literal('media'),
    kind: z.enum(['image', 'audio']),
    projectId: z.string().min(1).max(128),
    mediaId: z.string().min(1).max(128),
    sourceTaskId: z.string().min(1).max(128).optional(),
  }),
  createAssetLibraryVersionBaseSchema.extend({
    sourceType: z.literal('text'),
    kind: z.literal('script'),
    projectId: z.string().min(1).max(128),
    content: z.string().trim().min(1).max(200_000),
  }),
  createAssetLibraryVersionBaseSchema.extend({
    sourceType: z.literal('task'),
    kind: z.enum(['video', 'final-cut']),
    projectId: z.string().min(1).max(128),
    taskId: z.string().min(1).max(128),
  }),
])

export const updateAssetLibraryItemSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(1_000).optional(),
    tags: assetLibraryTagsSchema.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required')

export const saveProjectAssetToLibrarySchema = createAssetLibraryItemBaseSchema.extend({
  kind: assetLibraryKindSchema.optional(),
})

export const importAssetLibraryItemSchema = z.object({
  itemId: z.string().min(1).max(128),
  target: z.enum(['auto', 'media', 'script']).default('auto'),
})

export const assetLibraryListResponseSchema = z.object({
  items: z.array(assetLibraryItemViewSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
})

export const assetLibraryImportResultSchema = z.object({
  item: assetLibraryItemViewSchema,
  imported: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('media'),
      media: mediaObjectSchema,
    }),
    z.object({
      type: z.literal('script'),
      content: z.string(),
    }),
  ]),
})

const assetLibraryItemVersionBaseSchema = z.object({
  id: z.string().min(1).max(128),
  itemId: z.string().min(1).max(128),
  tenantId: z.string().min(1).max(128),
  ownerUserId: z.string().min(1).max(128),
  version: z.number().int().positive(),
  sourceSnapshot: z.record(z.string(), z.unknown()),
  contentHash: z.string().min(1).max(128),
  contentType: z.string().min(1).max(160),
  sizeBytes: z.number().int().positive(),
  createdAt: z.string().datetime(),
  createdBy: z.string().min(1).max(128),
})

export const assetLibraryItemVersionRecordSchema = assetLibraryItemVersionBaseSchema.extend({
  storageKey: z.string().min(1).max(2_000),
})

export const assetLibraryItemVersionViewSchema = assetLibraryItemVersionBaseSchema.extend({
  downloadUrl: z.string().min(1).max(2_000),
})

export const assetLibraryItemVersionListResponseSchema = z.object({
  item: assetLibraryItemViewSchema,
  versions: z.array(assetLibraryItemVersionViewSchema),
})

export const assetLibraryKindStatsSchema = z.object({
  kind: assetLibraryKindSchema,
  count: z.number().int().nonnegative(),
  trashed: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  versions: z.number().int().nonnegative(),
})

export const assetLibrarySourceProjectStatsSchema = z.object({
  sourceProjectId: z.string().min(1).max(128).nullable(),
  sourceProjectName: z.string().min(1).max(160).nullable(),
  count: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
})

export const assetLibraryStatsResponseSchema = z.object({
  totalItems: z.number().int().nonnegative(),
  activeItems: z.number().int().nonnegative(),
  trashedItems: z.number().int().nonnegative(),
  duplicateItems: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  activeBytes: z.number().int().nonnegative(),
  versionCount: z.number().int().nonnegative(),
  byKind: z.array(assetLibraryKindStatsSchema),
  bySourceProject: z.array(assetLibrarySourceProjectStatsSchema),
})

export const assetLibraryDuplicateGroupSchema = z.object({
  contentHash: z.string().min(1).max(128),
  kind: assetLibraryKindSchema,
  itemCount: z.number().int().positive(),
  duplicateCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  wastedBytes: z.number().int().nonnegative(),
  canonicalItemId: z.string().min(1).max(128).nullable(),
  items: z.array(assetLibraryItemViewSchema),
})

export const assetLibraryDuplicatesResponseSchema = z.object({
  groups: z.array(assetLibraryDuplicateGroupSchema),
})

export const assetLibraryDedupeResultSchema = assetLibraryDuplicatesResponseSchema.extend({
  updatedItems: z.number().int().nonnegative(),
})

export type AssetLibraryKind = z.infer<typeof assetLibraryKindSchema>
export type AssetLibraryCreateKind = z.infer<typeof assetLibraryCreateKindSchema>
export type AssetLibraryItemRecord = z.infer<typeof assetLibraryItemRecordSchema>
export type AssetLibraryItem = z.infer<typeof assetLibraryItemSchema>
export type AssetLibraryItemView = z.infer<typeof assetLibraryItemViewSchema>
export type ListAssetLibraryItemsQuery = z.infer<typeof listAssetLibraryItemsQuerySchema>
export type CreateAssetLibraryItem = z.infer<typeof createAssetLibraryItemSchema>
export type CreateAssetLibraryItemVersion = z.infer<typeof createAssetLibraryItemVersionSchema>
export type UpdateAssetLibraryItem = z.infer<typeof updateAssetLibraryItemSchema>
export type SaveProjectAssetToLibrary = z.infer<typeof saveProjectAssetToLibrarySchema>
export type ImportAssetLibraryItem = z.infer<typeof importAssetLibraryItemSchema>
export type AssetLibraryListResponse = z.infer<typeof assetLibraryListResponseSchema>
export type AssetLibraryImportResult = z.infer<typeof assetLibraryImportResultSchema>
export type AssetLibraryItemVersionRecord = z.infer<typeof assetLibraryItemVersionRecordSchema>
export type AssetLibraryItemVersionView = z.infer<typeof assetLibraryItemVersionViewSchema>
export type AssetLibraryItemVersionListResponse = z.infer<typeof assetLibraryItemVersionListResponseSchema>
export type AssetLibraryStatsResponse = z.infer<typeof assetLibraryStatsResponseSchema>
export type AssetLibraryDuplicateGroup = z.infer<typeof assetLibraryDuplicateGroupSchema>
export type AssetLibraryDuplicatesResponse = z.infer<typeof assetLibraryDuplicatesResponseSchema>
export type AssetLibraryDedupeResult = z.infer<typeof assetLibraryDedupeResultSchema>
