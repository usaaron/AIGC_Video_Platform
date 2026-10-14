import type { PoolClient } from 'pg'
import type { Asset, ScriptEpisode, Shot } from '@seqora/contracts'

// These table/column maps are internal constants, never request identifiers.
async function writeRows(client: PoolClient, table: string, records: Record<string, unknown>[]) {
  if (!records.length) return
  const columns = Object.keys(records[0]!)
  const immutable = new Set(['id', 'project_id', 'tenant_id', 'created_at'])
  await client.query(
    `INSERT INTO ${table} (${columns.join(', ')})
    SELECT ${columns.join(', ')} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)
    ON CONFLICT (id) DO UPDATE SET ${columns
      .filter((c) => !immutable.has(c))
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(', ')}
    WHERE ${table}.project_id = EXCLUDED.project_id AND ${table}.tenant_id = EXCLUDED.tenant_id`,
    [JSON.stringify(records)],
  )
}

export async function writeImportEntities(
  client: PoolClient,
  plan: { episodes: ScriptEpisode[]; assets: Asset[]; shots: Shot[]; removedShotIds?: string[] },
) {
  await client.query('SET CONSTRAINTS shots_project_order_unique DEFERRED')
  if (plan.removedShotIds?.length && plan.episodes[0]) {
    await client.query(
      'DELETE FROM shots WHERE id = ANY($1::text[]) AND project_id = $2 AND tenant_id = $3',
      [plan.removedShotIds, plan.episodes[0].projectId, plan.episodes[0].tenantId],
    )
  }
  await writeRows(
    client,
    'script_episodes',
    plan.episodes.map((e) => ({
      id: e.id,
      project_id: e.projectId,
      tenant_id: e.tenantId,
      episode_number: e.episodeNumber,
      title: e.title,
      content: e.content,
      draft_content: e.draftContent,
      status: e.status,
      summary: e.summary,
      continuity_state: e.continuityState,
      revision: e.revision,
      last_edited_by: e.lastEditedBy,
      created_at: e.createdAt,
      updated_at: e.updatedAt,
    })),
  )
  await writeRows(
    client,
    'assets',
    plan.assets.map((a) => ({
      id: a.id,
      project_id: a.projectId,
      tenant_id: a.tenantId,
      kind: a.kind,
      source_mode: a.sourceMode,
      name: a.name,
      description: a.description,
      prompt: a.prompt,
      prompt_mode: a.promptMode,
      custom_prompt_mode: a.customPromptMode,
      custom_prompt: a.customPrompt,
      negative_prompt: a.negativePrompt,
      reference_items: a.references,
      attributes: a.attributes,
      image_url: a.imageUrl,
      status: a.status,
      created_at: a.createdAt,
      updated_at: a.updatedAt,
    })),
  )
  await writeRows(
    client,
    'shots',
    plan.shots.map((s) => ({
      id: s.id,
      project_id: s.projectId,
      tenant_id: s.tenantId,
      script_episode_id: s.scriptEpisodeId,
      shot_order: s.order,
      title: s.title,
      framing: s.framing,
      duration_seconds: s.duration,
      prompt: s.prompt,
      negative_prompt: s.negativePrompt,
      image_url: s.imageUrl,
      reference_images: s.referenceImages ?? [],
      selected_image_task_id: s.selectedImageTaskId ?? null,
      selected_video_task_id: s.selectedVideoTaskId ?? null,
      continuity_mode: s.continuityMode,
      continuity_note: s.continuityNote,
      episode_break_before: s.episodeBreakBefore,
      episode_number: s.episodeNumber,
      episode_title: s.episodeTitle,
      episode_kind: s.episodeKind,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    })),
  )
}
