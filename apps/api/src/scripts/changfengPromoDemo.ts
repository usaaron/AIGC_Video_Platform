import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { promisify } from 'node:util'
import { loadConfig } from '../config.js'
import { hashSessionSecret, issueSessionToken } from '../core/auth/sessionToken.js'
import type { AccountDatabase } from '../infra/postgres.js'
import { createRuntimeDatabase } from '../runtime/database.js'
import { UserRepository } from '../modules/users/repository.js'

const execFileAsync = promisify(execFile)
const API_BASE = process.env.CHANGFENG_API_BASE_URL || 'http://127.0.0.1:8787/api/v1'
const EMAIL = requiredEnv('BOOTSTRAP_OWNER_EMAIL')
const PASSWORD = requiredEnv('BOOTSTRAP_OWNER_PASSWORD')
const PROJECT_ID = process.env.CHANGFENG_PROJECT_ID || 'eb859606-e84c-452a-ba85-67b0bb6c72d1'
const REFERENCE_DIR = resolve(process.env.CHANGFENG_REFERENCE_DIR || 'artifacts/changfeng-references')
const OUTPUT_DIR = resolve(process.env.CHANGFENG_OUTPUT_DIR || 'artifacts/changfeng-promo')
const OUTPUT_PATH = resolve(OUTPUT_DIR, '长风商务区-40秒宣传片.mp4')
const RESULT_PATH = resolve(OUTPUT_DIR, 'result.json')
const PROMO_VERSION = 'changfeng-40s-v1'
const POLL_INTERVAL_MS = 8_000
const VIDEO_TIMEOUT_MS = 35 * 60_000

type JsonRecord = Record<string, unknown>

type Project = {
  id: string
  name: string
  script: string
  episodeDurationSeconds?: number
}

type Media = { id: string; name: string; url: string }

type Asset = {
  id: string
  kind: string
  name: string
  imageUrl: string | null
  references: Array<{ id: string; url: string; name: string }>
}

type Shot = {
  id: string
  order: number
  title: string
  prompt: string
  selectedVideoTaskId?: string | null
}

type Task = {
  id: string
  projectId: string
  label: string
  kind: 'text' | 'image' | 'video' | 'audio'
  status: 'queued' | 'paused' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  error: string | null
  resultUrl: string | null
  outputs: Array<{ view: string; url: string }>
  metadata: JsonRecord
}

type Workspace = { project: Project; assets: Asset[]; shots: Shot[] }

type SceneDefinition = {
  id: string
  title: string
  referenceFile: string
  assetName: string
  description: string
  framing: string
  prompt: string
}

