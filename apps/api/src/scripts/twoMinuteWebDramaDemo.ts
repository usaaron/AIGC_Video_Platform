import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const API_BASE = process.env.DEMO_API_BASE_URL || 'http://127.0.0.1:8787/api/v1'
const EMAIL = process.env.DEMO_EMAIL || 'member@seqora.local'
const PASSWORD = process.env.DEMO_PASSWORD || 'MemberPassword123!'
const PROJECT_NAME = '碎星逆命｜2分钟网剧工作流验收'
const OUTPUT_PATH = resolve('artifacts', '碎星逆命-2分钟网剧验收.mp4')
const TARGET_SHOTS = 24
const POLL_INTERVAL_MS = 5_000
const VIDEO_TIMEOUT_MS = 70 * 60_000

type JsonRecord = Record<string, unknown>

type Project = {
  id: string
  name: string
  script: string
  aspectRatio: string
  visualStyle?: string
  episodeDurationSeconds?: number
}

type Asset = {
  id: string
  name: string
  kind: 'character' | 'scene' | 'prop' | 'costume' | 'audio'
  imageUrl: string | null
  attributes: JsonRecord
}

type Shot = {
  id: string
  order: number
  title: string
  framing: string
  duration: number
  prompt: string
  negativePrompt: string
  imageUrl: string | null
  continuityMode: 'independent' | 'continue'
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

type AssetDefinition = {
  kind: 'character' | 'scene' | 'prop'
  name: string
  description: string
  prompt: string
  negativePrompt: string
  attributes: JsonRecord
}

let cookie = ''

const direction = {
  style: 'cinematic-cg',
  composition: 'dynamic',
  lighting: 'high-contrast',
  camera: 'immersive',
  focus: 'character',
}

const synopsis =
  '青玄宗灵碑考核上，外门弟子林砚被当众判定为废体。赵烈夺走他母亲留下的碎星玉并极尽羞辱，苏晚出面阻拦。就在所有人认定林砚再无翻身可能时，碎星玉与沉寂千年的测灵石碑同时觉醒。'

const productionScript = `场次：S01｜剧情：青玄宗年度灵碑考核开始，林砚站在候考队尾观察测灵石碑，赵烈带人从他身旁挤过并故意撞肩，冲突被迅速建立。｜场景：青玄宗考核广场，清晨，古代修仙宗门，中央黑色测灵石碑高三丈，左侧候考区，右侧长老席，远处云海与飞檐，地面青石干燥。｜角色：林砚（主，左后方队尾，灰蓝外门弟子服，克制而警觉）；赵烈（配角，前景右侧，赤黑锦袍，傲慢）；苏晚（配角，长老席旁，月白衣裙，平静观察）；候考弟子（背景，排队、低声交谈、有人回头看冲突）。｜动作：动作1：铜钟响起，林砚抬眼看向石碑并缓慢握紧碎星玉，眼神从紧张变得坚定；动作2：赵烈侧肩撞开林砚抢到队前，回头挑眉冷笑，附近弟子停下交谈并交换视线。｜对白：[画外音]司礼长老：灵碑考核，现在开始。[对白]赵烈：废物也配排在我前面？｜风格：高品质影视CG，东方玄幻，真实材质，冷青晨雾与金色天光对比。｜构图：竖屏中大全景，石碑居中贯穿画面，人物形成前中后景层次。｜光影：右上方清晨金色硬光，石碑左侧冷色阴影，角色轮廓光清晰。｜运镜：低机位沿青石地面快速前推至林砚中近景，再小幅横移接住赵烈撞肩。｜衔接：结尾停在赵烈回头冷笑、林砚右手握玉、队伍重新移动的状态。
场次：S02｜剧情：赵烈率先测试并引发耀眼火灵光，全场欢呼，他借势回头挑衅林砚，令考核压力进一步升高。｜场景：青玄宗考核广场，清晨，测灵石碑前，空间与S01一致，石碑表面亮起赤色纹路。｜角色：赵烈（主，石碑前正中，赤黑锦袍，得意）；林砚（中景队尾，注视石碑，神情收紧）；苏晚（右后方，微微蹙眉）；候考弟子（背景，向前探身、鼓掌、惊叹）。｜动作：动作1：赵烈把掌心按上石碑，赤色灵纹从掌下向上疾冲，他由专注转为狂喜；动作2：火光照亮广场，赵烈转身张开双臂接受欢呼，弟子们同时后仰避光再兴奋围近。｜对白：[对白]司礼长老：上品火灵根！[对白]赵烈：看清楚，这才叫天赋。｜风格：影视CG东方玄幻，赤色能量与冷青石材形成强烈对比。｜构图：仰拍中景，赵烈与石碑形成三角构图，林砚位于后景左侧。｜光影：石碑赤色自发光为主光，清晨侧光补轮廓，避免过曝。｜运镜：绕赵烈半圈快速环移，落点停在他越肩看向林砚的视线上。｜衔接：承接S01队伍移动，结尾保持赵烈面向林砚、石碑赤纹尚未完全熄灭。
场次：S03｜剧情：轮到林砚上前，赵烈故意伸脚阻拦，林砚稳住身体没有摔倒，苏晚捕捉到这一细节。｜场景：青玄宗考核广场，清晨，石碑前通道，赤色余光渐暗。｜角色：林砚（主，从左后方向中央走，灰蓝弟子服，克制）；赵烈（右前方，脚尖伸入通道，假装整理袖口）；苏晚（右后方，目光转向赵烈脚下）；候考弟子（背景，让开窄道、有人掩嘴笑）。｜动作：动作1：林砚从赵烈身旁经过时被绊得身体前倾，左脚迅速踏稳青石，表情从意外变为冷静；动作2：他没有争辩，只抬眼直视赵烈一瞬后继续走向石碑，苏晚的眼神由平静变为不满。｜对白：[内心独白]林砚：今天，我必须知道答案。[对白]赵烈：路都走不稳，还测什么灵根。｜风格：影视CG东方玄幻，动作清晰，人物比例稳定。｜构图：侧面中近景，赵烈脚尖在前景，林砚身体动作在画面中心，苏晚在后景右侧。｜光影：冷青环境光为主，赤色余光扫过人物下颌。｜运镜：先跟拍林砚脚步，绊倒瞬间轻微急停，再上摇到两人对视。｜衔接：承接S02赵烈的站位，结尾林砚已走到石碑前半步位置。
场次：S04｜剧情：林砚按上测灵石碑，碑面毫无反应，漫长半秒后只亮起一道灰纹，司礼长老宣布废体。｜场景：青玄宗考核广场，清晨，测灵石碑正前方，周围人群形成半圆。｜角色：林砚（主，正中面对石碑，右掌贴碑，期待转为错愕）；司礼长老（右侧高台，抬手宣判）；赵烈（后景抱臂冷笑）；苏晚（后景向前一步）；候考弟子（背景，先屏息再骚动）。｜动作：动作1：林砚掌心贴上石碑，灰纹微弱闪烁后迅速熄灭，他的瞳孔收缩、嘴角绷紧；动作2：司礼长老放下记录笔挥手示意结束，人群从安静变成交头接耳，赵烈低头笑出声。｜对白：[对白]司礼长老：无灵根，废体。[环境声]低沉钟鸣与人群议论同时涌起。｜风格：影视CG东方玄幻，压迫感增强，避免空镜。｜构图：正面中景，林砚被高耸石碑压在画面下部，人群围成封闭背景。｜光影：晨光被云层遮住，整体转冷，灰纹短暂照亮掌心。｜运镜：缓慢推近掌心与灰纹，宣判时快速切到林砚面部反应。｜衔接：承接S03林砚到达石碑，结尾保持他手掌刚离开碑面、右肩下沉。
场次：S05｜剧情：宣判引爆嘲笑，赵烈穿过人群逼近林砚，逐句揭开两人的旧怨，林砚仍强忍不发。｜场景：青玄宗考核广场，清晨，石碑前半圆空地，人群靠近形成压力。｜角色：林砚（主，石碑左前方，低头看掌心，羞辱与克制交替）；赵烈（主对手，从右侧逼近，得意）；苏晚（后景右侧，向两人靠近）；候考弟子（背景，有人摇头、有人窃笑、有人同情避开视线）。｜动作：动作1：赵烈拨开两名弟子走到林砚面前，用指尖点了点他胸口，林砚下颌收紧却没有后退；动作2：赵烈摊手转向众人煽动嘲笑，背景弟子的表情分化，苏晚快步向前。｜对白：[对白]赵烈：你父亲失踪，你又是废体，林家到头了。[内心独白]林砚：忍住。碎星玉还在。｜风格：影视CG东方玄幻，群像反应明确。｜构图：竖屏双人中近景，赵烈占前景高位，林砚被石碑阴影压住，背景人物呈弧线。｜光影：高反差侧光，赵烈受暖光，林砚处冷阴影，苏晚有细窄轮廓光。｜运镜：从林砚掌心上摇到面部，再向右横移接住赵烈逼近。｜衔接：承接S04宣判，结尾苏晚距离两人只剩三步，赵烈右手仍抬在胸前。
场次：S06｜剧情：赵烈发现林砚颈间的碎星玉，故意当众扯下并宣称废物不配拥有灵物，关键物件被夺走。｜场景：青玄宗考核广场，清晨，石碑前，人物站位延续S05。｜角色：林砚（主，左侧，惊怒）；赵烈（右侧近身，盯住碎星玉）；苏晚（后景加速靠近）；候考弟子（背景，笑声停止、齐齐看向玉佩）。｜动作：动作1：赵烈视线落到林砚衣领，突然伸手扯断细绳，碎星玉从林砚胸前滑入赵烈掌心，林砚由克制转为震怒；动作2：赵烈举起碎星玉迎着晨光左右翻看，林砚立即抓住他的手腕，周围弟子同时后退让出空间。｜对白：[对白]林砚：还给我。[对白]赵烈：一块破玉，也值得你拼命？｜风格：影视CG东方玄幻，物件状态清楚，不新增道具。｜构图：手部与碎星玉特写切双人近景，玉佩始终位于画面视觉中心。｜光影：晨光穿透玉佩形成冷白微光，人物面部保持正常曝光。｜运镜：快速推近扯断动作，随赵烈举手上摇，再拉回双人对峙。｜衔接：承接S05赵烈抬起的右手，结尾林砚抓住其手腕、玉佩悬在两人之间。
场次：S07｜剧情：赵烈借修为震开林砚，碎星玉险些落地，苏晚在最后一刻接住玉佩并站到两人中间。｜场景：青玄宗考核广场，清晨，石碑前空地，人群退成更大的半圆。｜角色：林砚（主，左侧被震退，痛苦转警觉）；赵烈（右侧，掌心赤光，恼怒）；苏晚（从后景切入中央，接住碎星玉，坚定）；候考弟子（背景，受气浪影响抬臂遮挡、衣摆摆动）。｜动作：动作1：赵烈手腕爆开一圈赤色气浪，林砚松手后退两步以单膝撑地，背景人群同步后仰遮脸；动作2：碎星玉脱手旋转下落，苏晚从侧面伸手稳稳接住并挡在林砚前方，神情由担忧变为冷峻。｜对白：[对白]苏晚：考核广场，不是你欺人的地方。[对白]赵烈：你要替一个废物出头？｜风格：影视CG东方玄幻，能量克制，动作连贯。｜构图：动态对角线构图，林砚低位、苏晚中位、赵烈高位，背景群像完整。｜光影：赤色气浪短暂照亮地面，苏晚受右上方冷白轮廓光。｜运镜：气浪爆发时快速后拉，跟随玉佩下落再横移锁定苏晚接住。｜衔接：承接S06手腕对峙，结尾苏晚掌心托住碎星玉，林砚仍单膝着地。
场次：S08｜剧情：苏晚准备把碎星玉归还林砚，赵烈却以宗规相逼并再次伸手争抢，三人关系公开撕裂。｜场景：青玄宗考核广场，清晨，测灵石碑旁，石碑灰纹仍暗。｜角色：苏晚（主，中央，右手托玉，左手挡住赵烈）；林砚（左后方起身，视线锁定玉佩）；赵烈（右前方逼近，恼羞成怒）；司礼长老（高台皱眉观察）；候考弟子（背景，安静注视、有人悄悄后退）。｜动作：动作1：苏晚转身把碎星玉递向刚起身的林砚，林砚伸手但在触碰前停住，二人眼神短暂交汇；动作2：赵烈从侧面扣住苏晚手腕想夺玉，苏晚立即旋腕避开，林砚跨步挡到赵烈与苏晚之间。｜对白：[对白]苏晚：这是他的东西。[对白]赵烈：废体不得私藏灵物，这是宗规。｜风格：影视CG东方玄幻，人物关系与手部动作清晰。｜构图：三人近景三角构图，碎星玉居中心，司礼长老在后景高位。｜光影：冷暖交界落在碎星玉与三人手部，面部用柔和补光。｜运镜：从玉佩跟随苏晚转身，赵烈出手时快速横摇，停在林砚挡位的肩线。｜衔接：承接S07苏晚托玉姿态，结尾林砚站在中央、碎星玉仍在苏晚手中。
场次：S09｜剧情：司礼长老默许赵烈取走碎星玉，苏晚被迫松手；赵烈把玉按向测灵石碑，企图证明它只是凡物。｜场景：青玄宗考核广场，清晨，测灵石碑前，风势渐强，云层压低。｜角色：赵烈（主对手，中央握玉走向石碑，得意）；林砚（左侧被两名执事拦住，愤怒）；苏晚（右侧握拳，难以置信）；司礼长老（高台轻轻点头）；候考弟子（背景，跟随赵烈转身、表情期待）。｜动作：动作1：司礼长老抬手示意苏晚退下，两名执事横臂拦住林砚，苏晚迟疑后松开玉佩；动作2：赵烈接过碎星玉走到石碑前，用力把玉按在灰纹中央，回头挑衅林砚。｜对白：[对白]司礼长老：既称灵物，便让灵碑一验。[对白]林砚：别碰它！｜风格：影视CG东方玄幻，风压与冲突升级。｜构图：纵深构图，赵烈与石碑在前景中央，林砚被压在后景左侧，苏晚在右侧。｜光影：云层遮光，广场转为低调冷色，碎星玉出现微弱冷白边光。｜运镜：跟随玉佩从苏晚手中交到赵烈手中，再推进石碑接触点。｜衔接：承接S08三人站位，结尾玉佩已紧贴石碑，林砚身体向前挣扎。
场次：S10｜剧情：碎星玉与石碑接触后先毫无反应，赵烈正要嘲笑，玉内突然出现星点，林砚与玉佩产生同步心跳。｜场景：青玄宗考核广场，清晨，测灵石碑前，环境瞬间安静，风吹动衣摆。｜角色：赵烈（主对手，手掌压玉，得意转疑惑）；林砚（后景左侧，停止挣扎，震惊）；苏晚（右侧，目光在林砚与玉之间移动）；候考弟子（背景，屏息前倾）；司礼长老（高台起身）。｜动作：动作1：赵烈侧脸准备开口嘲笑，碎星玉内部亮起第一颗银蓝星点，他的笑容僵住、手指下意识松动；动作2：林砚胸口随低沉心跳声起伏，他抬头与玉佩同步亮起眼底微光，所有背景弟子停止动作齐看石碑。｜对白：[对白]赵烈：我就说它是——[音效]低沉心跳两声，玉石轻鸣。[内心独白]林砚：它在回应我。｜风格：影视CG东方玄幻，神秘感上升，星光细腻。｜构图：玉佩极近特写切林砚面部近景，再回到群像反应。｜光影：银蓝星点作为局部主光，照亮赵烈指尖与林砚瞳孔，背景压暗。｜运镜：极慢推进玉内星点，心跳第二声时快速对切林砚眼睛。｜衔接：承接S09玉佩贴碑状态，结尾赵烈手指松动但玉佩没有掉落。
场次：S11｜剧情：测灵石碑从玉佩接触点裂开银蓝纹路，沉睡的古老星图铺满碑面，司礼长老与全场同时失态。｜场景：青玄宗考核广场，清晨，测灵石碑前，云层被星光映亮，地面纹路同步发光。｜角色：林砚（主，左侧向前一步，震惊转清醒）；赵烈（石碑前踉跄后退，恐惧）；苏晚（右侧护住眼睛后重新看向林砚，惊喜）；司礼长老（高台站起，记录笔落地）；候考弟子（背景，先后退再仰头，有人跪下、有人互相搀扶）。｜动作：动作1：银蓝裂纹沿石碑向上急速蔓延，赵烈被震得松手后退，碎星玉悬在碑前不坠；动作2：古老星图覆盖石碑，地面光环扫过人群，司礼长老失手掉笔，背景弟子形成连续后退与抬头反应。｜对白：[对白]司礼长老：这是……碎星命纹！[环境声]石碑轰鸣、衣摆猎响、人群惊呼。｜风格：影视CG东方玄幻，宏大但画面信息可读。｜构图：低机位大全景，石碑贯穿竖屏，悬浮玉佩与林砚处在同一视觉轴。｜光影：银蓝能量自下而上，金色晨光从云缝穿出，避免爆闪和过曝。｜运镜：沿裂纹高速上摇至碑顶，再俯冲回落到林砚向前迈步。｜衔接：承接S10玉佩未落状态，结尾林砚迈出一步、赵烈退到右侧、玉佩悬浮在中央。
场次：剧情钩子｜剧情：碎星玉越过赵烈飞回林砚掌心，林砚第一次抬眼直面所有轻视他的人；赵烈仍不甘心地挥拳冲来，画面停在林砚即将反击的前一瞬。｜场景：青玄宗考核广场，清晨，测灵石碑完全点亮，银蓝星图稳定存在，人物位置承接S11。｜角色：林砚（主，中央偏左，接住玉佩，错愕转为冷静锋利）；赵烈（右侧冲来，恐惧转恼怒）；苏晚（后景右侧，先松一口气再警觉伸手）；司礼长老（高台震惊凝视）；候考弟子（背景，有人后退、有人屏息、有人看向赵烈形成群像反应）。｜动作：动作1：悬浮碎星玉划出银蓝光轨飞入林砚摊开的右掌，他收拢五指，肩背从压抑变得挺直，眼神明显变冷；动作2：赵烈怒吼着跨步挥拳，林砚只抬起左手准备格挡，苏晚与背景弟子同时露出惊讶表情，拳头距离林砚只剩半臂时定格。｜对白：[内心独白]林砚：原来不是我没有灵根。[对白]赵烈：装神弄鬼！｜风格：高品质影视CG东方玄幻，强钩子收束，不提前展示反击结果。｜构图：林砚中近景居中，赵烈的拳从右前景进入，苏晚与群像在后景形成反应层。｜光影：银蓝星光勾勒林砚轮廓，赵烈仍处赤色余光，冷暖对撞。｜运镜：跟随玉佩飞行推向林砚，接住后轻微环绕到正面，赵烈出拳时急推并在碰撞前定格。｜衔接：承接S11所有物件和站位，结尾保留林砚抬手、赵烈出拳、玉佩握在右掌的明确下一集动作接点。`

const assetDefinitions: AssetDefinition[] = [
  character(
    '林砚',
    '22岁东方男性，清瘦挺拔，黑色束发，眉眼克制坚韧，灰蓝色外门弟子服，主角。',
    '22岁东方男性，清瘦挺拔，黑色长发高束，深棕瞳孔，眉眼克制坚韧，灰蓝色古代修仙宗门外门弟子服，衣料朴素但整洁，青少年向高品质影视CG角色设计。',
    'male',
    22,
  ),
  character(
    '赵烈',
    '24岁东方男性，体格强健，短束发，眉峰锐利，赤黑锦袍，傲慢强势的对手。',
    '24岁东方男性，体格强健，黑色短发束冠，深棕瞳孔，眉峰锐利，赤黑色古代修仙宗门锦袍带暗金火纹，傲慢强势，高品质影视CG角色设计。',
    'male',
    24,
  ),
  character(
    '苏晚',
    '21岁东方女性，修长清秀，黑色长发半束，月白衣裙，沉静坚定。',
    '21岁东方女性，修长清秀，黑色长发半束，深棕瞳孔，五官清晰自然，月白与浅蓝配色的古代修仙宗门衣裙，沉静坚定，高品质影视CG角色设计。',
    'female',
    21,
  ),
  {
    kind: 'scene',
    name: '青玄宗考核广场',
    description: '建于云海山巅的古代修仙宗门考核广场，中央矗立黑色测灵石碑。',
    prompt:
      '高品质影视CG东方玄幻场景，古代修仙宗门青玄宗考核广场，云海山巅，纵向青石广场，中央三丈高黑色测灵石碑，左侧候考区域，右侧木石结构长老席，远处飞檐、山门与翻涌云海，清晨冷青环境光与金色天光，空场景，无人物无动物，预留中央表演区域和前后运镜通道，空间尺度与材质真实稳定，竖屏9:16。',
    negativePrompt:
      '不要人物、动物、文字、水印、logo、现代建筑、汽车、电线、烟雾遮挡、重复石碑、悬浮建筑、结构断裂、过曝。',
    attributes: {
      type: 'scene',
      space: 'exterior',
      sceneType: 'ancient',
      era: 'ancient',
      time: 'dawn',
      weather: 'clear',
      mood: 'epic',
      camera: 'wide',
      visualStyle: 'cinematic-cg',
      emptyScene: true,
      activitySpace: true,
    },
  },
  {
    kind: 'prop',
    name: '测灵石碑',
    description: '青玄宗传承千年的黑色测灵石碑，可显现灵根与碎星命纹。',
    prompt:
      '单个古代修仙宗门测灵石碑独立资产，三丈高的细长黑色玄石碑，厚重稳定，表面有极淡的古老竖向灵纹和中央圆形检测区域，石材边缘磨损，影视CG东方玄幻，完整轮廓，正面视图，中性纯色背景，竖屏9:16。',
    negativePrompt: '不要人物、人体、手、文字、书法、现代标牌、多个石碑、断裂、悬浮、过度发光、水印、logo。',
    attributes: {
      type: 'prop',
      category: 'other',
      material: 'mixed',
      condition: 'aged',
      view: 'front',
      background: 'solid',
      visualStyle: 'cinematic-cg',
    },
  },
  {
    kind: 'prop',
    name: '碎星玉',
    description: '林砚母亲留下的银蓝色小玉佩，是剧情觉醒核心。',
    prompt:
      '单个银蓝色碎星玉佩独立资产，小型椭圆古玉，半透明冷白玉质，内部封存细微银蓝星点，外缘有简洁古纹，配一根深灰细绳，影视CG东方玄幻，完整轮廓，正面近距离展示，中性纯色背景，1:1。',
    negativePrompt:
      '不要人物、人体、手、手指、佩戴状态、多个玉佩、项链堆叠、文字、logo、水印、过曝、塑料质感。',
    attributes: {
      type: 'prop',
      category: 'jewelry',
      material: 'mixed',
      condition: 'aged',
      view: 'front',
      background: 'solid',
      visualStyle: 'cinematic-cg',
    },
  },
]

async function main() {
  await login()
  const project = await ensureProject()
  log(`项目：${project.name} (${project.id})`)

  const script = await ensureScript(project)
  log(`剧本：${script.replace(/\s/gu, '').length} 字，${script.split(/\n+/u).filter(Boolean).length} 个场次`)

  await ensureAssetSuggestions(project.id, script)
  await ensureAssets(project.id)
  await ensureAssetImages(project.id)

  const shots = await ensureShots(project.id)
  log(`分镜：${shots.length} 镜，页面标注时长 ${shots.reduce((sum, shot) => sum + shot.duration, 0)} 秒`)

  await retryStage('分镜视频', () => ensureVideos(project.id), 32)
  const preview = await ensureFilmPreview(project.id)
  await downloadPreview(preview)

  const result = {
    projectId: project.id,
    projectName: project.name,
    outputPath: OUTPUT_PATH,
    completedAt: new Date().toISOString(),
  }
  await mkdir(resolve('artifacts'), { recursive: true })
  await writeFile(
    resolve('artifacts', 'two-minute-demo-result.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  )
  log(`完成：${OUTPUT_PATH}`)
}

function character(
  name: string,
  description: string,
  prompt: string,
  gender: 'male' | 'female',
  exactAge: number,
): AssetDefinition {
  return {
    kind: 'character',
    name,
    description,
    prompt: `${prompt}，透明背景，Alpha通道，无背景色，无投影，无环境反射，均匀平光，主体边缘清晰，正面平视人物面部大头照，头部和肩部完整入镜，自然中性表情，不出现手部、文字和饰边，画面比例1:1。`,
    negativePrompt:
      '不要磨皮过度、塑料皮肤、假人感、娃娃脸蜡像脸、玻璃眼、空洞眼神、斜视、眼睛不对称、歪鼻子、歪嘴、畸形、多余肢体、手部、文字、水印、logo、背景、投影。',
    attributes: {
      type: 'character',
      subjectType: 'human',
      gender,
      ageGroup: 'young',
      exactAge,
      ethnicity: 'east-asian',
      skinTone: 'light',
      eyeColor: 'dark-brown',
      hairColor: 'black',
      species: '',
      anthropomorphic: false,
      visualStyle: 'cinematic-cg',
      framing: 'portrait',
      bodyType: name === '赵烈' ? 'athletic' : 'slim',
      background: 'transparent',
      faceStatus: 'pending',
      bodyStatus: 'pending',
      faceReference: null,
      bodyReference: null,
      portraitSource: 'ai-virtual',
      trustedPortrait: null,
      legStretch: false,
      turnaround: false,
      turnaroundLayout: 'sheet',
      appearanceVariants: [],
      activeAppearanceVariantId: null,
    },
  }
}

async function login() {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!response.ok) throw new Error(`登录失败 (${response.status}): ${await response.text()}`)
  const setCookie = response.headers.get('set-cookie')
  cookie = setCookie?.split(';', 1)[0] || ''
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
  if (response.status === 204) return null as T
  return (await response.json()) as T
}

async function ensureProject(): Promise<Project> {
  const projects = await api<Project[]>('/projects')
  const existing = projects.find((project) => project.name === PROJECT_NAME)
  if (existing) {
    await api<Project>(`/projects/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        synopsis,
        visualStyle: 'cinematic-cg',
        episodeDurationSeconds: 120,
        status: 'producing',
      }),
    })
    return existing
  }

  const created = await api<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: PROJECT_NAME,
      contentType: 'short-drama',
      visualStyle: 'cinematic-cg',
      episodeDurationSeconds: 120,
      aspectRatio: '9:16',
    }),
  })
  return api<Project>(`/projects/${created.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ synopsis, status: 'producing' }),
  })
}

async function ensureScript(project: Project): Promise<string> {
  let workspace = await workspaceFor(project.id)
  if (workspace.project.script.includes('碎星玉') && sceneCount(workspace.project.script) >= 10) {
    const normalized = normalizeStoryboardActions(workspace.project.script)
    if (normalized !== workspace.project.script) {
      await api<Project>(`/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ script: normalized }),
      })
    }
    return normalized
  }

  const existing = findTask(
    await tasksFor(project.id),
    (task) => task.kind === 'text' && task.metadata.generationStage === 'script-generate',
  )
  const task =
    existing && !terminalFailure(existing)
      ? existing
      : await createTask(project.id, {
          kind: 'text',
          label: '2分钟网剧剧本',
          provider: 'text',
          model: 'glm-5.2',
          estimatedCredits: 3,
          metadata: {
            generationStage: 'script-generate',
            scriptOperation: 'generate',
            billingMode: 'prepaid',
            draft: productionScript,
            direction,
            mode: 'quick',
            productionMode: 'web-series',
            episodeMinutes: 2,
            episodeDurationSeconds: 120,
            model: 'glm-5.2',
            revisionNote:
              '严格保留12个连续场次、三个固定主要人物、一个固定场景和两个关键物件；结尾停在林砚反击前。每场动作与对白必须可在短镜头内执行。',
          },
        })
  const completed = await waitForTask(project.id, task.id, 12 * 60_000)
  const generated = textResult(completed)?.script
  const selected = normalizeStoryboardActions(
    typeof generated === 'string' && generated.includes('碎星玉') && sceneCount(generated) >= 10
      ? generated
      : productionScript,
  )
  if (selected === productionScript && generated !== productionScript) {
    log(`剧本模型输出仅 ${sceneCount(String(generated || ''))} 个有效场次，已启用制作级原稿保护`)
  }
  await api<Project>(`/projects/${project.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ script: selected }),
  })
  workspace = await workspaceFor(project.id)
  return workspace.project.script
}

async function ensureAssetSuggestions(projectId: string, script: string) {
  const tasks = await tasksFor(projectId)
  const completed = tasks.find(
    (task) =>
      task.kind === 'text' &&
      task.metadata.generationStage === 'script-asset-suggestions' &&
      task.status === 'completed',
  )
  if (completed) return
  const active = findTask(
    tasks,
    (task) => task.kind === 'text' && task.metadata.generationStage === 'script-asset-suggestions',
  )
  const task =
    active && !terminalFailure(active)
      ? active
      : await createTask(projectId, {
          kind: 'text',
          label: '资产建议',
          provider: 'text',
          model: 'glm-5.2',
          estimatedCredits: 2,
          metadata: {
            generationStage: 'script-asset-suggestions',
            scriptOperation: 'suggest-assets',
            billingMode: 'prepaid',
            script,
            direction,
            model: 'glm-5.2',
          },
        })
  const result = await waitForTask(projectId, task.id, 8 * 60_000)
  const suggestions = textResult(result)?.assets
  if (Array.isArray(suggestions)) {
    log(
      `资产建议：${suggestions
        .map((item) => String((item as JsonRecord).name || ''))
        .filter(Boolean)
        .join('、')}`,
    )
  }
}

async function ensureAssets(projectId: string) {
  const workspace = await workspaceFor(projectId)
  for (const definition of assetDefinitions) {
    if (workspace.assets.some((asset) => asset.name === definition.name && asset.kind === definition.kind))
      continue
    await api<Asset>(`/projects/${projectId}/assets`, {
      method: 'POST',
      body: JSON.stringify({
        ...definition,
        sourceMode: 'generate',
        promptMode: 'advanced',
        customPromptMode: 'replace',
        customPrompt: definition.prompt,
        references: [],
        imageUrl: null,
      }),
    })
    log(`已创建资产：${definition.name}`)
  }
}

async function ensureAssetImages(projectId: string) {
  let workspace = await workspaceFor(projectId)
  const tasks = await tasksFor(projectId)
  const firstWave: string[] = []
  for (const asset of workspace.assets.filter((item) =>
    assetDefinitions.some((definition) => definition.name === item.name),
  )) {
    if (asset.kind === 'character') {
      const faceReference = asRecord(asset.attributes.faceReference)
      if (typeof faceReference?.url === 'string') continue
      const existing = latestAssetTask(tasks, asset.id, 'face')
      if (existing && !terminalFailure(existing)) {
        firstWave.push(existing.id)
        continue
      }
      firstWave.push(
        (
          await createTask(projectId, {
            kind: 'image',
            label: `${asset.name} · 面部大头照`,
            prompt: assetPrompt(asset.name),
            negativePrompt: assetNegativePrompt(asset.name),
            provider: 'img2',
            model: 'img2-default',
            estimatedCredits: 4,
            metadata: {
              assetId: asset.id,
              assetKind: asset.kind,
              generationStage: 'face',
              aspectRatio: '1:1',
              sourceMode: 'generate',
              references: [],
              attributes: asset.attributes,
            },
          })
        ).id,
      )
      continue
    }
    if (asset.imageUrl) continue
    const existing = latestAssetTask(tasks, asset.id, 'asset')
    if (existing && !terminalFailure(existing)) {
      firstWave.push(existing.id)
      continue
    }
    firstWave.push(
      (
        await createTask(projectId, {
          kind: 'image',
          label: `${asset.name} · 资产生成`,
          prompt: assetPrompt(asset.name),
          negativePrompt: assetNegativePrompt(asset.name),
          provider: 'img2',
          model: 'img2-default',
          estimatedCredits: 6,
          metadata: {
            assetId: asset.id,
            assetKind: asset.kind,
            generationStage: 'asset',
            aspectRatio: asset.name === '碎星玉' ? '1:1' : '9:16',
            sourceMode: 'generate',
            references: [],
            attributes: asset.attributes,
          },
        })
      ).id,
    )
  }
  if (firstWave.length) await waitForTasks(projectId, firstWave, 18 * 60_000, '首轮资产')

  workspace = await workspaceFor(projectId)
  const secondWave: string[] = []
  const currentTasks = await tasksFor(projectId)
  for (const asset of workspace.assets.filter(
    (item) =>
      item.kind === 'character' && assetDefinitions.some((definition) => definition.name === item.name),
  )) {
    let attributes = asset.attributes
    let faceReference = asRecord(attributes.faceReference)
    if (typeof faceReference?.url !== 'string') {
      const faceTask = latestAssetTask(currentTasks, asset.id, 'face')
      if (!faceTask?.resultUrl) throw new Error(`${asset.name} 面部图没有可用结果`)
      faceReference = { id: faceTask.id, url: faceTask.resultUrl, name: `${asset.name}-face.png` }
      attributes = { ...attributes, faceStatus: 'approved', faceReference }
      await updateAsset(projectId, asset.id, { attributes, status: 'confirmed' })
    }
    const bodyReference = asRecord(attributes.bodyReference)
    if (typeof bodyReference?.url === 'string') continue
    const existing = latestAssetTask(currentTasks, asset.id, 'body')
    if (existing && !terminalFailure(existing)) {
      secondWave.push(existing.id)
      continue
    }
    secondWave.push(
      (
        await createTask(projectId, {
          kind: 'image',
          label: `${asset.name} · 全身设定`,
          prompt: `${assetBodyPrompt(asset.name)}，严格保持面部参考图的身份、五官、年龄、发型与服装配色一致，人物全身从头到脚完整入镜，标准自然站姿，透明Alpha背景，均匀平光，无投影，竖屏9:16。`,
          negativePrompt: assetNegativePrompt(asset.name),
          provider: 'img2',
          model: 'img2-default',
          estimatedCredits: 6,
          metadata: {
            assetId: asset.id,
            assetKind: asset.kind,
            generationStage: 'body',
            aspectRatio: '9:16',
            sourceMode: 'generate',
            references: [faceReference],
            attributes,
          },
        })
      ).id,
    )
  }
  if (secondWave.length) await waitForTasks(projectId, secondWave, 18 * 60_000, '人物全身')

  workspace = await workspaceFor(projectId)
  const finalTasks = await tasksFor(projectId)
  for (const asset of workspace.assets.filter(
    (item) =>
      item.kind === 'character' && assetDefinitions.some((definition) => definition.name === item.name),
  )) {
    const bodyReference = asRecord(asset.attributes.bodyReference)
    if (typeof bodyReference?.url === 'string') continue
    const bodyTask = latestAssetTask(finalTasks, asset.id, 'body')
    if (!bodyTask?.resultUrl) throw new Error(`${asset.name} 全身图没有可用结果`)
    await updateAsset(projectId, asset.id, {
      attributes: {
        ...asset.attributes,
        bodyStatus: 'approved',
        bodyReference: { id: bodyTask.id, url: bodyTask.resultUrl, name: `${asset.name}-body.png` },
      },
      status: 'confirmed',
    })
  }
  log('角色面部、全身、场景和关键物件资产已完成')
}

async function ensureShots(projectId: string): Promise<Shot[]> {
  let workspace = await workspaceFor(projectId)
  const lastShot = workspace.shots.at(-1)
  const hasCompleteStory =
    workspace.shots.length === TARGET_SHOTS &&
    Boolean(lastShot?.prompt.includes('剧情钩子') || lastShot?.prompt.includes('装神弄鬼'))
  if (!hasCompleteStory) {
    const generated = await api<Shot[]>(`/projects/${projectId}/shots/generate`, {
      method: 'POST',
      body: JSON.stringify({ maxShots: TARGET_SHOTS, mode: 'beat', episodeDurationSeconds: 120 }),
    })
    if (generated.length < TARGET_SHOTS) {
      throw new Error(`分镜只生成 ${generated.length} 镜，未达到 ${TARGET_SHOTS} 镜验收线`)
    }
    workspace = await workspaceFor(projectId)
  }

  for (const shot of workspace.shots) {
    const desired = (shot.order - 1) % 3 === 0 ? 'independent' : 'continue'
    if (shot.continuityMode !== desired) {
      await api<Shot>(`/projects/${projectId}/shots/${shot.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ continuityMode: desired }),
      })
    }
  }
  return (await workspaceFor(projectId)).shots
}

async function ensureVideos(projectId: string) {
  const workspace = await workspaceFor(projectId)
  const lanes: Shot[][] = []
  for (const shot of workspace.shots) {
    const lane = Math.floor((shot.order - 1) / 3)
    ;(lanes[lane] ??= []).push(shot)
  }

  // StringX uses a shared pool. Two lanes keep real concurrency without
  // overwhelming task creation, while each lane still carries its own tail frame.
  for (let laneOffset = 0; laneOffset < lanes.length; laneOffset += 2) {
    const laneBatch = lanes.slice(laneOffset, laneOffset + 2)
    const depthCount = Math.max(...laneBatch.map((lane) => lane.length))
    for (let depth = 0; depth < depthCount; depth += 1) {
      let tasks = await tasksFor(projectId)
      const taskIds: string[] = []
      for (const laneShots of laneBatch) {
        const shot = laneShots[depth]
        if (!shot || latestCompletedVideo(tasks, shot.id)) continue

        const active = findTask(tasks, (task) => task.kind === 'video' && task.metadata.shotId === shot.id)
        if (active && !terminalFailure(active)) {
          taskIds.push(active.id)
          continue
        }

        const previousShot = depth > 0 ? laneShots[depth - 1] : null
        const source = previousShot ? latestCompletedVideoWithLastFrame(tasks, previousShot.id) : null
        if (previousShot && !source) {
          throw new Error(`镜头 ${shot.order} 缺少上一镜完成视频或尾帧`)
        }
        const references = selectReferences(workspace.assets, shot, 6)
        const lane = Math.floor((shot.order - 1) / 3)
        const task = await createTask(projectId, {
          kind: 'video',
          label: `镜头 ${String(shot.order).padStart(2, '0')} · ${shot.title}`,
          prompt: shot.prompt,
          negativePrompt: shot.negativePrompt,
          provider: 'seedance',
          model: 'doubao-seedance-2-0-260128',
          estimatedCredits: 18,
          metadata: {
            shotId: shot.id,
            duration: 5,
            requestedDuration: shot.duration,
            aspectRatio: '9:16',
            resolution: '720p',
            generateAudio: true,
            watermark: false,
            returnLastFrame: true,
            continuityMode: source ? 'continue' : 'independent',
            ...(source ? { continuitySourceTaskId: source.id } : {}),
            images: references.map((reference) => reference.url),
            videoInputMode: source ? 'continuity-and-assets' : references.length ? 'assets' : 'text',
            referenceAssetIds: references.map((reference) => reference.id),
            batchId: `two-minute-demo-${projectId}`,
            batchMode: 'parallel',
            batchPlanVersion: 'v3-two-lane',
            lane,
          },
        })
        taskIds.push(task.id)
        tasks = [task, ...tasks]
      }
      if (taskIds.length) {
        await waitForTasks(
          projectId,
          taskIds,
          VIDEO_TIMEOUT_MS,
          `视频链 ${laneOffset + 1}-${Math.min(laneOffset + 2, lanes.length)} · 第 ${depth + 1} 镜`,
          10_000,
        )
      }
    }
    log(`视频链 ${laneOffset + 1}-${Math.min(laneOffset + 2, lanes.length)} 已完成`)
  }

  const tasks = await tasksFor(projectId)
  const completed = workspace.shots.filter((shot) => latestCompletedVideo(tasks, shot.id))
  if (completed.length !== workspace.shots.length) {
    throw new Error(`视频完成 ${completed.length}/${workspace.shots.length}，不能合成完整成片`)
  }
  log(`视频完成：${completed.length}/${workspace.shots.length}`)
}

async function ensureFilmPreview(projectId: string): Promise<Task> {
  const tasks = await tasksFor(projectId)
  const existing = findTask(
    tasks,
    (task) => task.metadata.generationStage === 'film-preview' && task.metadata.previewMode !== 'partial',
  )
  const preview =
    existing && !terminalFailure(existing)
      ? existing
      : await api<Task>(`/projects/${projectId}/film-preview`, {
          method: 'POST',
          body: JSON.stringify({ mode: 'full', force: true, episodeNumber: null }),
        })
  return waitForTask(projectId, preview.id, 30 * 60_000)
}

async function downloadPreview(task: Task) {
  const response = await fetch(`${API_BASE}/generation/tasks/${task.id}/content`, {
    headers: { Cookie: cookie },
  })
  if (!response.ok) throw new Error(`下载完整成片失败 (${response.status}): ${await response.text()}`)
  const content = Buffer.from(await response.arrayBuffer())
  await mkdir(resolve('artifacts'), { recursive: true })
  await writeFile(OUTPUT_PATH, content)
  log(`成片已下载：${Math.round(content.length / 1024 / 1024)} MB`)
}

async function createTask(
  projectId: string,
  input: Omit<JsonRecord, 'projectId' | 'clientRequestId'>,
): Promise<Task> {
  return api<Task>('/generation/tasks', {
    method: 'POST',
    body: JSON.stringify({
      clientRequestId: `demo-${Date.now()}-${crypto.randomUUID()}`,
      projectId,
      ...input,
    }),
  })
}

async function waitForTask(projectId: string, taskId: string, timeoutMs: number): Promise<Task> {
  const [task] = await waitForTasks(projectId, [taskId], timeoutMs, '后台任务')
  if (!task) throw new Error(`任务 ${taskId} 未返回`)
  return task
}

async function waitForTasks(
  projectId: string,
  taskIds: string[],
  timeoutMs: number,
  label: string,
  intervalMs = POLL_INTERVAL_MS,
): Promise<Task[]> {
  const wanted = new Set(taskIds)
  const startedAt = Date.now()
  let lastSummary = ''
  while (Date.now() - startedAt < timeoutMs) {
    const tasks = (await tasksFor(projectId)).filter((task) => wanted.has(task.id))
    const failed = tasks.filter(terminalFailure)
    if (failed.length) {
      throw new Error(
        `${label}失败：${failed.map((task) => `${task.label}: ${task.error || task.status}`).join('；')}`,
      )
    }
    const completed = tasks.filter((task) => task.status === 'completed')
    if (completed.length === wanted.size) return completed
    const summary = `${completed.length}/${wanted.size} 完成，${tasks.filter((task) => task.status === 'running').length} 运行，${tasks.filter((task) => task.status === 'queued').length} 排队`
    if (summary !== lastSummary) {
      log(`${label}：${summary}`)
      lastSummary = summary
    }
    await sleep(intervalMs)
  }
  throw new Error(`${label}等待超时（${Math.round(timeoutMs / 60_000)} 分钟）`)
}

async function workspaceFor(projectId: string): Promise<Workspace> {
  return api<Workspace>(`/projects/${projectId}`)
}

async function tasksFor(projectId: string): Promise<Task[]> {
  return api<Task[]>(`/projects/${projectId}/generation/tasks`)
}

async function updateAsset(projectId: string, assetId: string, input: JsonRecord): Promise<Asset> {
  return api<Asset>(`/projects/${projectId}/assets/${assetId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

function findTask(tasks: Task[], predicate: (task: Task) => boolean): Task | undefined {
  return tasks.find((task) => predicate(task) && typeof task.metadata.queueHiddenAt !== 'string')
}

function latestAssetTask(tasks: Task[], assetId: string, stage: string): Task | undefined {
  return findTask(
    tasks,
    (task) =>
      task.kind === 'image' && task.metadata.assetId === assetId && task.metadata.generationStage === stage,
  )
}

function latestCompletedVideo(tasks: Task[], shotId: string): Task | undefined {
  return tasks.find(
    (task) =>
      task.kind === 'video' &&
      task.status === 'completed' &&
      task.metadata.shotId === shotId &&
      task.outputs.some((output) => output.view === 'single'),
  )
}

function latestCompletedVideoWithLastFrame(tasks: Task[], shotId: string): Task | undefined {
  return tasks.find(
    (task) =>
      task.kind === 'video' &&
      task.status === 'completed' &&
      task.metadata.shotId === shotId &&
      task.outputs.some((output) => output.view === 'single') &&
      task.outputs.some((output) => output.view === 'last-frame'),
  )
}

function terminalFailure(task: Task): boolean {
  return task.status === 'failed' || task.status === 'cancelled'
}

function textResult(task: Task): JsonRecord | null {
  return asRecord(task.metadata.textResult)
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function sceneCount(script: string): number {
  return script.split(/\n+/u).filter((line) => /场次[：:]/u.test(line)).length
}

function normalizeStoryboardActions(script: string): string {
  return script
    .split(/\n/u)
    .map((line) =>
      line.replace(
        /动作[：:]([\s\S]*?)(?=｜对白[：:])/u,
        (_match, actions: string) => `动作：${twoStoryboardBeats(actions)}`,
      ),
    )
    .join('\n')
}

function twoStoryboardBeats(actions: string): string {
  const beats = actions
    .replace(/[，,]/gu, '、')
    .split(/[；;]+|(?=动作\s*\d+\s*[：:])/u)
    .map((beat) => beat.replace(/^动作\s*\d+\s*[：:]\s*/u, '').trim())
    .filter(Boolean)
  if (beats.length <= 2) return beats.join('；')
  const midpoint = Math.ceil(beats.length / 2)
  return [beats.slice(0, midpoint).join('并随后'), beats.slice(midpoint).join('并随后')].join('；')
}

function assetPrompt(name: string): string {
  return assetDefinitions.find((definition) => definition.name === name)?.prompt || name
}

function assetNegativePrompt(name: string): string {
  return assetDefinitions.find((definition) => definition.name === name)?.negativePrompt || ''
}

function assetBodyPrompt(name: string): string {
  const definition = assetDefinitions.find((item) => item.name === name)
  return `${definition?.description || name}，${definition?.prompt || ''}`
}

function selectReferences(assets: Asset[], shot: Shot, limit: number) {
  const text = `${shot.title}\n${shot.prompt}`
  const withImages = assets
    .filter((asset) => asset.kind !== 'audio')
    .map((asset) => ({ asset, url: referenceUrl(asset) }))
    .filter((item): item is { asset: Asset; url: string } => Boolean(item.url))
  const matched = withImages.filter(({ asset }) => text.includes(asset.name))
  const scene = withImages.find(({ asset }) => asset.kind === 'scene')
  const selected = [...matched]
  if (scene && !selected.some(({ asset }) => asset.id === scene.asset.id)) selected.push(scene)
  return selected.slice(0, limit).map(({ asset, url }) => ({
    id: asset.id,
    url,
    name: `${asset.name}.png`,
    assetName: asset.name,
    assetKind: asset.kind,
  }))
}

function referenceUrl(asset: Asset): string | null {
  if (asset.kind === 'character') {
    const body = asRecord(asset.attributes.bodyReference)
    const face = asRecord(asset.attributes.faceReference)
    if (typeof body?.url === 'string') return body.url
    if (typeof face?.url === 'string') return face.url
  }
  return asset.imageUrl
}

function log(message: string) {
  process.stdout.write(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}\n`)
}

function sleep(milliseconds: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function retryStage<T>(label: string, operation: () => Promise<T>, maxAttempts: number): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (/may contain real person|SecurityConstraintViolation|疑似真人/u.test(message)) throw error
      if (attempt >= maxAttempts) break
      log(`${label}第 ${attempt} 次执行未完成，将只重试失败或缺失项：${message}`)
      await sleep(8_000)
    }
  }
  throw lastError
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
