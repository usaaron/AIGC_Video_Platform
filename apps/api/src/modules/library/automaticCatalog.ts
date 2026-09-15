import { createHash } from 'node:crypto'
import type { AssetLibraryItemRecord, Principal } from '@seqora/contracts'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppStore } from '../../infra/store.js'

type Source = {
  projectId: string
  projectName: string
  title: string
  kind: AssetLibraryItemRecord['kind']
  taskId?: string | null
  assetId?: string | null | undefined
  mediaId?: string | null
  storageKey?: string
  contentType?: string
  size?: number
  content?: string
  createdAt: string
}

export async function automaticCatalogItems(
  database: AccountDatabase | null,
  store: AppStore | null,
  principal: Principal,
) {
  const sources: Source[] = database
    ? (
        await database.query<{ source: Source }>(AUTO_SOURCES_SQL, [principal.tenantId, principal.userId])
      ).rows.map((row) => row.source)
    : memorySources(store!, principal)
  const known = database
    ? new Set<string>()
    : new Set(store!.read((state) => state.assetLibraryItems.map((item) => item.id)))
  return sources
    .filter((source) => {
      if (!source.taskId || !source.storageKey) return true
      const prefix = `${principal.tenantId}/${source.projectId}/generated/${source.taskId}-`
      return source.storageKey.startsWith(prefix) && /^[^/\\]+$/u.test(source.storageKey.slice(prefix.length))
    })
    .map((source) => catalogRecord(source, principal))
    .filter((item) => !known.has(item.id))
}

export function catalogRecord(source: Source, principal: Principal): AssetLibraryItemRecord {
  const text = source.content?.trim() || ''
  const hash = createHash('sha256')
    .update(text || source.storageKey!)
    .digest('hex')
  const id = `auto-${createHash('sha256')
    .update(`${principal.tenantId}:${principal.userId}:${source.projectId}:${text || source.storageKey}`)
    .digest('hex')}`
  return {
    id,
    tenantId: principal.tenantId,
    ownerUserId: principal.userId,
    kind: source.kind,
    title: source.title.slice(0, 160),
    description: '',
    sourceProjectId: source.projectId || null,
    sourceProjectName: source.projectName,
    sourceAssetId: source.assetId || null,
    sourceTaskId: source.taskId || null,
    sourceMediaId: source.mediaId || null,
    sourceSnapshot: { automatic: true, ...(text ? { inlineContent: text } : {}) },
    storageKey: text ? `inline:${id}` : source.storageKey!,
    previewStorageKey: null,
    contentHash: text ? hash : `stored:${hash}`,
    contentType: text ? 'text/plain; charset=utf-8' : source.contentType!,
    sizeBytes: text ? Buffer.byteLength(text, 'utf8') : Number(source.size),
    duplicateOfItemId: null,
    currentVersion: 1,
    tags: [text ? (text.length > 2_200 ? '长剧本' : '短剧本') : '生成素材'],
    createdAt: new Date(source.createdAt).toISOString(),
    updatedAt: new Date(source.createdAt).toISOString(),
    restoredAt: null,
    deletedAt: null,
  }
}

