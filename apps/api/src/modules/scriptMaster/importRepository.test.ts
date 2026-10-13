import { beforeEach, describe, expect, it } from 'vitest'
import {
  createProjectSchema,
  scriptMasterImportRequestSchema,
  type Principal,
  type ScriptMasterImportRequest,
} from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { ProjectRepository } from '../projects/repository.js'
import { ScriptMasterImportRepository } from './importRepository.js'

const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
let store: AppStore
let projects: ProjectRepository
let imports: ScriptMasterImportRepository
let target: string
beforeEach(async () => {
  store = new AppStore(null)
  await store.initialize()
  projects = new ProjectRepository(store)
  target = (await projects.create(createProjectSchema.parse({ name: '批量导入测试' }), principal)).id
  imports = new ScriptMasterImportRepository(store)
})
function payload(overrides: Record<string, unknown> = {}) {
  return scriptMasterImportRequestSchema.parse({
    contractVersion: 'script_master_delivery.v2',
    targetProjectId: target,
    sourceProjectId: 'independent-project',
    sourceRevision: 1,
    idempotencyKey: 'import-test-1',
    episodes: [
      {
        sourceEpisodeId: 'episode-1',
        episodeNumber: 1,
        title: '重逢',
        content: '林岚在院子重逢。',
        shots: [
          { sourceShotId: 'shot-1', title: '重逢', framing: '中景', duration: 5, prompt: '林岚走进院子。' },
        ],
      },
    ],
    assets: [{ sourceAssetId: 'character:林岚', kind: 'character', name: '林岚', description: '青年' }],
    ...overrides,
  })
}
describe('bulk Script Master import', () => {
  it('previews without writes, detects intervening edits, and replays committed requests', async () => {
    const input = payload()
    const before = store.read((s) => JSON.stringify(s))
    const preview = await imports.preview(input, principal)
    expect(preview.episodes[0]?.status).toBe('new')
    expect(preview.assets.imported).toBe(1)
    expect(store.read((s) => JSON.stringify(s))).toBe(before)
    const checked = payload({ expectedTargetChecksum: preview.targetChecksum })
    const receipt = await imports.import(checked, principal)
    expect(await imports.import(checked, principal)).toEqual(receipt)
    const unchanged = await imports.preview(payload({ idempotencyKey: 'next-preview' }), principal)
    expect(unchanged.episodes[0]?.status).toBe('unchanged')
    await store.mutate((state) => {
      state.shots.find((shot) => shot.projectId === target)!.prompt = '主站刚编辑的镜头'
    })
    const afterEdit = store.read((s) => JSON.stringify(s))
    await expect(
      imports.import(
        payload({ idempotencyKey: 'stale-preview', expectedTargetChecksum: unchanged.targetChecksum }),
        principal,
      ),
    ).rejects.toMatchObject({ code: 'IMPORT_TARGET_CHANGED' })
    expect(store.read((s) => JSON.stringify(s))).toBe(afterEdit)
  })
  it('returns protected storyboard conflicts and hides other accounts in preview', async () => {
    await imports.import(payload(), principal)
    const input = payload({ idempotencyKey: 'preview-revision' })
    input.episodes[0]!.content = '修订后的新剧情'
    delete input.episodes[0]!.shots
    const preview = await imports.preview(input, principal)
    expect(preview.episodes[0]).toMatchObject({ status: 'conflict', code: 'IMPORT_STORYBOARD_REQUIRED' })
    await expect(imports.preview(input, { ...principal, tenantId: 'another-tenant' })).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
    })
    await expect(imports.preview(input, { ...principal, userId: 'another-user' })).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
    })
  })
  it('imports a complete workspace without creating generation tasks or charging credits', async () => {
    const ledger = store.read((s) => structuredClone(s.ledger))
    const tasks = store.read((s) => s.tasks.length)
    expect(await imports.import(payload(), principal)).toMatchObject({
      importedEpisodes: 1,
      importedAssets: 1,
      importedShots: 1,
    })
    const workspace = (await projects.workspace(target, principal))!
    expect(workspace.shots[0]?.scriptEpisodeId).toBe(workspace.scriptEpisodes[0]?.id)
    expect(workspace.assets[0]?.attributes).toMatchObject({
      subjectType: 'human',
      gender: 'unspecified',
      faceStatus: 'pending',
    })
    expect(store.read((s) => s.ledger)).toEqual(ledger)
    expect(store.read((s) => s.tasks.length)).toBe(tasks)
  })
  it('normalizes project context before assets and shots can consume it', async () => {
    const input = payload({
      projectContext: {
        title: '批量导入测试',
        synopsis: '剧本大师整理后的故事梗概。',
        episodeDurationSeconds: 60,
      },
    })
    expect(await imports.import(input, principal)).toMatchObject({ importedEpisodes: 1 })
    expect((await projects.workspace(target, principal))!.project).toMatchObject({
      name: '批量导入测试',
      synopsis: '剧本大师整理后的故事梗概。',
      episodeDurationSeconds: 60,
    })
  })
  it('fills an empty project synopsis from the first imported episode when no context is supplied', async () => {
    expect(await imports.import(payload(), principal)).toMatchObject({ importedEpisodes: 1 })
    expect((await projects.workspace(target, principal))!.project.synopsis).toBe('林岚在院子重逢。')
  })
  it('rejects project title or duration drift without partially writing the delivery', async () => {
    await expect(
      imports.import(payload({ projectContext: { title: '漂移标题' } }), principal),
    ).rejects.toMatchObject({
      code: 'IMPORT_PROJECT_TITLE_MISMATCH',
    })
    await expect(
      imports.import(payload({ projectContext: { episodeDurationSeconds: 75 } }), principal),
    ).rejects.toMatchObject({
      code: 'IMPORT_PROJECT_DURATION_MISMATCH',
    })
    expect((await projects.workspace(target, principal))!.scriptEpisodes).toHaveLength(0)
  })
  it('serializes duplicate delivery and keeps IDs stable across revisions', async () => {
    const input = payload()
    const [a, b] = await Promise.all([imports.import(input, principal), imports.import(input, principal)])
    expect(b).toEqual(a)
    const original = (await projects.workspace(target, principal))!
    const next = payload({ sourceRevision: 2, idempotencyKey: 'import-test-2' })
    next.episodes[0]!.content = '修订正文'
    expect(await imports.import(next, principal)).toMatchObject({
      importedEpisodes: 0,
      updatedEpisodes: 1,
      importedShots: 0,
      importedAssets: 0,
    })
    const updated = (await projects.workspace(target, principal))!
    expect(updated.scriptEpisodes).toHaveLength(1)
    expect(updated.scriptEpisodes[0]?.id).toBe(original.scriptEpisodes[0]?.id)
    expect(updated.shots).toHaveLength(1)
  })
  it('rejects changed content with the same key and lower revisions', async () => {
    await imports.import(payload({ sourceRevision: 3 }), principal)
    await expect(imports.import(payload(), principal)).rejects.toMatchObject({
      code: 'IMPORT_IDEMPOTENCY_CONFLICT',
    })
    await expect(
      imports.import(payload({ idempotencyKey: 'import-old-1' }), principal),
    ).rejects.toMatchObject({ code: 'IMPORT_STALE_REVISION' })
  })
  it('disambiguates repeated titles for distinct episodes and rejects repeated bodies', async () => {
    const first = payload()
    first.episodes[0]!.content = '林岚在院子与调查员重逢，并核对封锁圈内的数字记录与审核权限。'
    await imports.import(first, principal)
    const second = payload({
      sourceRevision: 2,
      idempotencyKey: 'import-distinct-episodes',
      episodes: [
        {
          ...first.episodes[0]!,
          sourceEpisodeId: 'episode-2',
          episodeNumber: 2,
          content: '林岚在档案室核对新的录音。',
        },
      ],
    })
    await imports.import(second, principal)
    expect((await projects.workspace(target, principal))!.scriptEpisodes.map((item) => item.title)).toEqual([
      '重逢',
      '重逢（2）',
    ])
    const duplicate = payload({
      sourceRevision: 3,
      idempotencyKey: 'import-duplicate-body',
      episodes: [
        {
          ...first.episodes[0]!,
          sourceEpisodeId: 'episode-3',
          episodeNumber: 3,
        },
      ],
    })
    await expect(imports.import(duplicate, principal)).rejects.toMatchObject({
      code: 'IMPORT_EPISODE_DUPLICATE_CONTENT',
    })
  })
  it('validates the entire batch before writing any earlier episode', async () => {
    await projects.saveScriptEpisode(target, null, '用户原稿', principal)
    const input = payload()
    input.episodes.unshift({ ...input.episodes[0]!, sourceEpisodeId: 'new-episode', episodeNumber: 2 })
    await expect(imports.import(input, principal)).rejects.toMatchObject({ code: 'IMPORT_EPISODE_CONFLICT' })
    const workspace = (await projects.workspace(target, principal))!
    expect(workspace.scriptEpisodes).toHaveLength(1)
    expect(workspace.assets).toHaveLength(0)
  })
  it('preserves confirmed character and registered face on later imports', async () => {
    await imports.import(payload(), principal)
    const asset = (await projects.workspace(target, principal))!.assets[0]!
    await projects.updateAsset(
      target,
      asset.id,
      { status: 'confirmed', imageUrl: '/saved-face.png' },
      principal,
    )
    const updated = payload({ idempotencyKey: 'import-new-1', sourceRevision: 2 })
    updated.assets[0]!.description = '新版描述'
    expect(await imports.import(updated, principal)).toMatchObject({ preservedAssets: 1, updatedAssets: 0 })
    expect((await projects.workspace(target, principal))!.assets[0]!.imageUrl).toBe('/saved-face.png')
  })
  it('does not overwrite another user or organization even with a matching receipt', async () => {
    await imports.import(payload(), principal)
    await expect(imports.import(payload(), { ...principal, userId: 'someone-else' })).rejects.toMatchObject({
      statusCode: 404,
    })
    await expect(imports.import(payload(), { ...principal, tenantId: 'another-org' })).rejects.toMatchObject({
      statusCode: 404,
    })
  })
  it('rejects standalone project references before touching the target workspace', async () => {
    const standalone = 'sm-standalone-isolated'
    const nested = { ...payload(), metadata: { sourceProjectId: standalone } }
    const cases: ScriptMasterImportRequest[] = [
      payload({ targetProjectId: standalone }),
      payload({ sourceProjectId: standalone }),
      nested,
    ]

    for (const input of cases) {
      await expect(imports.import(input, principal)).rejects.toMatchObject({
        statusCode: 403,
        code: 'PROJECT_SURFACE_DENIED',
      })
    }
    expect((await projects.workspace(target, principal))?.scriptEpisodes).toHaveLength(0)
  })
  it('supports asset-only import and rejects duplicate source identifiers', async () => {
    expect(await imports.import(payload({ episodes: [] }), principal)).toMatchObject({
      importedEpisodes: 0,
      importedAssets: 1,
    })
    const input = payload()
    expect(
      scriptMasterImportRequestSchema.safeParse({ ...input, assets: [...input.assets, ...input.assets] })
        .success,
    ).toBe(false)
  })
  it('folds linked costumes into one character wardrobe and keeps rich variant details', async () => {
    const input = payload({
      idempotencyKey: 'import-wardrobe-1',
      assets: [
        {
          sourceAssetId: 'character:maya',
          kind: 'character',
          name: 'Maya',
          description: '固定面部基准、黑色短发、左眉疤痕与运动体态。',
          prompt:
            'Maya character turnaround, fixed face, short black hair, athletic body, cinematic realism.',
          characterRef: 'character.maya',
        },
        {
          sourceAssetId: 'costume:maya:rain',
          kind: 'costume',
          name: '雨夜防护服',
          description:
            '深灰防水长外套，橙色反光条，湿润褶皱，泥点集中在下摆，保留 Maya 的面部、发型、体态与左眉疤痕。',
          prompt:
            'Detailed rain protection outfit for Maya: charcoal waterproof coat, orange reflective tape, wet fabric folds, muddy hem, night rain highlights, preserve the same face, hair, body and brow scar.',
          characterRef: 'character.maya',
          characterAssetId: 'character:maya',
          appearanceVariantId: 'appearance.maya.rain',
          appearanceVariantName: '雨夜防护服',
          continuityNote: '从第1场进入雨夜后启用，离开街区前保持湿润和泥点状态。',
          sceneNumbers: [1],
        },
      ],
    })
    expect(await imports.import(input, principal)).toMatchObject({ importedAssets: 1 })
    let workspace = (await projects.workspace(target, principal))!
    expect(workspace.assets.filter((asset) => asset.kind === 'costume')).toHaveLength(0)
    expect(workspace.assets.filter((asset) => asset.kind === 'character')).toHaveLength(1)
    const character = workspace.assets.find((asset) => asset.kind === 'character')!
    expect(character.attributes).toMatchObject({
      type: 'character',
      appearanceVariants: [
        {
          name: 'Maya-雨夜防护服版本',
          prompt: expect.stringContaining('waterproof coat'),
          continuityNote: expect.stringContaining('第1场'),
          sceneNumbers: [1],
        },
      ],
    })
    await projects.updateAsset(
      target,
      character.id,
      { status: 'confirmed', imageUrl: '/maya-face.png' },
      principal,
    )

    const second = payload({
      sourceRevision: 2,
      idempotencyKey: 'import-wardrobe-2',
      assets: [
        ...input.assets,
        {
          sourceAssetId: 'costume:maya:formal',
          kind: 'costume',
          name: '正式礼服',
          description: '黑色羊毛礼服，窄肩剪裁与银色领针，保持同一张脸和体型。',
          prompt:
            'Detailed formal black wool suit for the same Maya identity, narrow shoulders, silver collar pin, studio key light.',
          characterAssetId: 'character:maya',
          appearanceVariantId: 'appearance.maya.formal',
          appearanceVariantName: '正式礼服',
        },
      ],
    })
    await imports.import(second, principal)
    workspace = (await projects.workspace(target, principal))!
    expect(workspace.assets.filter((asset) => asset.kind === 'character')).toHaveLength(1)
    const importedCharacter = workspace.assets.find((asset) => asset.kind === 'character')!
    expect(importedCharacter.imageUrl).toBe('/maya-face.png')
    expect(importedCharacter.status).toBe('confirmed')
    expect(importedCharacter.attributes).toMatchObject({
      appearanceVariants: expect.arrayContaining([
        expect.objectContaining({ name: 'Maya-正式礼服版本' }),
        expect.objectContaining({ name: 'Maya-雨夜防护服版本' }),
      ]),
    })

    const refined = payload({
      sourceRevision: 3,
      idempotencyKey: 'import-wardrobe-3',
      assets: [
        input.assets[0],
        {
          ...input.assets[1],
          description:
            '更新后的深灰防水长外套，增加可拆卸内胆、橙色反光条和肩部防护片；湿润褶皱、下摆泥点与 Maya 的脸部、发型、体态和左眉疤痕必须保持一致。',
          prompt:
            'Refined production design for Maya rain protection outfit: charcoal waterproof long coat, detachable insulated liner, orange reflective tape, shoulder guards, wet fabric folds, muddy hem, preserve the same face, hair, body and brow scar in every shot.',
          continuityNote:
            '第1场至第4场持续穿着；雨中保持表面湿润、下摆泥点和左肩划痕，进入室内后仅降低湿度，不更换人物身份。',
          sceneNumbers: [1, 2, 3, 4],
        },
      ],
    })
    await imports.import(refined, principal)
    const refinedCharacter = (await projects.workspace(target, principal))!.assets.find(
      (asset) => asset.kind === 'character',
    )!
    const refinedVariant = refinedCharacter.attributes.appearanceVariants.find(
      (variant) => variant.id === 'appearance.maya.rain',
    )!
    expect(refinedVariant).toMatchObject({
      description: expect.stringContaining('可拆卸内胆'),
      prompt: expect.stringContaining('detachable insulated liner'),
      continuityNote: expect.stringContaining('第1场至第4场'),
      sceneNumbers: [1, 2, 3, 4],
    })
  })
  it('normalizes legacy suffixed character records into the base identity', async () => {
    const input = payload({
      idempotencyKey: 'import-legacy-wardrobe-1',
      assets: [
        {
          sourceAssetId: 'character:maya:base',
          kind: 'character',
          name: 'Maya',
          description: '固定身份与脸部基准。',
          prompt: 'Maya fixed identity portrait.',
        },
        {
          sourceAssetId: 'character:maya:field',
          kind: 'character',
          name: 'Maya-行动服版本',
          description: '深色行动服、战术靴。',
          prompt: 'Maya in a dark field outfit and tactical boots.',
        },
      ],
    })
    await imports.import(input, principal)
    const workspace = (await projects.workspace(target, principal))!
    expect(workspace.assets.filter((asset) => asset.kind === 'character')).toHaveLength(1)
    expect(workspace.assets[0]?.attributes).toMatchObject({
      appearanceVariants: [expect.objectContaining({ name: 'Maya-行动服版本' })],
    })
  })
  it('resolves wardrobe references through base character asset aliases', async () => {
    const input = payload({
      idempotencyKey: 'import-wardrobe-alias-1',
      episodes: [],
      assets: [
        {
          sourceAssetId: 'character:maya:base',
          kind: 'character',
          name: 'Maya',
          description: '固定人物身份与脸部基准。',
          prompt: 'Maya fixed identity portrait with stable face and body reference.',
          baseCharacterAssetId: 'stable-character-maya',
        },
        {
          sourceAssetId: 'costume:maya:field',
          kind: 'costume',
          name: '行动服',
          description: '深色防护夹克、战术靴和磨损袖口，保持 Maya 的脸部、发型和体态。',
          prompt:
            'Detailed field outfit for the same Maya identity: dark protective jacket, tactical boots, worn cuffs, preserve the same face, hair and body.',
          characterAssetId: 'stable-character-maya',
          appearanceVariantId: 'appearance.maya.field.alias',
          appearanceVariantName: '行动服',
        },
      ],
    })
    await imports.import(input, principal)
    const workspace = (await projects.workspace(target, principal))!
    expect(workspace.assets.filter((asset) => asset.kind === 'character')).toHaveLength(1)
    expect(workspace.assets.filter((asset) => asset.kind === 'costume')).toHaveLength(0)
    expect(workspace.assets[0]?.attributes).toMatchObject({
      appearanceVariants: [expect.objectContaining({ name: 'Maya-行动服版本' })],
    })
  })
  it('resolves a costume-only revision through the deterministic base character id', async () => {
    const initial = payload({
      idempotencyKey: 'import-wardrobe-incremental-1',
      episodes: [],
      assets: [
        {
          sourceAssetId: 'character:maya',
          kind: 'character',
          name: 'Maya',
          description: '固定人物身份与脸部基准。',
          prompt: 'Maya fixed identity portrait with stable face and body reference.',
        },
        {
          sourceAssetId: 'costume:maya:rain',
          kind: 'costume',
          name: '雨夜防护服',
          description: '深灰防水外套。',
          prompt: 'Maya rain protection outfit.',
          characterAssetId: 'character:maya',
          appearanceVariantId: 'appearance.maya.rain.incremental',
          appearanceVariantName: '雨夜防护服',
        },
      ],
    })
    await imports.import(initial, principal)

    const revision = payload({
      sourceRevision: 2,
      idempotencyKey: 'import-wardrobe-incremental-2',
      episodes: [],
      assets: [
        {
          sourceAssetId: 'costume:maya:rain',
          kind: 'costume',
          name: '雨夜防护服',
          description: '更新后的深灰防水外套，湿润褶皱和泥点状态。',
          prompt: 'Refined Maya rain protection outfit with wet folds and muddy hem.',
          characterAssetId: 'character:maya',
          appearanceVariantId: 'appearance.maya.rain.incremental',
          appearanceVariantName: '雨夜防护服',
        },
      ],
    })
    await imports.import(revision, principal)

    const workspace = (await projects.workspace(target, principal))!
    expect(workspace.assets.filter((asset) => asset.kind === 'character')).toHaveLength(1)
    expect(workspace.assets.filter((asset) => asset.kind === 'costume')).toHaveLength(0)
    expect(workspace.assets[0]?.attributes).toMatchObject({
      appearanceVariants: [
        expect.objectContaining({
          name: 'Maya-雨夜防护服版本',
          prompt: expect.stringContaining('Refined Maya'),
        }),
      ],
    })
  })
  it('keeps episode playback order when earlier episodes are imported later', async () => {
    const second = payload()
    second.episodes[0]!.episodeNumber = 2
    second.episodes[0]!.sourceEpisodeId = 'episode-2'
    await imports.import(second, principal)
    await imports.import(payload({ idempotencyKey: 'import-earlier-1' }), principal)
    const shots = (await projects.workspace(target, principal))!.shots.sort((a, b) => a.order - b.order)
    expect(shots.map((s) => s.episodeNumber)).toEqual([1, 2])
  })
  it('rejects changed scripts without current storyboards and preserves removed source shots', async () => {
    await imports.import(payload(), principal)
    const next = payload({ sourceRevision: 2, idempotencyKey: 'import-new-2' })
    next.episodes[0]!.content = '新版正文'
    delete next.episodes[0]!.shots
    await expect(imports.import(next, principal)).rejects.toMatchObject({
      code: 'IMPORT_STORYBOARD_REQUIRED',
    })
    next.episodes[0]!.shots = []
    await expect(imports.import(next, principal)).rejects.toMatchObject({
      code: 'IMPORT_SHOT_REMOVAL_CONFLICT',
    })
    expect((await projects.workspace(target, principal))!.scriptEpisodes[0]!.content).toBe('林岚在院子重逢。')
  })
  it('keeps selected video media when a newer storyboard changes a shot', async () => {
    await imports.import(payload(), principal)
    await store.mutate((state) => {
      state.shots.find((s) => s.projectId === target)!.selectedVideoTaskId = 'existing-video'
    })
    const next = payload({ sourceRevision: 2, idempotencyKey: 'import-new-3' })
    next.episodes[0]!.shots![0]!.prompt = '改为在门外等待'
    await expect(imports.import(next, principal)).rejects.toMatchObject({ code: 'IMPORT_SHOT_HAS_MEDIA' })
    expect((await projects.workspace(target, principal))!.shots[0]!.selectedVideoTaskId).toBe(
      'existing-video',
    )
  })
  it('adopts revised shot order and inserts new shots in place with correct continuity', async () => {
    const first = payload()
    const one = first.episodes[0]!.shots![0]!
    const two = { ...one, sourceShotId: 'shot-2', title: '门外' }
    first.episodes[0]!.shots!.push(two)
    await imports.import(first, principal)
    const next = payload({ sourceRevision: 2, idempotencyKey: 'reordered-import' })
    next.episodes[0]!.shots = [two, { ...one, sourceShotId: 'shot-3', title: '转身' }, one]
    await imports.import(next, principal)
    const shots = (await projects.workspace(target, principal))!.shots.sort((a, b) => a.order - b.order)
    expect(shots.map((s) => s.title)).toEqual(['门外', '转身', '重逢'])
    expect(shots.map((s) => s.continuityMode)).toEqual(['independent', 'continue', 'continue'])
    expect(shots.map((s) => s.episodeBreakBefore)).toEqual([true, false, false])
    expect(shots.map((s) => s.order)).toEqual([1, 2, 3])
  })
})