const scenes: SceneDefinition[] = [
  {
    id: 'A01',
    title: '汾河晨光',
    referenceFile: '06-fen-river-clean.jpg',
    assetName: '汾河长风段',
    description: '太原汾河长风段实景，开阔河面、滨河绿地与现代城市天际线。',
    framing: '航拍大全景',
    prompt: `5秒写实城市形象片，严格参考上传照片中的汾河水岸、绿地尺度和太原城市天际线，不照搬照片中的天气瑕疵。0-2秒，清晨金色阳光落在平静河面，镜头从水面上方稳定向前滑行；2-5秒，镜头缓慢升高，露出滨河绿地与远处城市，树叶轻动，水面反光自然。画面内不出现可读文字、字幕、标牌、logo或水印。配成熟温暖的普通话男声旁白：“一湾汾水，铺开太原向南发展的城市画卷。”同时保留轻柔水声、晨风和克制的电影感音乐。`,
  },
  {
    id: 'A02',
    title: '文化地标群',
    referenceFile: '01-changfeng.jpg',
    assetName: '长风文化建筑群',
    description: '长风文化商务区文化建筑实景，现代几何体量、滨水绿地和公共空间。',
    framing: '广角全景',
    prompt: `5秒写实城市形象片，严格保留参考照片中长风文化商务区建筑群的真实几何轮廓、立面颜色、相对位置和前方公共绿地，不新增高楼，不改变建筑造型。0-2秒，低机位从草地边缘平稳横移；2-5秒，镜头抬升至开阔广角，少量市民在远景自然散步，建筑是绝对主体。画面内不出现可读文字、字幕、标牌、logo或水印。配成熟温暖的普通话男声旁白：“长风商务区，让文化与城市在这里相遇。”环境声为微风与极轻城市声，音乐承接上一镜。`,
  },
  {
    id: 'A03',
    title: '太原博物馆',
    referenceFile: '02-taiyuan-museum.jpg',
    assetName: '太原博物馆',
    description: '太原博物馆实景，由五个红褐色倒锥形单体组成的标志性建筑。',
    framing: '仰拍广角',
    prompt: `5秒写实城市形象片，主体是太原博物馆，严格参考照片保留五个红褐色倒锥形展馆的数量、大小关系、竖向格栅和真实外轮廓，禁止变成圆柱、体育馆或其他建筑。0-2秒，镜头从前景步道贴地稳定前推；2-5秒，轻微仰拍显出五座展馆的层次，天空通透，只有极少远景游客缓慢行走。画面内不出现可读文字、字幕、标牌、logo或水印。配成熟温暖的普通话男声旁白：“太原博物馆，五座展馆凝望千年晋阳。”加入轻微脚步与风声，音乐保持克制庄重。`,
  },
  {
    id: 'A04',
    title: '山西大剧院',
    referenceFile: '03-shanxi-theater.jpg',
    assetName: '山西大剧院',
    description: '山西大剧院实景，粉红暖光照亮的大体量现代几何建筑。',
    framing: '中远景',
    prompt: `5秒写实城市形象片，主体是山西大剧院，严格参考照片保留巨大的浅色几何体量、中央切口、台阶和滨水步道关系，使用蓝调时刻的粉金色建筑灯光，禁止改造成商场或音乐厅。0-3秒，镜头沿步道平稳侧向滑行；3-5秒，镜头轻推向发光入口，少量远景行人自然走过。画面内不出现可读文字、字幕、标牌、logo或水印。配成熟温暖的普通话男声旁白：“山西大剧院，让时代旋律在汾河畔回响。”加入远处城市氛围与低柔音乐，不生成歌唱口型。`,
  },
  {
    id: 'A05',
    title: '太原市图书馆',
    referenceFile: '04-taiyuan-library.jpg',
    assetName: '太原市图书馆',
    description: '太原市图书馆实景，折线形白色竖向遮阳板、蓝色玻璃幕墙与入口广场。',
    framing: '平视广角',
    prompt: `5秒写实城市形象片，主体是太原市图书馆，严格参考照片保留折线形白色竖向遮阳板、蓝色玻璃幕墙、入口位置和建筑比例，禁止改成办公楼。0-2秒，前景树叶轻轻掠过，镜头由遮挡后平稳显露建筑；2-5秒，缓慢推近入口广场，远景读者有序进出但不直视镜头。画面内不出现可读文字、字幕、标牌、logo或水印。配成熟温暖的普通话男声旁白：“太原市图书馆，让阅读点亮城市日常。”加入轻微翻书质感的转场音与自然城市环境声。`,
  },
  {
    id: 'A06',
    title: '太原万象城',
    referenceFile: '05-mixc.jpg',
    assetName: '太原万象城',
    description: '太原万象城及周边商务楼宇实景，开放商业广场与现代城市生活。',
    framing: '航拍中远景',
    prompt: `5秒写实城市形象片，主体是太原万象城和开放商业广场，严格参考照片保留商业体的层叠体量、广场位置、道路和周边楼宇关系，不生成任何可读店招，不改变道路结构。0-3秒，蓝调时刻从广场上方缓慢向前航拍，车辆按真实车道匀速行驶；3-5秒，镜头略微下降，让广场人流和城市灯光形成活力层次。画面内不出现可读文字、字幕、标牌、logo或水印。配成熟温暖的普通话男声旁白：“太原万象城，汇聚商业活力与现代生活。”加入克制的人群与交通环境声，音乐节奏稍微提升。`,
  },
  {
    id: 'A07',
    title: '汾河生活',
    referenceFile: '06-fen-river-clean.jpg',
    assetName: '汾河长风段',
    description: '汾河长风段黄昏生活场景，滨河绿道、自然水面与太原天际线。',
    framing: '跟拍中景转全景',
    prompt: `5秒写实城市形象片，严格参考照片中的汾河水岸、绿地和真实城市天际线，将时间调整为温暖黄昏。0-2.5秒，镜头在滨河绿道上稳定跟随一组远景市民慢跑与散步，人物比例自然且不看镜头；2.5-5秒，镜头越过人物轻轻升起，显出河面、绿地与落日余晖。禁止人物肢体畸形、车辆漂浮或建筑闪变。画面内不出现可读文字、字幕、标牌、logo或水印。配成熟温暖的普通话男声旁白：“从清晨到黄昏，宜居与活力相伴生长。”加入脚步、风声、水声与渐强音乐。`,
  },
  {
    id: 'A08',
    title: '长风夜景收束',
    referenceFile: '01-changfeng.jpg',
    assetName: '长风文化建筑群',
    description: '长风文化商务区夜幕全景，真实文化建筑轮廓、滨水空间和城市灯光。',
    framing: '航拍大全景',
    prompt: `5秒写实城市形象片终章，严格参考照片保留长风文化商务区文化建筑群的真实轮廓、数量、相对位置与滨水公共空间，把时间自然过渡为深蓝夜幕，建筑轮廓灯温暖克制。0-3秒，稳定航拍从建筑群上方缓慢后拉，汾河反射城市灯光；3-5秒，镜头停稳在完整城市天际线，全画面只保留真实夜景，不生成标题卡、字幕、汉字、英文字母、logo或水印。配成熟温暖的普通话男声旁白：“长风商务区，山水为卷，未来作答。”音乐在最后一秒形成干净有力的收束。`,
  },
]

