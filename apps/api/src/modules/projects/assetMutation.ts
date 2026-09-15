import type { Asset, Principal, UpdateAsset } from '@seqora/contracts'
import type { PoolClient } from 'pg'
import type { AccountDatabase } from '../../infra/postgres.js'
import { mergeAssetAttributes } from './assetAttributesMerge.js'
import { assetColumns, assetFromRow, type AssetRow } from './repositoryData.js'

export type AssetChange = UpdateAsset | ((current: Asset) => UpdateAsset)

export async function changeAssetInDatabase(
  database: AccountDatabase,
  projectId: string,
  assetId: string,
  change: AssetChange,
  principal: Principal,
  findWritableProject: (client: PoolClient, projectId: string, principal: Principal) => Promise<unknown>,
  touchProject: (
    client: PoolClient,
    projectId: string,
    tenantId: string,
    updatedAt: string,
  ) => Promise<unknown>,
): Promise<Asset | null> {
  return database.transaction(async (client) => {
    const project = await findWritableProject(client, projectId, principal)
    if (!project) return null

    const currentResult = await client.query<AssetRow>(
      `
        SELECT ${assetColumns}
        FROM assets
        WHERE id = $1 AND project_id = $2 AND tenant_id = $3
        FOR UPDATE
        `,
      [assetId, projectId, principal.tenantId],
    )
    const current = currentResult.rows[0] ? assetFromRow(currentResult.rows[0]) : null
    if (!current) return null
    const input = typeof change === 'function' ? change(current) : change
    if (input.attributes && input.attributes.type !== current.kind) return null

    const updated: Asset = {
      ...current,
      sourceMode: input.sourceMode ?? current.sourceMode,
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      prompt: input.prompt ?? current.prompt,
      promptMode: input.promptMode ?? current.promptMode,
      customPromptMode: input.customPromptMode ?? current.customPromptMode,
      customPrompt: input.customPrompt ?? current.customPrompt,
      negativePrompt: input.negativePrompt ?? current.negativePrompt,
      references: input.references ?? current.references,
      attributes:
        typeof change === 'function'
          ? (input.attributes ?? current.attributes)
          : mergeAssetAttributes(current, input.attributes),
      imageUrl: input.imageUrl === undefined ? current.imageUrl : input.imageUrl,
      status: input.status ?? current.status,
      updatedAt: new Date().toISOString(),
    }
    const updatedResult = await client.query<AssetRow>(
      `
        UPDATE assets
        SET
          source_mode = $4,
          name = $5,
          description = $6,
          prompt = $7,
          prompt_mode = $8,
          custom_prompt_mode = $9,
          custom_prompt = $10,
          negative_prompt = $11,
          reference_items = $12::jsonb,
          attributes = $13::jsonb,
          image_url = $14,
          status = $15,
          updated_at = $16
        WHERE id = $1 AND project_id = $2 AND tenant_id = $3
        RETURNING ${assetColumns}
        `,
      [
        assetId,
        projectId,
        principal.tenantId,
        updated.sourceMode,
        updated.name,
        updated.description,
        updated.prompt,
        updated.promptMode,
        updated.customPromptMode,
        updated.customPrompt,
        updated.negativePrompt,
        JSON.stringify(updated.references),
        JSON.stringify(updated.attributes),
        updated.imageUrl,
        updated.status,
        updated.updatedAt,
      ],
    )
    await touchProject(client, projectId, principal.tenantId, updated.updatedAt)
    return updatedResult.rows[0] ? assetFromRow(updatedResult.rows[0]) : null
  })
}
