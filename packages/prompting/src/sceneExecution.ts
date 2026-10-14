import { SECTION_NAMES } from './videoShotExecution.js'

export const SCENE_EXECUTION_REVIEW = [
  '涉及推拉、碰撞或承重时：接触点、支撑或连接是否成立，受力后的移动、变形是否有过程？',
  '人物与设施是否处在可通行、可接触的位置，反打和镜尾是否保持同一空间关系？',
  '涉及群体时：前中远景是否符合剧情规模，拉远、转向后是否突然变空或凭空增人？',
  '事态变化时：在场且能感知的相关人物是否按职责和动机回应；不回应是否有依据？',
] as const

export const RIGID_OBJECT_VIDEO_RULE =
  '刚性物体连续性：凡本镜出现门、闸、栅栏、栏杆、护栏、墙、架、平台、箱体或其他刚性设施，保持已确定的长度、厚度、杆件数量、间距、连接点、底座和材质；受力时只允许整个物体按既定支撑关系平移、转动、滑动或保持不动，必须表现接触点和受力结果。禁止像弹簧、橡胶、布料或液体一样拉伸、收缩、波动、融化、分段、穿透或凭空增减杆件。固定设施不得自行伸缩或弹开；可移动设施的底脚、轮子和整体位移保持一致。'

export const SCENE_EXECUTION_VIDEO_RULE =
  '场景执行：仅对本镜涉及的动作核对接触点、支撑/连接、受力方向与移动或变形过程；固定和可移动设施按既定设计区分。保留通行空间及前中远景的既定人群规模，特写裁切不等于场外群众消失。空场参考只提供环境，人物图数量不限制群众规模。在场人物的应对服从本镜已写明的感知、职责、触发和时序，不为补反应新增角色、命令或台词，不提前执行后镜事件。未定关键条件不能自行编成事实；明确的超现实规则按正文执行。'

/** Missing specifications are review leads, never proof of physical or narrative error. */
export function sceneExecutionGaps(prompt: string) {
  const sections = new Map<string, string>()
  let heading = ''
  for (const line of prompt.split(/\r?\n/u)) {
    if (SECTION_NAMES.includes(line.trim())) heading = line.trim()
    else sections.set(heading, `${sections.get(heading) ?? ''}\n${line}`)
  }
  const local =
    sections.size && [...sections.keys()].some(Boolean)
      ? ['首帧与空间调度', '动作时序', '镜尾状态'].map((key) => sections.get(key) ?? '').join('\n')
      : prompt
  // The scene header can establish a duty; only local visible events trigger review.
  const roles = `${sections.get('场景上下文') ?? ''}\n${local}`
  const rigidSection = sections.get('支撑与受力') ?? ''
  const hasRigidStructureSpec =
    /刚性|杆件|杆间距|长度|厚度|连接点|底座|整体(?:平移|移动|滑动|转动)|保持(?:不动|不变)|不可(?:伸缩|变形)/.test(
      rigidSection,
    )
  const rigidContradiction =
    /固定|螺栓|刚性/.test(rigidSection) && /弯曲|伸缩|弹簧|拉长|收缩/.test(rigidSection)
  const checks = [
    {
      code: 'PHYSICAL_SETUP_REVIEW',
      section: '支撑与受力',
      needed: /推|拉|撞|挤压|攀爬|承重/.test(local) && /门|栏|墙|架|平台|桥|绳|梯/.test(local),
      detail: '写明设施固定或移动方式、接触点与受力后状态',
    },
    {
      code: 'RIGID_STRUCTURE_REVIEW',
      section: '支撑与受力',
      needed:
        /推|拉|撞|挤|挤压|施压|攀爬|承重|打开|关闭|移动|滑动|倾斜/.test(local) &&
        /门|闸|栅栏|栏杆|护栏|墙|架|平台|桥|箱体/.test(local) &&
        !/刚性|杆件|杆间距|长度|厚度|连接点|底座|整体(?:平移|移动|滑动|转动)|保持(?:不动|不变)|不可(?:伸缩|变形)/.test(
          sections.get('支撑与受力') ?? '',
        ),
      detail: '明确刚性结构的长度、杆件/间距、连接点、底座及允许的整体位移；禁止弹簧式伸缩或局部变形',
    },
    {
      code: 'RIGID_CONTRADICTION_REVIEW',
      section: '支撑与受力',
      needed: rigidContradiction,
      detail: '固定刚性设施不能同时写成可弯曲或可伸缩；改为整体受力、整体位移或保持不动',
    },
    {
      code: 'POPULATION_LAYOUT_REVIEW',
      section: '群体与纵深',
      needed: /人群|群众|人潮|队伍|密集|拥挤|crowd/iu.test(local),
      detail: '写明剧情规模、前中远景分布及画面外延伸边界',
    },
    {
      code: 'RESPONSE_PLAN_REVIEW',
      section: '职责与反应',
      needed:
        /士兵|守卫|警卫|保安|警察|医护|执勤|值守|soldier|guard/iu.test(roles) &&
        /推|撞|冲|挤|倒地|受伤|失控|求救|危险/.test(local),
      detail: '核对已在场人员能否感知事态、如何回应或为何不回应',
    },
  ]
  return checks
    .filter(
      (check) =>
        check.needed &&
        (check.code === 'RIGID_STRUCTURE_REVIEW'
          ? !hasRigidStructureSpec
          : check.code === 'RIGID_CONTRADICTION_REVIEW'
            ? true
            : !sections.get(check.section)?.trim()),
    )
    .map((check) => ({
      code: check.code,
      severity: 'warning' as const,
      message:
        check.code === 'RIGID_CONTRADICTION_REVIEW'
          ? `本镜“${check.section}”存在固定设施与弯曲/伸缩语义冲突；请${check.detail}。`
          : `本镜涉及“${check.section}”，尚无独立制作约定；请${check.detail}。这是缺项提示，不代表已判定画面错误。`,
      evidence: [local.trim().slice(0, 240)],
    }))
}