const sharedNegativePrompt = [
  '错误建筑，虚构地标，改变参考建筑轮廓，建筑数量错误，建筑融化，建筑闪变，路网错误',
  '错别字，汉字，英文，字幕，标题卡，招牌，广告牌，logo，水印，二维码',
  '漂浮车辆，逆行车辆，车辆穿模，密集车流，人物畸形，多余肢体，重复人群，人物直视镜头',
  '过饱和，重度滤镜，动漫感，CG感，塑料质感，过强光晕，镜头抖动，快速旋转，航拍穿楼',
].join('，')

const productionScript = scenes
  .map(
    (scene, index) =>
      `场次：S${String(index + 1).padStart(2, '0')}｜时长：5秒｜地点：${scene.assetName}｜画面：${scene.prompt}｜衔接：第${index + 1}镜独立生成，成片按晨光、文化、博物、艺术、阅读、商业、生活、夜景顺序剪辑。`,
  )
  .join('\n')

let cookie = ''
let operationsSession: { database: AccountDatabase; sessionId: string; users: UserRepository } | null = null

async function main() {
  const startedAt = Date.now()
  try {
    await mkdir(OUTPUT_DIR, { recursive: true })
    await login()
    await prepareProject()
    const assets = await ensureReferenceAssets()
    const shots = await ensureShots()
    const videoTasks = await ensureVideos(shots, assets)
    const preview = await ensureFilmPreview(videoTasks)
    await downloadPreview(preview)
    const media = await probeOutput()
    const result = {
      promoVersion: PROMO_VERSION,
      projectId: PROJECT_ID,
      outputPath: OUTPUT_PATH,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      videoTasks: videoTasks.map((task) => task.id),
      previewTaskId: preview.id,
      media,
      completedAt: new Date().toISOString(),
    }
    await writeFile(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    log(`成片完成：${OUTPUT_PATH}`)
  } finally {
    await closeOperationsSession()
  }
}

async function login() {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (response.ok) cookie = response.headers.get('set-cookie')?.split(';', 1)[0] || ''
  else if (response.status === 401 && process.env.CHANGFENG_ALLOW_OPERATIONS_SESSION === 'true') {
    await createOperationsSession()
  } else {
    throw new Error(`Owner 登录失败 (${response.status}): ${await response.text()}`)
  }
  if (!cookie) throw new Error('Owner 登录成功但没有收到会话 Cookie')
}

async function createOperationsSession() {
  const config = loadConfig()
  const runtime = await createRuntimeDatabase(config)
  if (!runtime.database) throw new Error('运维会话需要生产数据库')
  const users = new UserRepository(runtime.store, runtime.database)
  const owner = await users.findByEmail(EMAIL)
  if (!owner?.roles.includes('owner')) throw new Error('配置邮箱不是有效 Owner')
  await runtime.database.query(
    `
      UPDATE sessions
      SET revoked_at = now()
      WHERE device_label = $1
        AND revoked_at IS NULL
    `,
    [`operations:${PROMO_VERSION}`],
  )
  const issued = issueSessionToken(config.AUTH_SECRET, 60 * 60 * 3)
  const created = await users.createSession(
    owner.id,
    owner.tenantId,
    issued.payload.sessionId,
    hashSessionSecret(issued.payload.tokenSecret),
    new Date(issued.payload.expiresAt * 1_000).toISOString(),
    { ipAddress: null, userAgent: null, deviceLabel: `operations:${PROMO_VERSION}` },
  )
  if (!created) {
    await runtime.database.close()
    throw new Error('无法创建受控运维会话')
  }
  operationsSession = { database: runtime.database, sessionId: issued.payload.sessionId, users }
  cookie = `seqora_session=${issued.token}`
  log('已启用短期受控运维会话')
}

async function closeOperationsSession() {
  if (!operationsSession) return
  const current = operationsSession
  operationsSession = null
  await current.users.revokeSession(current.sessionId).catch(() => {})
  await current.database.close().catch(() => {})
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Cookie: cookie,
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json; charset=utf-8' }
        : {}),
      ...options.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} 失败 (${response.status}): ${await response.text()}`)
  }
  if (response.status === 204) return null as T
  return (await response.json()) as T
}

async function prepareProject() {
  const workspace = await workspaceFor()
  if (workspace.project.id !== PROJECT_ID) throw new Error(`项目不存在：${PROJECT_ID}`)
  const expectedNames = new Set(scenes.map((scene) => scene.assetName))
  const removedAssetIds: string[] = []
  for (const asset of workspace.assets) {
    if (asset.kind === 'scene' && expectedNames.has(asset.name)) continue
    await api<null>(`/projects/${PROJECT_ID}/assets/${asset.id}`, { method: 'DELETE' })
    removedAssetIds.push(asset.id)
  }
  if (removedAssetIds.length) {
    const tasks = await tasksFor()
    for (const task of tasks) {
      if (removedAssetIds.includes(String(task.metadata.assetId || ''))) {
        await api<null>(`/generation/tasks/${task.id}`, { method: 'DELETE' })
      }
    }
    log(`已清理${removedAssetIds.length}个误建资产及其任务`)
  }
  await api<Project>(`/projects/${PROJECT_ID}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: '长风商务区·一城山水一城新',
      status: 'producing',
      visualStyle: 'photorealistic',
      episodeDurationSeconds: 40,
      synopsis: '40秒太原长风文化商务区城市形象片，以汾河为线，串联文化地标、公共服务、商业活力与宜居生活。',
      script: productionScript,
    }),
  })
  log('项目与8镜制作稿已审校写入')
}

