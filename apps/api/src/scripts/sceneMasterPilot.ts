import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const API_BASE = process.env.DEMO_API_BASE_URL || 'http://127.0.0.1:8787/api/v1'
const EMAIL = process.env.DEMO_EMAIL || 'member@seqora.local'
const PASSWORD = process.env.DEMO_PASSWORD || 'MemberPassword123!'
const PROJECT_ID = process.env.DEMO_PROJECT_ID || '0326a22c-9905-479b-b181-04849ca8183d'
const PILOT_VERSION = 'scene-master-v2-anchor'
const OUTPUT_DIR = resolve('artifacts', 'scene-master-pilot-v2')
const OUTPUT_PATH = resolve(OUTPUT_DIR, 'scene-master-pilot-v2-30s.mp4')
const RESULT_PATH = resolve(OUTPUT_DIR, 'scene-master-pilot-v2-result.json')
const POLL_INTERVAL_MS = 10_000
const TASK_TIMEOUT_MS = 30 * 60_000

type JsonRecord = Record<string, unknown>

type Task = {
  id: string
  kind: 'text' | 'image' | 'video' | 'audio'
  label: string
  status: 'queued' | 'paused' | 'running' | 'completed' | 'failed' | 'cancelled'
  error: string | null
  outputs: Array<{ view: string; url: string }>
  metadata: JsonRecord
}

type Workspace = { shots: Array<{ order: number; imageUrl: string | null }> }

type SceneDefinition = {
  id: string
  label: string
  anchorShotOrder: number
  prompt: string
}

let cookie = ''

const sharedNegativePrompt = [
  '不要静态照片感、PPT感、定格不动、动作幅度过小',
  '不要人物瞬移、物品凭空出现、手中物件无过程消失、人物位置跳变',
  '不要面部漂移、换脸、不同角度不同人、服装变化、发型变化',
  '不要多余人物抢镜、重复人物、肢体穿插、多余手指、手指粘连',
  '不要摄影设备、工作人员、麦克风、文字、字幕、水印、logo、UI和边框',
  '不要烟雾遮挡主体、过曝炸白、暗部死黑、强烈频闪和无意义慢动作',
  '不要真人实拍、真人演员、古装摄影棚和cosplay质感',
].join('；')

const scenes: SceneDefinition[] = [
  {
    id: '01-test-failure',
    label: '场次母带 01 · 测灵失败',
    anchorShotOrder: 1,
    prompt: [
      '10秒连续表演的竖屏东方玄幻网剧场次母带，明显的高品质三维动画电影CG，不是真人实拍。',
      '地点始终是青玄宗考核广场，林砚始终穿灰蓝弟子服，测灵石碑固定在画面中，不得改变人物和物件外观。',
      '0-2秒：广场中景，林砚从候考弟子之间走到测灵石碑前，背景弟子自然让开并注视他，衣摆与发丝随风轻动。',
      '2-5秒：林砚把右掌稳稳按上石碑，石碑毫无反应；高台长老失望摇头，背景弟子由期待转为窃窃私语。',
      '5-7秒：[对白]长老用中文清楚宣布：“凡体，淘汰。”林砚眼神短暂失焦，随后下颌收紧，克制住屈辱。',
      '7-10秒：赵烈从背景人群中走近并露出轻蔑笑意，林砚没有回头，只用左手隔着衣领握住碎星玉；镜头缓慢推近林砚侧脸，玉佩发出一次极弱蓝光作为下一场钩子。',
      '动作必须按照时间顺序自然发生；核心人物、长老和背景弟子都要有符合事件的表情与反应，但不要同时夸张乱动。',
    ].join('\n'),
  },
  {
    id: '02-public-humiliation',
    label: '场次母带 02 · 当众羞辱',
    anchorShotOrder: 18,
    prompt: [
      '10秒连续表演的竖屏东方玄幻网剧场次母带，明显的高品质三维动画电影CG，不是真人实拍。',
      '同一座青玄宗考核广场，同一清晨；林砚灰蓝弟子服站在左侧，赵烈赤黑锦袍从右侧逼近，苏晚月白衣裙位于后景。',
      '0-3秒：赵烈走到林砚面前挡住去路，保持半步距离，不触碰林砚；背景弟子形成半圆，有人窃笑、有人担忧地交换眼神。',
      '3-6秒：[对白]赵烈用中文讥讽：“废体也敢来青玄宗？”说完偏头看向众人；林砚抬眼直视赵烈，呼吸变深但没有后退。',
      '6-8秒：苏晚从后景快步走近，站到两人侧面，冷声说：“够了。”赵烈笑意收住，背景笑声逐渐停下。',
      '8-10秒：林砚衣领下的碎星玉再次闪出蓝光，他低头一瞬，赵烈和苏晚同时注意到光线；镜头从三人中景推向林砚胸前，停在即将显现的异变上。',
      '保持人物左右关系、视线方向和手部状态连续；一段只表现一次冲突升级，不要增加无关打斗。',
    ].join('\n'),
  },
  {
    id: '03-stone-awakens',
    label: '场次母带 03 · 石碑觉醒',
    anchorShotOrder: 24,
    prompt: [
      '10秒连续表演的竖屏东方玄幻网剧场次母带，明显的高品质三维动画电影CG，不是真人实拍。',
      '青玄宗考核广场保持上一场人物与光线状态；林砚仍穿灰蓝弟子服，碎星玉一直挂在颈间，测灵石碑固定在他前方。',
      '0-3秒：碎星玉从衣领下透出稳定蓝光，测灵石碑表面沿雕纹亮起细密光线；林砚转身看向石碑，周围弟子本能后退半步。',
      '3-6秒：林砚缓慢抬起空着的右手，蓝色光线从玉佩连接到石碑；衣袖和发丝被能量气流带动，高台长老突然起身，赵烈的轻蔑转为错愕。',
      '6-8秒：石碑光芒扩散但不爆炸，背景弟子停止喧哗并屏住呼吸；苏晚看向林砚，神情从担忧变为惊讶。',
      '8-10秒：镜头推到林砚胸像近景，他眼神由压抑转为坚定，用中文低声说：“这一次，轮到你们看清了。”蓝光在身后形成清晰轮廓，作为结尾钩子。',
      '能量必须从碎星玉传向石碑，不能凭空出现其他法器；动作、表情和背景反应按时间顺序发生。',
    ].join('\n'),
  },
]

