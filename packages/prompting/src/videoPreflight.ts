import { referenceVisualDetail } from './videoShotExecution.js'
import { sceneExecutionGaps } from './sceneExecution.js'
import { deriveRigidPhysicsContract } from './rigidPhysicsContract.js'

export type VideoPreflightIssue = {
  code: string
  severity: 'error' | 'warning'
  message: string
  evidence: string[]
}

/** Conservative text rules only. This does not inspect images or certify narrative consistency. */
export function inspectVideoPreflight(prompt: string, assets: { name: string; description?: string }[] = []) {
  const issues: VideoPreflightIssue[] = sceneExecutionGaps(prompt)
  const rigidContract = deriveRigidPhysicsContract({ prompt })
  const physicalSectionValue = sectionText(prompt, '支撑与受力')
  const cameraSectionValue = sectionText(prompt, '摄影机')
  const structuredPhysicalPrompt = Boolean(physicalSectionValue || cameraSectionValue)
  const physicalSection = physicalSectionValue || prompt
  const cameraSection = cameraSectionValue || prompt
  const hasForce = /推|拉|撞|挤|挤压|施压|攀爬|承重|打开|关闭|移动|滑动|倾斜|受力/u.test(prompt)
  const hasAnchorSpec = /底座|底脚|底板|螺栓|斜撑|连接点|轨道/u.test(physicalSection)
  const singleContinuous = /单一连续镜头|连续镜头|不在镜内切换|固定镜头完全静止/u.test(cameraSection)
  const cutInstruction = prompt
    .replace(
      /(?:不在|不得|不要|禁止)[^。；;\n]{0,12}(?:镜内|镜头内|同一镜头内)[^。；;\n]{0,18}(?:硬切|切换|跳切|转场)/gu,
      '',
    )
    .replace(/(?:镜内|镜头内|同一镜头内)[^。；;\n]{0,12}(?:不硬切|不切换|不跳切|不转场)/gu, '')
  const intraShotCut =
    /(?:镜内|镜头内|同一镜头内)[^。；;\n]{0,18}(?:硬切|切换|跳切|转场)|(?:硬切|切换|跳切|转场)[^。；;\n]{0,18}(?:镜内|镜头内|同一镜头内)/u.test(
      cutInstruction,
    )
  if (structuredPhysicalPrompt && rigidContract?.objects.length && hasForce && !hasAnchorSpec) {
    issues.push({
      code: 'RIGID_ANCHOR_GUIDANCE',
      severity: 'warning',
      message: '刚性设施受力但未写明底脚、底板、螺栓或连接点；请补足固定/移动方式，便于生成和逐帧复核。',
      evidence: [rigidContract.objects.map((object) => object.observable.hint).join('；')],
    })
  }
  if (structuredPhysicalPrompt && rigidContract?.objects.length && hasForce && !singleContinuous) {
    issues.push({
      code: 'RIGID_CONTINUITY_GUIDANCE',
      severity: 'warning',
      message: '刚性设施受力建议声明单一连续镜头或镜内不切换，避免硬切后无法判断底脚和连接点是否连续。',
      evidence: ['单一连续镜头', '不在镜内切换'],
    })
  }
  if (singleContinuous && intraShotCut) {
    issues.push({
      code: 'CONTINUOUS_SHOT_CUT_CONFLICT',
      severity: 'error',
      message: '本镜声明单一连续镜头，却又要求镜内硬切、跳切或转场；请把硬切移到镜间后期边界。',
      evidence: [
        cutInstruction.match(
          /(?:镜内|镜头内|同一镜头内)[^。；;\n]{0,18}(?:硬切|切换|跳切|转场)|(?:硬切|切换|跳切|转场)[^。；;\n]{0,18}(?:镜内|镜头内|同一镜头内)/u,
        )?.[0] ?? '',
      ],
    })
  }
  const fixedSupport = /固定|螺栓|底板|斜撑|混凝土地面|不滑移/u.test(physicalSection)
  const flexibleRigidPart =
    /(?:栏片|栏杆|隔离栏|护栏|栅栏)[^。；;\n]{0,28}(?:弯曲|震颤|伸缩|拉长|收缩|柔性)|(?:弯曲|震颤|伸缩|拉长|收缩|柔性)[^。；;\n]{0,28}(?:栏片|栏杆|隔离栏|护栏|栅栏)/u.test(
      physicalSection,
    )
  if (fixedSupport && flexibleRigidPart) {
    for (let index = issues.length - 1; index >= 0; index -= 1) {
      if (issues[index]?.code === 'RIGID_CONTRADICTION_REVIEW') issues.splice(index, 1)
    }
    issues.push({
      code: 'FIXED_RIGID_FLEX_CONFLICT',
      severity: 'error',
      message:
        '当前物理合同只支持刚体整体运动，未定义栏片变形模式；请明确栏片改为整体位移，或补充柔性/铰接变形范围与可追踪锚点。',
      evidence: [physicalSection.trim().slice(0, 360)],
    })
  }
  // Only inspect explicit local constraints, never whole-scene events or dialogue.
  const lines = prompt.split(/\r?\n/u)
  const headings = new Set(['局部锁定', '屏幕呈现', '首帧与空间调度', '镜尾状态', '动作时序'])
  let section = ''
  const locked: string[] = []
  for (const line of lines) {
    if (headings.has(line.trim())) section = line.trim()
    else if (/^[^。；：:，,]{2,20}$/u.test(line.trim())) section = ''
    else if (section === '局部锁定' || section === '屏幕呈现') locked.push(line)
  }
  const text = locked.join('\n')
  const readable = text.match(
    /(?:必须|需要|务必)(?:清晰)?(?:显示|呈现)(?:清晰)?(?:可辨认的|可辨读的|可读的)?(?:数字|时间码|读数)/u,
  )
  const unreadable = text.match(
    /(?:不要|不得|禁止)(?:显示|呈现)(?:可辨认的|可辨读的|可读的)?(?:数字|时间码|读数)/u,
  )
  if (readable && unreadable)
    issues.push({
      code: 'SCREEN_READABILITY_CONFLICT',
      severity: 'error',
      message: '本镜同时要求显示和禁止显示数字，请统一“屏幕呈现／局部锁定”。',
      evidence: [readable[0], unreadable[0]],
    })
  if (readable)
    issues.push({
      code: 'EXACT_SCREEN_TEXT',
      severity: 'warning',
      message: '本镜要求可读数字：生成模型不能保证读数连续准确，需验收；精确内容建议后期叠加。',
      evidence: [readable[0]],
    })
  // Actor must be named on BOTH explicit whole-shot rules; changes over time are not contradictions.
  for (const hand of ['右手', '左手']) {
    const rules = [
      ...text.matchAll(
        new RegExp(
          `([\\p{L}][\\p{L} ._-]{0,50}?)\\s*(?:的)?${hand}(?:始终|全程|一直|只)(?:只能|只)?(?:握着|握住|握|持有|持|拿着)\\s*([^，。；;\\n]{1,30})`,
          'gu',
        ),
      ),
    ]
    for (let i = 0; i < rules.length; i++)
      for (let j = i + 1; j < rules.length; j++) {
        const a = rules[i]!,
          b = rules[j]!
        if (a[1]!.trim() !== b[1]!.trim()) continue
        const category = (s: string) => (/终端|平板/.test(s) ? 'terminal' : /枪/.test(s) ? 'gun' : '')
        if (category(a[2]!) && category(b[2]!) && category(a[2]!) !== category(b[2]!))
          issues.push({
            code: 'HAND_PROP_CONFLICT',
            severity: 'error',
            message: `${a[1]!.trim()} 的${hand}被要求全程持有两种不同物品，请统一局部锁定。`,
            evidence: [a[0], b[0]],
          })
      }
  }
  for (const asset of assets) {
    const source = asset.description ?? ''
    if (
      source &&
      /右手|左手|举枪|拔枪|特写|right hand|left hand/iu.test(source) &&
      referenceVisualDetail(source) !== source
    ) {
      issues.push({
        code: 'ASSET_STAGING_FILTERED',
        severity: 'warning',
        message: `“${asset.name}”包含姿势或镜头用途说明；编译时按外观参考处理，本镜动作优先。`,
        evidence: [],
      })
    }
  }
  return { version: 'video-preflight-v3', scope: 'explicit-text-rules', issues }
}

function sectionText(prompt: string, heading: string): string {
  const lines = prompt.split(/\r?\n/u)
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start < 0) return ''
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^[^。；:：]{1,24}$/.test(line.trim()) && line.trim() && line.trim() !== heading) break
    body.push(line)
  }
  return body.join('\n').trim()
}
