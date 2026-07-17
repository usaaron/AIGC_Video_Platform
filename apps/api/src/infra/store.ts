import type {
  Asset,
  GenerationTask,
  LedgerEntry,
  MediaKind,
  Plan,
  Project,
  Role,
  Shot,
} from '@seqora/contracts'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { hashPassword } from '../core/auth/password.js'

export type StoredUser = {
  id: string
  email: string
  name: string
  passwordHash: string
  tenantId: string
  roles: Role[]
  plan: Plan
  credits: number
}

export type StoredMedia = {
  id: string
  projectId: string
  tenantId: string
  kind: MediaKind
  name: string
  contentType: string
  size: number
  storageKey: string
  createdAt: string
}

export type AppState = {
  users: StoredUser[]
  projects: Project[]
  assets: Asset[]
  shots: Shot[]
  tasks: GenerationTask[]
  ledger: LedgerEntry[]
  media: StoredMedia[]
}

export class AppStore {
  private state!: AppState
  private writeQueue = Promise.resolve()

  constructor(private readonly filePath: string | null) {}

  async initialize(): Promise<void> {
    if (this.filePath) {
      try {
        this.state = normalizeState(JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<AppState>)
        await this.persist()
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') throw error
      }
    }

    this.state = createSeedState()
    await this.persist()
  }

  read<T>(reader: (state: Readonly<AppState>) => T): T {
    return structuredClone(reader(this.state))
  }

  async mutate<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    let result!: T
    this.writeQueue = this.writeQueue.then(async () => {
      result = await mutator(this.state)
      await this.persist()
    })
    await this.writeQueue
    return structuredClone(result)
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
    await rename(temporary, this.filePath)
  }
}