async function main() {
  const startedAt = Date.now()
  await mkdir(OUTPUT_DIR, { recursive: true })
  await login()
  const workspace = await api<Workspace>(`/projects/${PROJECT_ID}`)
  const anchors = new Map(workspace.shots.map((shot) => [shot.order, shot.imageUrl]))

  const completed: Task[] = []
  completed.push(...(await Promise.all(scenes.slice(0, 2).map((scene) => ensureScene(scene, anchors)))))
  completed.push(await ensureScene(scenes[2]!, anchors))

  const clipPaths: string[] = []
  for (let index = 0; index < completed.length; index += 1) {
    const path = resolve(OUTPUT_DIR, `scene-${index + 1}.mp4`)
    await downloadTask(completed[index]!, path)
    clipPaths.push(path)
  }
  await composeClips(clipPaths, OUTPUT_PATH)

  const probe = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size:stream=codec_name,codec_type,width,height,sample_rate,channels',
    '-of',
    'json',
    OUTPUT_PATH,
  ])
  const result = {
    pilotVersion: PILOT_VERSION,
    projectId: PROJECT_ID,
    outputPath: OUTPUT_PATH,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    videoTasks: completed.map((task, index) => ({ sceneId: scenes[index]!.id, taskId: task.id })),
    imageTasksCreated: 0,
    media: JSON.parse(probe.stdout) as unknown,
    completedAt: new Date().toISOString(),
  }
  await writeFile(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  log(`完成：${OUTPUT_PATH}`)
  log(`耗时：${Math.round(result.elapsedSeconds / 60)} 分钟；视频调用 3 次；分镜图片调用 0 次`)
}

