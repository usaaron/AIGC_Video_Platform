import type { Asset, Shot } from '@seqora/contracts'
import { hashPassword } from '../core/auth/password.js'
import { defaultAssetAttributes } from './storeNormalization.js'
import type { AppState } from './store.js'
export type BootstrapUsers = {
  memberName?: string
  memberEmail: string
  memberPassword: string
  ownerName?: string
  ownerEmail: string
  ownerPassword: string
  superAdminName?: string
  superAdminEmail: string
  superAdminPassword: string
  adminName?: string
  adminEmail: string
  adminPassword: string
}

export const developmentBootstrapUsers: BootstrapUsers = {
  memberName: '默认 C 端用户',
  memberEmail: 'member@seqora.local',
  memberPassword: 'MemberPassword123!',
  ownerName: '平台所有者',
  ownerEmail: 'owner@seqora.local',
  ownerPassword: 'OwnerPassword123!',
  superAdminName: '超级管理员',
  superAdminEmail: 'superadmin@seqora.local',
  superAdminPassword: 'SuperAdmin123!',
  adminName: '平台管理员',
  adminEmail: 'admin@seqora.local',
  adminPassword: 'Admin123!',
}

export function createSeedState(bootstrapUsers: BootstrapUsers, demoWorkspace: boolean): AppState {
  const now = new Date().toISOString()
  const tenantId = 'tenant-seqora-demo'
  const memberId = 'user-member'
  const ownerId = 'user-owner'
  const superAdminId = 'user-super-admin'
  const projectId = 'project-midnight-film'

  return {
    users: [
      {
        id: memberId,
        email: bootstrapUsers.memberEmail.toLowerCase(),
        name: bootstrapUsers.memberName ?? '默认 C 端用户',
        passwordHash: hashPassword(bootstrapUsers.memberPassword),
        tenantId,
        roles: ['member'],
        plan: 'free',
        credits: 286,
        passwordResetRequired: false,
        emailVerified: true,
      },
      {
        id: ownerId,
        email: bootstrapUsers.ownerEmail.toLowerCase(),
        name: bootstrapUsers.ownerName ?? '平台所有者',
        passwordHash: hashPassword(bootstrapUsers.ownerPassword),
        tenantId,
        roles: ['owner'],
        plan: 'member',
        credits: 1_000,
        passwordResetRequired: false,
        emailVerified: true,
      },
      {
        id: superAdminId,
        email: bootstrapUsers.superAdminEmail.toLowerCase(),
        name: bootstrapUsers.superAdminName ?? '超级管理员',
        passwordHash: hashPassword(bootstrapUsers.superAdminPassword),
        tenantId,
        roles: ['super_admin'],
        plan: 'member',
        credits: 1_000,
        passwordResetRequired: false,
        emailVerified: true,
      },
      {
        id: 'user-admin',
        email: bootstrapUsers.adminEmail.toLowerCase(),
        name: bootstrapUsers.adminName ?? '平台管理员',
        passwordHash: hashPassword(bootstrapUsers.adminPassword),
        tenantId,
        roles: ['admin'],
        plan: 'member',
        credits: 1_000,
        passwordResetRequired: false,
        emailVerified: true,
      },
    ],
    projects: demoWorkspace
      ? [
          {
            id: projectId,
            tenantId,
            ownerId: memberId,
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
        ]
      : [],
    scriptEpisodes: demoWorkspace
      ? [
          {
            id: `legacy-${projectId}`,
            projectId,
            tenantId,
            episodeNumber: 1,
            title: '第 1 集',
            content: DEFAULT_SCRIPT,
            draftContent: '',
            status: 'saved',
            summary: DEFAULT_SCRIPT.replace(/\s+/g, ' ').slice(0, 500),
            continuityState: {},
            revision: 1,
            lastEditedBy: memberId,
            createdAt: now,
            updatedAt: now,
          },
        ]
      : [],
    assets: demoWorkspace ? seedAssets(projectId, tenantId, now) : [],
    shots: demoWorkspace ? seedShots(projectId, tenantId, now) : [],
    tasks: [],
    aiJobs: [],
    media: [],
    trustedValidationSessions: [],
    assetLibraryItems: [],
    assetLibraryItemVersions: [],
    novelDocuments: [],
    novelChapters: [],
    novelChapterSummaries: [],
    novelSummaryQueues: [],
    novelSummaryQueueItems: [],
    novelBoundaries: [],
    novelStoryBibles: [],
    ledger: [
      {
        id: 'ledger-initial',
        userId: memberId,
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

export function createEmptyState(): AppState {
  return {
    users: [],
    projects: [],
    scriptEpisodes: [],
    assets: [],
    shots: [],
    tasks: [],
    aiJobs: [],
    ledger: [],
    media: [],
    trustedValidationSessions: [],
    assetLibraryItems: [],
    assetLibraryItemVersions: [],
    novelDocuments: [],
    novelChapters: [],
    novelChapterSummaries: [],
    novelSummaryQueues: [],
    novelSummaryQueueItems: [],
    novelBoundaries: [],
    novelStoryBibles: [],
  }
}

function seedAssets(projectId: string, tenantId: string, now: string): Asset[] {
  return [
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

function seedShots(projectId: string, tenantId: string, now: string): Shot[] {
  return [
    ['shot-1', 1, '雨夜空镜', '大全景', 4, '临港市雨夜，镜头缓慢推向废弃火车站，冷色调', '/demo/rain.jpg'],
    ['shot-2', 2, '林夏抵达', '中近景', 5, '林夏撑透明雨伞走入站台，侧逆光，雨滴清晰', null],
    ['shot-3', 3, '等待', '广角', 4, '空旷站台，人物位于画面右侧，信号灯闪烁', '/demo/station.jpg'],
    ['shot-4', 4, '周野出现', '特写', 4, '周野从阴影走出，把旧铁盒放在长椅上', null],
    ['shot-5', 5, '打开铁盒', '俯拍', 5, '双手打开生锈铁盒，里面是一卷旧胶片，暖光', '/demo/room.jpg'],
  ].map(([id, order, title, framing, duration, prompt, imageUrl]) => ({
    id: id as string,
    projectId,
    tenantId,
    scriptEpisodeId: `legacy-${projectId}`,
    order: order as number,
    title: title as string,
    framing: framing as string,
    duration: duration as number,
    prompt: prompt as string,
    negativePrompt: '',
    imageUrl: imageUrl as string | null,
    continuityMode: 'independent' as const,
    continuityNote: '',
    episodeBreakBefore: false,
    episodeNumber: 1,
    episodeTitle: '主故事',
    episodeKind: 'standard' as const,
    createdAt: now,
    updatedAt: now,
  }))
}

const DEFAULT_SCRIPT = `雨夜，临港市旧火车站。

林夏撑着一把透明雨伞，站在停运多年的三号站台。她收到一封没有署名的信，约她午夜来取回父亲留下的胶片。

钟声响起，周野从候车室的阴影里走出。他把一只旧铁盒放到长椅上，却提醒林夏：胶片记录的并不是过去，而是明天。

远处传来列车进站声。空无一物的铁轨上，灯光穿透雨幕。林夏打开铁盒，看见胶片第一格正是此刻的自己。`