function createSeedState(): AppState {
  const now = new Date().toISOString()
  const tenantId = 'tenant-seqora-demo'
  const creatorId = 'user-creator'
  const projectId = 'project-midnight-film'

  return {
    users: [
      {
        id: creatorId,
        email: 'creator@seqora.local',
        name: '林夏',
        passwordHash: hashPassword('Creator123!'),
        tenantId,
        roles: ['creator'],
        plan: 'free',
        credits: 286,
      },
      {
        id: 'user-admin',
        email: 'admin@seqora.local',
        name: '平台管理员',
        passwordHash: hashPassword('Admin123!'),
        tenantId,
        roles: ['admin'],
        plan: 'member',
        credits: 1_000,
      },
    ],
    projects: [
      {
        id: projectId,
        tenantId,
        ownerId: creatorId,
        name: '午夜胶片',
        contentType: 'short-drama',
        aspectRatio: '9:16',
        status: 'producing',
        synopsis: '雨夜，一卷能预见明天的胶片，正等待被打开。',
        script: DEFAULT_SCRIPT,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
    assets: seedAssets(projectId, tenantId, now),
    shots: seedShots(projectId, tenantId, now),
    tasks: [],
    media: [],
    ledger: [
      {
        id: 'ledger-initial',
        userId: creatorId,
        tenantId,
        amount: 286,
        balance: 286,
        type: 'grant',
        description: '新用户体验积分',
        createdAt: now,
      },
    ],
  }
}

function seedAssets(projectId: string, tenantId: string, now: string): Asset[] {
  return [
    [
      'asset-lin',
      'character',
      '林夏',
      '纪录片导演 · 28岁',
      '东亚女性，短发，深色风衣，透明雨伞，克制而敏锐，电影感全身照',
      '/demo/lin.jpg',
    ],
    [
      'asset-zhou',
      'character',
      '周野',
      '神秘信使 · 32岁',
      '东亚男性，黑色旧夹克，雨夜逆光，疲惫但坚定，电影人物定妆照',
      '/demo/zhou.jpg',
    ],
    [
      'asset-station',
      'scene',
      '三号站台',
      '主场景',
      '废弃海边火车站，雨夜，湿润铁轨，远处暖色信号灯，宽银幕电影构图',
      '/demo/station.jpg',
    ],
    [
      'asset-room',
      'scene',
      '旧候车室',
      '室内',
      '老式候车室，木质长椅，昏暗壁灯，窗外大雨，悬疑电影氛围',
      '/demo/room.jpg',
    ],
    ['asset-rain', 'audio', '雨夜站台', '环境音 · 48秒', '密集雨声，远处列车低鸣，偶尔金属震动', null],
    ['asset-train', 'audio', '幽灵列车', '环境音 · 22秒', '由远及近的老式列车进站声，低频压迫感', null],
  ].map(([id, rawKind, name, description, prompt, imageUrl]) => {
    const kind = rawKind as Asset['kind']
    return {
      id: id as string,
      projectId,
      tenantId,
      kind,
      sourceMode: 'generate' as const,
      name: name as string,
      description: description as string,
      prompt: prompt as string,
      promptMode: 'standard' as const,
      customPromptMode: 'append' as const,
      customPrompt: '',
      negativePrompt: '',
      references: [],
      attributes: defaultAssetAttributes(kind),
      imageUrl: imageUrl as string | null,
      status: 'confirmed' as const,
      createdAt: now,
      updatedAt: now,
    }
  })
}

export function defaultAssetAttributes(kind: Asset['kind']): Asset['attributes'] {
  if (kind === 'character') {
    return {
      type: 'character',
      subjectType: 'human',
      gender: 'female',
      ageGroup: 'young',
      exactAge: null,
      species: '',
      anthropomorphic: false,
      visualStyle: 'cinematic-cg',
      framing: 'full',
      bodyType: 'balanced',
      background: 'solid',
      faceStatus: 'pending',
      bodyStatus: 'pending',
      faceReference: null,
      bodyReference: null,
      legStretch: false,
      turnaround: false,
      turnaroundLayout: 'sheet',
    }
  }
  if (kind === 'scene') {
    return {
      type: 'scene',
      space: 'exterior',
      sceneType: 'street',
      era: 'modern',
      time: 'night',
      weather: 'clear',
      mood: 'mystery',
      camera: 'wide',
      visualStyle: 'cinematic-cg',
      emptyScene: true,
      activitySpace: true,
    }
  }
  if (kind === 'prop') {
    return {
      type: 'prop',
      category: 'daily',
      material: 'mixed',
      condition: 'used',
      view: 'front',
      background: 'solid',
      visualStyle: 'cinematic-cg',
    }
  }
  if (kind === 'costume') {
    return {
      type: 'costume',
      audience: 'unisex',
      category: 'daily',
      season: 'all-season',
      design: 'minimal',
      presentation: 'flat',
      visualStyle: 'cinematic-cg',
      turnaround: false,
    }
  }
  return {
    type: 'audio',
    audioType: 'ambience',
    gender: 'unspecified',
    ageGroup: 'young',
    emotion: 'neutral',
    tone: 'warm',
    speed: 'normal',
    language: 'mandarin',
    duration: 15,
    loop: false,
  }
}

function seedShots(projectId: string, tenantId: string, now: string): Shot[] {
  return [
    ['shot-1', 1, '雨夜空镜', '大全景', 4, '临港市雨夜，镜头缓慢推向废弃火车站，冷色调', '/demo/rain.jpg'],
    ['shot-2', 2, '林夏抵达', '中近景', 5, '林夏撑透明雨伞走入站台，侧逆光，雨滴清晰', '/demo/lin.jpg'],
    ['shot-3', 3, '等待', '广角', 4, '空旷站台，人物位于画面右侧，信号灯闪烁', '/demo/station.jpg'],
    ['shot-4', 4, '周野出现', '特写', 4, '周野从阴影走出，把旧铁盒放在长椅上', '/demo/zhou.jpg'],
    ['shot-5', 5, '打开铁盒', '俯拍', 5, '双手打开生锈铁盒，里面是一卷旧胶片，暖光', '/demo/room.jpg'],
  ].map(([id, order, title, framing, duration, prompt, imageUrl]) => ({
    id: id as string,
    projectId,
    tenantId,
    order: order as number,
    title: title as string,
    framing: framing as string,
    duration: duration as number,
    prompt: prompt as string,
    imageUrl: imageUrl as string,
    createdAt: now,
    updatedAt: now,
  }))
}

function normalizeState(input: Partial<AppState>): AppState {
  const assets = (input.assets ?? []).map((stored) => {
    const legacy = stored as Omit<Partial<Asset>, 'kind'> & {
      id: string
      projectId: string
      tenantId: string
      kind: Asset['kind'] | 'sound'
      name: string
      description: string
      prompt: string
      imageUrl: string | null
      status: Asset['status']
      createdAt: string
      updatedAt: string
    }
    const kind: Asset['kind'] = legacy.kind === 'sound' ? 'audio' : legacy.kind
    return {
      ...legacy,
      kind,
      sourceMode: legacy.sourceMode ?? 'generate',
      promptMode: legacy.promptMode ?? 'standard',
      customPromptMode: legacy.customPromptMode ?? 'append',
      customPrompt: legacy.customPrompt ?? '',
      negativePrompt: legacy.negativePrompt ?? '',
      references: legacy.references ?? [],
      attributes:
        legacy.attributes?.type === kind
          ? { ...defaultAssetAttributes(kind), ...legacy.attributes }
          : defaultAssetAttributes(kind),
    } as Asset
  })
  const tasks = (input.tasks ?? []).map((task) => ({
    ...task,
    prompt: task.prompt ?? '',
    negativePrompt: task.negativePrompt ?? '',
    provider: task.provider ?? 'local',
    model: task.model ?? null,
    metadata: task.metadata ?? {},
    outputs: task.outputs ?? [],
  }))
  return {
    users: input.users ?? [],
    projects: input.projects ?? [],
    assets,
    shots: input.shots ?? [],
    tasks,
    ledger: input.ledger ?? [],
    media: input.media ?? [],
  }
}

const DEFAULT_SCRIPT = `雨夜，临港市旧火车站。

林夏撑着一把透明雨伞，站在停运多年的三号站台。她收到一封没有署名的信，约她午夜来取回父亲留下的胶片。

钟声响起，周野从候车室的阴影里走出。他把一只旧铁盒放到长椅上，却提醒林夏：胶片记录的并不是过去，而是明天。

远处传来列车进站声。空无一物的铁轨上，灯光穿透雨幕。林夏打开铁盒，看见胶片第一格正是此刻的自己。`