async function ensureReferenceAssets(): Promise<Map<string, Asset>> {
  let workspace = await workspaceFor()
  const byName = new Map<string, Asset>()
  for (const scene of scenes) {
    if (byName.has(scene.assetName)) continue
    let asset = workspace.assets.find((item) => item.kind === 'scene' && item.name === scene.assetName)
    const existingReference = asset?.references[0]
    const media = existingReference
      ? { id: existingReference.id, url: existingReference.url, name: existingReference.name }
      : await uploadReference(scene.referenceFile)
    const reference = { id: media.id, url: media.url, name: media.name }
    const input = {
      kind: 'scene',
      sourceMode: 'import',
      name: scene.assetName,
      description: scene.description,
      prompt: scene.description,
      promptMode: 'advanced',
      customPromptMode: 'replace',
      customPrompt: `${scene.description}。仅作为真实地标的建筑结构、空间关系和材质参考。`,
      negativePrompt: sharedNegativePrompt,
      references: [reference],
      imageUrl: media.url,
      attributes: {
        type: 'scene',
        space: 'exterior',
        sceneType:
          scene.assetName === '汾河长风段'
            ? 'nature'
            : scene.assetName === '太原万象城'
              ? 'commercial'
              : 'city',
        era: 'modern',
        time: scene.id === 'A08' ? 'night' : scene.id === 'A07' ? 'sunset' : 'day',
        weather: 'clear',
        mood: scene.id === 'A08' ? 'epic' : 'warm',
        camera: scene.framing.includes('航拍') ? 'aerial' : 'wide',
        visualStyle: 'photorealistic',
        emptyScene: false,
        activitySpace: true,
      },
    }
    if (asset) {
      asset = await api<Asset>(`/projects/${PROJECT_ID}/assets/${asset.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...input, status: 'confirmed' }),
      })
    } else {
      asset = await api<Asset>(`/projects/${PROJECT_ID}/assets`, {
        method: 'POST',
        body: JSON.stringify(input),
      })
      asset = await api<Asset>(`/projects/${PROJECT_ID}/assets/${asset.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'confirmed' }),
      })
    }
    byName.set(scene.assetName, asset)
    workspace = await workspaceFor()
    log(`真实地标参考已写入：${scene.assetName}`)
  }
  return byName
}