function memorySources(store: AppStore, principal: Principal): Source[] {
  return store.read((state) =>
    state.projects
      .filter((project) => project.tenantId === principal.tenantId && project.ownerId === principal.userId)
      .flatMap((project) => {
        const base = { projectId: project.id, projectName: project.name }
        const scripts = [
          { title: project.name, content: project.script, createdAt: project.updatedAt },
          ...state.scriptEpisodes
            .filter((episode) => episode.projectId === project.id && episode.tenantId === principal.tenantId)
            .flatMap((episode) =>
              [episode.content, episode.draftContent].map((content) => ({
                title: `${project.name} · ${episode.title}`,
                content,
                createdAt: episode.updatedAt,
              })),
            ),
        ]
          .filter((item) => item.content.trim())
          .map((item): Source => ({ ...base, ...item, kind: 'script' }))
        const tasks = state.tasks
          .filter(
            (task) =>
              task.projectId === project.id &&
              task.tenantId === principal.tenantId &&
              task.status === 'completed',
          )
          .flatMap((task): Source[] => {
            const result = task.metadata.textResult as
              | { script?: string; episodes?: { title: string; draftContent: string; content: string }[] }
              | undefined
            const texts = result?.episodes?.length
              ? result.episodes.map((episode) => ({
                  title: `${project.name} · ${episode.title}`,
                  content: episode.draftContent || episode.content,
                }))
              : result?.script
                ? [{ title: `${project.name} · ${task.label}`, content: result.script }]
                : []
            const descriptors = Array.isArray(task.metadata.generatedOutputs)
              ? (task.metadata.generatedOutputs as {
                  storageKey: string
                  contentType: string
                  size: number
                  view: string
                }[])
              : []
            const asset = state.assets.find(
              (item) => item.id === task.metadata.assetId && item.projectId === project.id,
            )
            return [
              ...(typeof task.metadata.previewStorageKey === 'string' && Number(task.metadata.previewSize) > 0
                ? [
                    {
                      ...base,
                      title: task.label,
                      kind: 'final-cut' as const,
                      taskId: task.id,
                      storageKey: task.metadata.previewStorageKey,
                      contentType: 'video/mp4',
                      size: Number(task.metadata.previewSize),
                      createdAt: task.updatedAt,
                    },
                  ]
                : []),
              ...texts
                .filter((item) => item.content?.trim())
                .map((item): Source => ({
                  ...base,
                  ...item,
                  taskId: task.id,
                  kind: 'script',
                  createdAt: task.updatedAt,
                })),
              ...descriptors
                .filter((item) => item.storageKey && item.size > 0)
                .map((item): Source => ({
                  ...base,
                  ...item,
                  title: `${task.label} · ${item.view}`,
                  taskId: task.id,
                  assetId: asset?.id,
                  kind: item.contentType.startsWith('image/')
                    ? asset?.kind || 'image'
                    : item.contentType.startsWith('audio/')
                      ? 'audio'
                      : 'video',
                  createdAt: task.updatedAt,
                })),
            ]
          })
        const media = state.media
          .filter(
            (item) =>
              item.projectId === project.id &&
              item.tenantId === principal.tenantId &&
              /^(image|audio|video)\//u.test(item.contentType),
          )
          .map((item): Source => ({
            ...base,
            mediaId: item.id,
            title: item.name,
            storageKey: item.storageKey,
            contentType: item.contentType,
            size: item.size,
            kind: item.contentType.startsWith('image/')
              ? 'image'
              : item.contentType.startsWith('audio/')
                ? 'audio'
                : 'video',
            createdAt: item.createdAt,
          }))
        return [...scripts, ...tasks, ...media]
      }),
  )
}