async function ensureScene(scene: SceneDefinition, anchors: Map<number, string | null>): Promise<Task> {
  const existing = findSceneTask(await tasksFor(), scene.id)
  if (existing?.status === 'completed') {
    log(`${scene.label}：复用已完成任务`)
    return existing
  }
  if (existing && (existing.status === 'queued' || existing.status === 'running')) {
    return waitForTask(existing.id, scene.label)
  }

  const anchorUrl = anchors.get(scene.anchorShotOrder)
  if (!anchorUrl) throw new Error(`${scene.label}缺少场景锚点图：镜头 ${scene.anchorShotOrder}`)
  let lastError: unknown
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const task = await createTask({
        kind: 'video',
        label: scene.label,
        prompt: scene.prompt,
        negativePrompt: sharedNegativePrompt,
        provider: 'seedance',
        model: 'doubao-seedance-2-0-260128',
        estimatedCredits: 30,
        metadata: {
          generationStage: 'scene-master-pilot',
          pilotVersion: PILOT_VERSION,
          pilotSceneId: scene.id,
          duration: 10,
          requestedDuration: 10,
          aspectRatio: '9:16',
          resolution: '720p',
          generateAudio: true,
          watermark: false,
          returnLastFrame: true,
          cameraFixed: false,
          continuityMode: 'independent',
          videoInputMode: 'single-scene-anchor',
          images: [anchorUrl],
          referenceAssetIds: [],
          referenceAssetNames: [],
          anchorShotOrder: scene.anchorShotOrder,
        },
      })
      return await waitForTask(task.id, scene.label)
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (/may contain real person|SecurityConstraintViolation|疑似真人/u.test(message)) throw error
      if (attempt < 4) {
        log(`${scene.label}第 ${attempt} 次未完成，等待后只重试本场：${message}`)
        await sleep(12_000)
      }
    }
  }
  throw lastError
}

async function createTask(input: JsonRecord): Promise<Task> {
  return api<Task>('/generation/tasks', {
    method: 'POST',
    body: JSON.stringify({
      clientRequestId: `scene-master-${Date.now()}-${randomUUID()}`,
      projectId: PROJECT_ID,
      ...input,
    }),
  })
}

async function waitForTask(taskId: string, label: string): Promise<Task> {
  const startedAt = Date.now()
  let lastStatus = ''
  while (Date.now() - startedAt < TASK_TIMEOUT_MS) {
    const task = (await tasksFor()).find((item) => item.id === taskId)
    if (!task) throw new Error(`${label}任务不存在：${taskId}`)
    if (task.status === 'completed') return task
    if (task.status === 'failed' || task.status === 'cancelled') {
      throw new Error(`${label}失败：${task.error || task.status}`)
    }
    if (task.status !== lastStatus) {
      log(`${label}：${task.status === 'running' ? '模型生成中' : '等待调度'}`)
      lastStatus = task.status
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`${label}等待超时`)
}

async function downloadTask(task: Task, path: string) {
  const response = await fetch(`${API_BASE}/generation/tasks/${task.id}/content`, {
    headers: { Cookie: cookie },
  })
  if (!response.ok) throw new Error(`下载${task.label}失败 (${response.status}): ${await response.text()}`)
  await writeFile(path, Buffer.from(await response.arrayBuffer()))
}

async function composeClips(inputs: string[], output: string) {
  const inputArgs = inputs.flatMap((path) => ['-i', path])
  const filters = inputs.flatMap((_path, index) => [
    `[${index}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,fps=24,setsar=1,setpts=PTS-STARTPTS[v${index}]`,
    `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${index}]`,
  ])
  const streams = inputs.map((_path, index) => `[v${index}][a${index}]`).join('')
  await execFileAsync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...inputArgs,
      '-filter_complex',
      `${filters.join(';')};${streams}concat=n=${inputs.length}:v=1:a=1[v][a]`,
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      output,
    ],
    { maxBuffer: 20 * 1024 * 1024 },
  )
}

function findSceneTask(tasks: Task[], sceneId: string): Task | undefined {
  return tasks.find(
    (task) =>
      task.kind === 'video' &&
      task.metadata.pilotVersion === PILOT_VERSION &&
      task.metadata.pilotSceneId === sceneId &&
      typeof task.metadata.queueHiddenAt !== 'string',
  )
}

async function tasksFor(): Promise<Task[]> {
  return api<Task[]>(`/projects/${PROJECT_ID}/generation/tasks`)
}

async function login() {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!response.ok) throw new Error(`登录失败 (${response.status}): ${await response.text()}`)
  cookie = response.headers.get('set-cookie')?.split(';', 1)[0] || ''
  if (!cookie) throw new Error('登录成功但没有收到会话 Cookie')
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Cookie: cookie,
      ...(options.body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
      ...options.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} 失败 (${response.status}): ${await response.text()}`)
  }
  return (await response.json()) as T
}

function sleep(milliseconds: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function log(message: string) {
  process.stdout.write(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