async function uploadReference(fileName: string): Promise<Media> {
  const path = resolve(REFERENCE_DIR, fileName)
  const content = await readFile(path)
  const form = new FormData()
  form.append('file', new Blob([content], { type: 'image/jpeg' }), basename(path))
  return api<Media>(`/projects/${PROJECT_ID}/media`, { method: 'POST', body: form })
}

async function ensureShots(): Promise<Shot[]> {
  let workspace = await workspaceFor()
  const currentTitles = workspace.shots.map((shot) => shot.title)
  const expectedTitles = scenes.map((scene) => `${scene.id} · ${scene.title}`)
  const reusable =
    currentTitles.length === expectedTitles.length &&
    currentTitles.every((title, index) => title === expectedTitles[index])
  if (!reusable) {
    for (const shot of [...workspace.shots].sort((left, right) => right.order - left.order)) {
      await api<null>(`/projects/${PROJECT_ID}/shots/${shot.id}`, { method: 'DELETE' })
    }
    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index]!
      await api<Shot>(`/projects/${PROJECT_ID}/shots`, {
        method: 'POST',
        body: JSON.stringify({
          title: `${scene.id} · ${scene.title}`,
          framing: scene.framing,
          duration: 5,
          prompt: scene.prompt,
          negativePrompt: sharedNegativePrompt,
          imageUrl: null,
          continuityMode: 'independent',
          continuityNote: '真实地标独立镜头，不继承上一镜尾帧；仅在最终成片按顺序剪辑。',
          episodeBreakBefore: index === 0,
          episodeNumber: 1,
          episodeTitle: '长风商务区·一城山水一城新',
          episodeKind: 'standard',
        }),
      })
    }
    log('8个独立地标分镜已创建')
  }
  workspace = await workspaceFor()
  if (workspace.shots.length !== scenes.length) {
    throw new Error(`分镜数量异常：${workspace.shots.length}/${scenes.length}`)
  }
  return workspace.shots
}

async function ensureVideos(shots: Shot[], assets: Map<string, Asset>): Promise<Task[]> {
  const completed: Task[] = []
  for (let offset = 0; offset < shots.length; offset += 3) {
    const batch = shots.slice(offset, offset + 3)
    const results = await Promise.all(
      batch.map((shot, batchIndex) => ensureVideo(shot, scenes[offset + batchIndex]!, assets)),
    )
    completed.push(...results)
    log(`视频进度：${completed.length}/${shots.length}`)
  }
  return completed.sort(
    (left, right) => Number(left.metadata.promoOrder || 0) - Number(right.metadata.promoOrder || 0),
  )
}

async function ensureVideo(shot: Shot, scene: SceneDefinition, assets: Map<string, Asset>): Promise<Task> {
  const existing = latestPromoTask(await tasksFor(), shot.id)
  if (existing?.status === 'completed') return selectVideoVersion(shot, existing)
  if (existing && (existing.status === 'queued' || existing.status === 'running')) {
    return selectVideoVersion(shot, await waitForTask(existing.id, scene.title, VIDEO_TIMEOUT_MS))
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const asset = assets.get(scene.assetName)
      if (!asset?.imageUrl) throw new Error(`${scene.assetName}缺少真实参考图`)
      const task = await createTask({
        kind: 'video',
        label: `${scene.id} · ${scene.title}`,
        prompt: scene.prompt,
        negativePrompt: sharedNegativePrompt,
        provider: 'seedance',
        model: 'doubao-seedance-2-0-260128',
        estimatedCredits: 18,
        maxAttempts: 2,
        metadata: {
          generationStage: 'changfeng-promo',
          promoVersion: PROMO_VERSION,
          promoOrder: shot.order,
          shotId: shot.id,
          duration: 5,
          requestedDuration: 5,
          aspectRatio: '16:9',
          resolution: '720p',
          generateAudio: true,
          watermark: false,
          returnLastFrame: true,
          continuityMode: 'independent',
          videoInputMode: 'single-landmark-reference',
          images: [asset.imageUrl],
          referenceAssetIds: [asset.id],
          referenceAssetNames: [asset.name],
          batchId: `${PROMO_VERSION}-${PROJECT_ID}`,
          batchMode: 'parallel',
        },
      })
      return selectVideoVersion(shot, await waitForTask(task.id, scene.title, VIDEO_TIMEOUT_MS))
    } catch (error) {
      lastError = error
      if (attempt < 3) {
        log(`${scene.title}第${attempt}次未完成，只重试本镜：${errorMessage(error)}`)
        await sleep(12_000)
      }
    }
  }
  throw lastError
}