// Read durable output descriptors; existing files are referenced, never copied or downloaded.
const AUTO_SOURCES_SQL = `
WITH owned AS (SELECT id, name, script, updated_at FROM projects WHERE tenant_id=$1 AND owner_user_id=$2),
sources AS (
  SELECT p.id AS project_id, jsonb_build_object('projectId',p.id,'projectName',p.name,'title',p.name,'kind','script','content',btrim(p.script),'createdAt',p.updated_at) AS source FROM owned p WHERE btrim(p.script)<>''
  UNION ALL
  SELECT p.id, jsonb_build_object('projectId',p.id,'projectName',p.name,'title',p.name||' · '||e.title,'kind','script','content',btrim(s.content),'createdAt',e.updated_at)
  FROM owned p JOIN script_episodes e ON e.project_id=p.id AND e.tenant_id=$1 CROSS JOIN LATERAL (VALUES (e.content),(e.draft_content)) s(content) WHERE btrim(s.content)<>''
  UNION ALL
  SELECT p.id, jsonb_build_object('projectId',p.id,'projectName',p.name,'title',t.label||' · '||(d->>'view'),'kind',CASE WHEN d->>'contentType' LIKE 'image/%' THEN COALESCE(a.kind,'image') WHEN d->>'contentType' LIKE 'audio/%' THEN 'audio' ELSE 'video' END,'taskId',t.id,'assetId',a.id,'storageKey',d->>'storageKey','contentType',d->>'contentType','size',d->'size','createdAt',t.updated_at)
  FROM owned p JOIN generation_tasks t ON t.project_id=p.id AND t.tenant_id=$1 AND t.status='completed'
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.metadata->'generatedOutputs')='array' THEN t.metadata->'generatedOutputs' ELSE '[]'::jsonb END) d
  LEFT JOIN assets a ON a.id=t.metadata->>'assetId' AND a.project_id=p.id AND a.tenant_id=$1
  WHERE d->>'storageKey' IS NOT NULL AND jsonb_typeof(d->'size')='number' AND (d->>'size')::bigint>0
  UNION ALL
  SELECT p.id, jsonb_build_object('projectId',p.id,'projectName',p.name,'title',p.name||' · '||t.label,'kind','script','taskId',t.id,'content',btrim(t.metadata->'textResult'->>'script'),'createdAt',t.updated_at)
  FROM owned p JOIN generation_tasks t ON t.project_id=p.id AND t.tenant_id=$1 AND t.status='completed' WHERE btrim(t.metadata->'textResult'->>'script')<>''
  UNION ALL
  SELECT p.id, jsonb_build_object('projectId',p.id,'projectName',p.name,'title',p.name||' · '||(e->>'title'),'kind','script','taskId',t.id,'content',btrim(COALESCE(NULLIF(e->>'draftContent',''),e->>'content')),'createdAt',t.updated_at)
  FROM owned p JOIN generation_tasks t ON t.project_id=p.id AND t.tenant_id=$1 AND t.status='completed'
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.metadata->'textResult'->'episodes')='array' THEN t.metadata->'textResult'->'episodes' ELSE '[]'::jsonb END) e
  WHERE btrim(COALESCE(NULLIF(e->>'draftContent',''),e->>'content'))<>''
  UNION ALL
  SELECT p.id, jsonb_build_object('projectId',p.id,'projectName',p.name,'title',m.name,'kind',m.media_type,'mediaId',m.id,'storageKey',m.storage_key,'contentType',m.content_type,'size',m.size_bytes,'createdAt',m.created_at)
  FROM owned p JOIN media_objects m ON m.project_id=p.id AND m.tenant_id=$1 AND m.status='active' AND m.media_type IN ('image','audio','video')
  UNION ALL
  SELECT p.id, jsonb_build_object('projectId',p.id,'projectName',p.name,'title',t.label,'kind','final-cut','taskId',t.id,'storageKey',t.metadata->>'previewStorageKey','contentType','video/mp4','size',t.metadata->'previewSize','createdAt',t.updated_at)
  FROM owned p JOIN generation_tasks t ON t.project_id=p.id AND t.tenant_id=$1 AND t.status='completed'
  WHERE jsonb_typeof(t.metadata->'previewStorageKey')='string' AND jsonb_typeof(t.metadata->'previewSize')='number' AND (t.metadata->>'previewSize')::bigint>0
), normalized AS (
 SELECT project_id, CASE WHEN source ? 'content' THEN source || jsonb_build_object('content', btrim(source->>'content', chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279))) ELSE source END AS source FROM sources
)
SELECT DISTINCT ON (source->>'content',source->>'storageKey', project_id) source FROM normalized
WHERE COALESCE(NULLIF(source->>'content',''),source->>'storageKey') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset_library_items item WHERE item.tenant_id=$1 AND item.owner_user_id=$2
AND item.id='auto-'||encode(sha256(convert_to($1||':'||$2||':'||project_id||':'||COALESCE(NULLIF(source->>'content',''),source->>'storageKey'),'UTF8')),'hex'))
`
