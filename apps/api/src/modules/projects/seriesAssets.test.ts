import { describe, expect, it } from 'vitest'
import {
  createProjectSchema,
  DEFAULT_SCRIPT_DIRECTION,
  type Principal,
  createAssetSchema,
} from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { ProjectRepository } from './repository.js'
import { ProjectService } from './service.js'

const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }

describe('series asset suggestions', () => {
  it('reads every saved episode, merges costume variants and atomically reuses a character', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new ProjectRepository(store)
    const service = new ProjectService(repository)
    const project = await repository.create(
      createProjectSchema.parse({ name: '全剧资产测试', contentType: 'short-drama', aspectRatio: '9:16' }),
      principal,
    )
    for (let index = 0; index < 21; index += 1) {
      await service.saveScriptEpisode(
        project.id,
        null,
        `资产：\n人物：林晚-${index ? '工作服版' : '标准版'}｜基础人物：林晚｜版本：${index ? '工作服版' : '标准版'}｜性别：女性｜年龄：25岁｜外形：黑色长发，人类女性｜服装：${index ? '白色大褂' : '蓝色衬衫'}\n人物：顾客${index}｜外形：人类男性\n场景：诊所${index}｜布局：左侧木门，靠墙药柜\n服装：白色大褂\n正文：\n场次：S01｜诊所｜日｜内景｜20秒\n林晚说：“请坐。”`,
        principal,
      )
    }
    const result = await service.suggestScriptAssets(
      project.id,
      '',
      DEFAULT_SCRIPT_DIRECTION,
      principal,
      undefined,
      undefined,
      'fast',
    )
    expect(result.assets.filter((asset) => asset.kind === 'character')).toHaveLength(22)
    expect(result.assets.some((asset) => asset.kind === 'costume')).toBe(false)
    const character = result.assets.find((asset) => asset.name === '林晚')!
    expect(character.attributes.type).toBe('character')
    if (character.attributes.type !== 'character') throw new Error('missing character')
    expect(character.attributes.appearanceVariants.map((item) => item.name)).toEqual([
      '林晚-标准版',
      '林晚-工作服版',
    ])
    const input = createAssetSchema.parse({ ...character, reuseExisting: true, sourceMode: 'generate' })
    const [first, second] = await Promise.all([
      service.createAsset(project.id, input, principal),
      service.createAsset(project.id, input, principal),
    ])
    expect(first.id).toBe(second.id)
    expect((await service.workspace(project.id, principal)).assets).toHaveLength(1)
    const rescanned = await service.suggestScriptAssets(
      project.id,
      '',
      DEFAULT_SCRIPT_DIRECTION,
      principal,
      undefined,
      undefined,
      'fast',
    )
    expect(rescanned.assets.some((asset) => asset.name === '林晚')).toBe(false)
  })
})

it('does not interpret surnames and clothing motifs as an animal species', async () => {
  const store = new AppStore(null)
  await store.initialize()
  const service = new ProjectService(new ProjectRepository(store))
  const project = await service.create(
    createProjectSchema.parse({ name: '人类身份', contentType: 'short-drama', aspectRatio: '9:16' }),
    principal,
  )
  const result = await service.suggestScriptAssets(
    project.id,
    '资产：\n人物：马宁｜外形：黑色短发，灰色西服\n人物：林晚｜外形：女性，胸前别着猫咪胸针\n人物：小白｜物种：狐狸｜外形：白色皮毛，四足行走\n正文：\n场次：S01｜角色：马宁、林晚、小白',
    DEFAULT_SCRIPT_DIRECTION,
    principal,
    undefined,
    undefined,
    'fast',
  )
  expect(result.assets.find((item) => item.name === '马宁')?.attributes).toMatchObject({
    subjectType: 'human',
  })
  expect(result.assets.find((item) => item.name === '林晚')?.attributes).toMatchObject({
    subjectType: 'human',
  })
  expect(result.assets.find((item) => item.name === '小白')?.attributes).toMatchObject({
    subjectType: 'animal',
  })
})