async function selectVideoVersion(shot: Shot, task: Task): Promise<Task> {
  if (shot.selectedVideoTaskId !== task.id) {
    await api<Shot>(`/projects/${PROJECT_ID}/shots/${shot.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ selectedVideoTaskId: task.id }),
    })
  }
  return task
}

async function ensureFilmPreview(videoTasks: Task[]): Promise<Task> {
  if (videoTasks.length !== scenes.length || videoTasks.some((task) => task.status !== 'completed')) {
    throw new Error('8个镜头尚未全部完成，禁止提前合成')
  }
  const task = await api<Task>(`/projects/${PROJECT_ID}/film-preview`, {
    method: 'POST',
    body: JSON.stringify({ mode: 'full', force: true, episodeNumber: 1 }),
  })
  return waitForTask(task.id, '40秒完整成片', 30 * 60_000)
}

async function downloadPreview(task: Task) {
  const response = await fetch(`${API_BASE}/generation/tasks/${task.id}/content`, {
    headers: { Cookie: cookie },
  })
  if (!response.ok) throw new Error(`下载成片失败 (${response.status}): ${await response.text()}`)
  await writeFile(OUTPUT_PATH, Buffer.from(await response.arrayBuffer()))
}

async function probeOutput() {
  const probe = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size:stream=codec_name,codec_type,width,height,sample_rate,channels',
    '-of',
    'json',
    OUTPUT_PATH,
  ])
  const media = JSON.parse(probe.stdout) as {
    format?: { duration?: string }
    streams?: Array<{ codec_type?: string }>
  }
  const duration = Number(media.format?.duration || 0)
  if (duration < 38 || duration > 42) throw new Error(`成片时长异常：${duration.toFixed(2)}秒`)
  if (!media.streams?.some((stream) => stream.codec_type === 'video')) throw new Error('成片缺少视频轨')
  if (!media.streams.some((stream) => stream.codec_type === 'audio')) throw new Error('成片缺少音轨')
  return media
}

async function createTask(input: Omit<JsonRecord, 'projectId' | 'clientRequestId'>): Promise<Task> {
  return api<Task>('/generation/tasks', {
    method: 'POST',
    body: JSON.stringify({
      clientRequestId: `${PROMO_VERSION}-${Date.now()}-${randomUUID()}`,
      projectId: PROJECT_ID,
      ...input,
    }),
  })
}

async function waitForTask(taskId: string, label: string, timeoutMs: number): Promise<Task> {
  const startedAt = Date.now()
  let lastSummary = ''
  while (Date.now() - startedAt < timeoutMs) {
    const task = (await tasksFor()).find((item) => item.id === taskId)
    if (!task) throw new Error(`${label}任务不存在：${taskId}`)
    if (task.status === 'completed') return task
    if (task.status === 'failed' || task.status === 'cancelled') {
      throw new Error(`${label}失败：${task.error || task.status}`)
    }
    const summary = `${task.status} ${task.progress}%`
    if (summary !== lastSummary) {
      log(`${label}：${summary}`)
      lastSummary = summary
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`${label}等待超时`)
}

async function workspaceFor(): Promise<Workspace> {
  return api<Workspace>(`/projects/${PROJECT_ID}`)
}

async function tasksFor(): Promise<Task[]> {
  return api<Task[]>(`/projects/${PROJECT_ID}/generation/tasks`)
}

function latestPromoTask(tasks: Task[], shotId: string): Task | undefined {
  return tasks.find(
    (task) =>
      task.kind === 'video' &&
      task.metadata.shotId === shotId &&
      task.metadata.promoVersion === PROMO_VERSION &&
      typeof task.metadata.queueHiddenAt !== 'string',
  )
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`缺少环境变量：${name}`)
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function log(message: string) {
  process.stdout.write(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}\n`)
}

function sleep(milliseconds: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
