import type { GenerateScriptRequest, ScriptModel } from '@seqora/contracts'
import { FORCE_EPISODE_BREAK_MARKER, FORCE_SHOT_BREAK_MARKER } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import type { TextGenerationProvider, TextGenerationTiming } from '../../core/generation/textProvider.js'
import {
  countStructuredScenes,
  dialogueTextForTiming,
  normalizedSceneIdentity,
  parseShotFields,
  scriptScenes,
  scriptBodyWithoutAssetManifest,
  splitScriptParagraphs,
} from './shotPlanning.js'

export type ScriptContentMode = 'web-series' | 'advertisement' | 'short-film' | 'short-video'

const SCENE_PRODUCTION_RULES = `每个场次是一条可以直接交给分镜师和视频模型的制作记录，不要只写镜头语言，也不要用“氛围感”“人物展开”“镜头表现”等空泛占位语。
- 在正文场次之前先输出可读的稳定资产清单，固定从“资产：”开始，以“正文：”结束；每个实体单独一行，字段使用“｜”分隔。人物写性别、年龄段、年龄、身份和固定外形；场景写内外空间、时代、固定布局、出入口、固定陈设、材质和基础色彩；物品写分类、尺度、形状、材质、颜色、固定结构、基础状态、归属和准确文字；服装写归属、时代、季节、剪裁、层次、颜色、材质和配件；品牌写准确文字、图形结构、字体方向、标准色和版式背景。这里只列剧本已经明确或本次创作确定的稳定资产，没有的类别不要输出。
- 资产清单中的名称必须是稳定、可复用的实体名称；不要输出“故事作用”“剧情作用”等叙事字段，也不要把动作、表情、伤势、手持状态、物件开合、镜头、时间、天气或完整句子写进资产名称和固定设定。资产清单中的事实必须在下方正文中保持一致。
- 每个场次必须写清“谁想做什么→遇到什么阻力→发生什么可见变化→场尾留下什么结果或悬念”，剧情字段不能只复述故事梗概。
- 场景字段必须同时写稳定地点、时间、天气、空间布局、前中后景、可复用陈设和主光源；关键物件要写名称、所在位置、当前状态和由谁使用。
- 角色字段必须列出所有画面内角色，并为每个人写清主次、画面位置、朝向、视线、服装、当前表情、起始姿态和本镜反应；配角与背景角色不能只作为名单，必须有符合场景的动作或表情变化。
- 动作字段必须拆成 2 到 3 个可被摄像机看见的微节拍，用“动作1：…；动作2：…；动作3：…”分开；这些微节拍共同完成当前场次的一个核心事件，不代表新增场次，也不能把同一事件换词重复。每个微节拍写清主角起势、执行、一次表情或视线变化和结束姿态；配角、群演只做同步反应。
- 核心人物每 2 到 3 秒必须有一次可见的表情、视线、姿态或情绪状态变化；配角和背景角色也必须在对应节拍发生至少一次反应，这些变化必须落到动作或角色字段中，不能只写“情绪升级”。
- 对白字段按实际情况明确标记“[对白]角色：内容”“[画外音]内容”“[内心独白]角色：内容”或“[音效]内容”；优先写 1 到 2 句短而能推进冲突的发声内容，单句尽量 4 到 12 个中文字符、整场口播尽量不超过 24 个中文字符，禁止用长台词解释画面；没有人物对白时用简短画外音补充画面无法表达的信息，并写至少两种现场声音和人物反应，不能返回空白或“无声”。
- 风格字段写材质、色彩、角色与场景的统一规则；构图字段写景别、主体位置、视线方向、前中后景和画面重心；光影字段写主光方向、软硬、色温、阴影落点；运镜字段写机位、运动方式、速度、跟随对象和结束画面。
- 每个场次都必须额外写清“目标：”“阻力：”“变化：”“入场状态：”“出场状态：”。目标是本场角色要完成的事；阻力是画面中实际发生的阻碍；变化是本场结束后不可逆的新信息、关系或情绪状态；入场状态必须可作为本场第一镜首帧，出场状态必须可作为本场最后一镜尾帧。
- 衔接字段必须同时写上一镜头尾帧如何接入本场，以及本场结尾把哪个人物位置、动作方向、视线、服装、物件状态或光线交给下一镜，禁止让每个镜头像独立照片。
- 不要凭空添加原稿没有的主要角色、关键道具或新空间规则；保持服装、位置、视线、光线和关键物件连续。
- 每一行都必须同时包含场次、剧情、目标、阻力、变化、场景、角色、入场状态、动作、对白、出场状态、风格、构图、光影、运镜、衔接，场次值使用 S01、S02 这样的稳定编号；每个场次尽量保持 320 到 560 个中文字符的信息密度，不能为了凑字数重复形容词。`

const FAST_WEB_SERIES_SCENE_RULES = `网剧输出必须像正常剧本一样可直接阅读；机器结构只保留在稳定的资产清单和场次标题里，不把编剧检查项展示给用户。
- 正文前固定输出“资产：”，资产清单结束后输出“正文：”。每个稳定实体单独一行，名称后使用“｜”补充可复用设定：人物写“人物：名称｜性别：女｜年龄段：青年｜年龄：28岁｜身份：急诊医生｜体型：清瘦｜脸型：窄长脸｜发型：黑色齐肩短发｜肤色：浅肤色｜基础造型：克制利落”；场景写“场景：名称｜空间：室外｜时代：现代｜场景用途：通行巷道｜固定布局：狭窄直巷｜入口出口：南口、北口｜固定陈设：右侧雨棚、巷尾卷帘门｜材质：旧砖墙和湿水泥地｜基础色彩：冷灰绿”；物品写“物品：名称｜分类：容器｜尺度：手掌大小｜形状：长方体｜材质：金属｜颜色：暗灰｜固定结构：暗扣盒盖｜基础状态：旧但完整｜归属：林晚｜准确文字：无”；服装写“服装：名称｜归属：林晚｜时代：现代｜季节：秋冬｜剪裁：短款｜层次：单层外套｜颜色：深灰｜材质：防水布｜配件：无”；品牌写“品牌：名称｜准确文字：名称｜图形结构：文字标｜字体方向：横排｜标准色：黑白｜版式背景：透明背景”。没有的类别不要输出。
- 资产名称只能是稳定、可复用的实体名称。伤势、血迹、污渍、表情、姿态、手中状态、盒盖开合、露出多少、天气、时段和镜头角度都是临时状态，只能写进正文，绝不能成为新资产，也不要输出“故事作用”“剧情作用”等字段。
- 每场标题单独一行，固定格式为“场次：S01｜稳定地点名｜时间｜内景/外景｜20秒”。标题后用正常段落按发生顺序写故事，不再输出“剧情、目标、阻力、变化、角色、动作、对白、镜头、衔接”等栏目名。
- 每场是一个约 18 到 25 秒的连续事件，不按单个动作拆场，也不在剧本中预拆镜头。系统会依据时长和叙事目的把约 20 秒的场次规划成约 2 个长镜头。
- 正文必须让读者直接看见因果：人物从哪里来，以步行、快走、奔跑等何种速度和姿态移动；处于空间哪一侧，朝向哪里，与他人或门窗相距多远；哪只手接触什么；经过看、问、摸、试拉、试按或听见反馈后才得出什么结论；动作结束后人物、物品、门窗和伤势分别停在什么状态。禁止角色无缘无故知道出口、药品、敌人或线索的位置。
- 地点气氛必须化成可见可听的事实。“破败阴森”要落实为掉漆招牌、碎玻璃、积灰货架、忽明忽暗灯管、狭窄动线、风声或撞击声；危险要写明从哪个方向逼近、数量区间、距离和人物如何确认，不能只写“尸群合围”。
- 对白必须按真实发生时机穿插在动作之间，格式使用“林晚：“门锁死了。””；画外音使用“画外音：“末日第七天。””；音效可以使用“[音效]卷帘门被连续撞响。”。每场至少 4 句、通常 4 到 6 句短对白或必要画外音，单句尽量 5 到 14 个中文字符；每句用于提问、回答、施压、揭示信息或改变决定，不寒暄、不复述画面。
- 说话前后都要写说话者和听者的视线、停顿、表情或动作反应。奔跑、对抗、观察、对白和情绪变化都写成连续可拍的表演，但不要写景别、机位、运镜等导演术语，分镜阶段会依据语义决定全景、中景、特写和推拉。
- 前一场结尾必须留下下一场能直接承接的人物位置、运动方向、视线、稳定服装、临时伤势、物品归属、门窗状态、光线与声音。已有项目资产必须逐字复用名称，不得为同一资产的临时变化重复建卡。
- 每场保持约 350 到 600 个中文字符的有效信息密度，不用字段、口号、形容词或重复动作凑字数。`

const ADVERTISEMENT_PRODUCTION_RULES = `每个广告段落是一条可直接交给分镜师和视频模型的制作记录，不要只写口号或抽象氛围。
- 在广告段落之前先输出可读的稳定资产清单，固定从“资产：”开始，以“正文：”结束；每个实体单独一行，字段使用“｜”分隔。人物写性别、年龄、身份和固定外形，场景写空间、时代、固定布局、材质和基础色彩，产品/物品写材质、颜色、固定结构、基础状态和准确文字，品牌写准确文字、图形结构、标准色和版式背景；没有的类别不要输出。
- 资产名称必须是稳定、可复用的实体名称，资产清单中的事实必须在下方广告正文中保持一致；不要输出故事作用，也不要把动作、镜头、临时状态、时间天气或完整句子写进资产名称和固定设定。
- 每段必须写清“本段传播任务→观众看到的主体与动作→获得的核心信息→段尾画面结果”，屏幕文字必须给出确切内容与出现时机。
- 场景字段写清地点、时间、空间布局、前中后景、主体陈设和主光源；产品字段信息应写入剧情与动作，名称、位置、朝向、材质和使用状态保持一致。
- 人物不是必选项。纯产品、界面或场景广告应在角色字段明确写“无人物，主体为……”，禁止为了满足格式凭空增加模特；有人物时写清位置、朝向、表情、起始姿态和与产品的真实交互。
- 动作拆成 2 到 3 个可见微节拍，写清主体起始状态、运动过程、局部细节变化与结束状态；禁止用多个形容词替代实际动作。
- 对白字段按需要标记“[旁白]”“[对白]”“[音效]”“[音乐]”；开场、核心价值证明和落版段优先各写一句 6 到 18 个中文字符的短旁白，其余段落按画面需要使用短对白；无人声时可写“无旁白”，但必须给出现场音或设计音，不能返回空白。
- 构图写景别、主体位置、文字安全区域、前中后景和画面重心；光影写光源方向、软硬、色温、产品高光与阴影；运镜写机位、运动方式、速度、跟随主体和结束画面。
- 衔接字段必须写清产品状态、主体位置、运动方向、色彩、光线、声音或文字如何交给下一段，避免每段像互不相关的素材拼接。
- 每一行必须包含场次、剧情、场景、角色、动作、对白、风格、构图、光影、运镜、衔接，场次使用 A01、A02 等稳定编号；信息具体紧凑，不要重复口号凑字数。`

const QUICK_SCRIPT_SYSTEM_PROMPT = `你是中文漫剧的快速编剧。你的任务不是写长篇小说，而是把用户素材整理成 15 到 30 秒视频可以直接进入分镜的故事骨架。

硬性规格：
1. 输出 4 到 6 个场景，总长度约 1800 到 2600 个中文字符；每场都要成为可以继续拆成 2 到 3 个动作镜头的完整制作单元，不能用空泛描写凑字数。
2. 每个场景必须单独占一行，场景之间换行；不要输出标题、解释、Markdown 或分析。
3. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。
4. 剧情必须有明确目标、阻力、变化和结果；不要写空泛的“氛围感”“电影感”。
5. 动作必须是可以被摄像机看见的连续动作，明确谁在什么位置做什么，并包含至少 2 个动作拍点和一个结束姿态；不要只写心理活动。
6. 每场安排 1 到 2 句短、口语化且推动冲突的对白、画外音或内心独白，单句尽量 4 到 12 个中文字符、整场口播不超过 24 个中文字符；优先让人物互相回应，不用长旁白解释可见动作，同时写清必要音效和现场声音。
7. 场景之间必须保持人物、地点、时间、服装和关键物件连续；每一场都要推动主线。
8. 结尾留下一个清晰的悬念、决定或下一步动作，方便后续补齐专业视觉细节。
9. ${SCENE_PRODUCTION_RULES}

只输出“资产清单 + 4 到 6 行剧本正文”。`

const SCRIPT_REWRITE_SYSTEM_PROMPT = `你是中文漫剧的剧本整理编剧。输入是一份已经包含剧情信息的中文剧本或故事稿，长度在 1500 到 10000 字之间。你的任务是按原有逻辑重写成可直接进入资产设计和分镜的制作稿，而不是另写一个新故事。

硬性规格：
1. 保留原稿的核心剧情、人物关系、场景数量、时间地点、关键物件、对白和因果顺序；不得为了缩短输出而删除重要情节，也不得把一个场景压成一句话。
2. 场景数量、编号和顺序必须与原稿完全一致，不得新增、拆分、合并或删除场次；每个原场次只输出一行，只在该行内部补齐制作信息。
3. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；缺失字段要根据原稿上下文补齐，不要凭空新增角色或道具。
4. 剧情写清本场目标、阻力、变化和结果；角色写清画面位置、表情和姿态；动作写成至少 2 个摄像机能看见的连续动作；对白短而有信息量并标记对白类型。
5. 保留原稿已有的悬念、转折和结尾方向；原稿有“【强制下一集】”时必须独占一行并原样保留。
6. ${SCENE_PRODUCTION_RULES}
7. 只输出“资产清单 + 重写后的剧本正文”，不要标题、解释、Markdown 或分析。`

const ADVERTISEMENT_SCRIPT_SYSTEM_PROMPT = `你是中文商业广告的创意总监、文案和导演。请把用户的一句话想法、品牌资料或产品资料扩写成可以直接进入资产设计、分镜和视频生成的广告制作脚本，而不是故事梗概、品牌介绍或普通剧情短片。

硬性规格：
1. 严格围绕用户指定的目标时长编排传播节奏，每行一个连续广告段落、对应一个可生成视频镜头；每行都要写明该段承担的传播任务和明确起止时间，例如“0-3秒抓住注意”“3-8秒展示核心价值”。
2. 使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。场次使用 A01、A02 等编号；剧情字段必须包含“时段、传播任务、核心信息、屏幕文字”，对白字段使用“[旁白]”“[对白]”“[音效]”“[音乐]”标记。
3. 开头 1 到 3 秒必须有可见的注意力抓点；品牌、产品、服务或核心对象应尽早出现，不能到结尾才首次展示。中段只证明一个核心价值，使用具体画面、动作、使用情境或前后变化，不要堆砌多个空泛卖点。
4. 最后一段必须完成品牌/产品清晰落版、核心文案和行动引导；行动引导应符合素材，例如“立即体验”“了解更多”，不得擅自添加购买链接、价格、优惠、认证、性能数据、代言或用户未提供的承诺。
5. 品牌名、产品名、标语和专有名词必须保持用户原文拼写；信息不足时使用真实可拍的体验表达，不得编造事实。广告语简短、可读、可配音，避免长篇解释。
6. 每段画面都要能独立制作且与前后段连续：产品状态、角色位置、服装、光线、文字层级和运动方向不能跳变；人物只在传播需要时出现，不要为了“像剧情”虚构无关冲突。
7. 广告不是网剧：不要生成分集钩子、受辱反击、悬念续集或完整人物成长线，除非用户素材明确要求剧情广告。
8. ${ADVERTISEMENT_PRODUCTION_RULES}
9. 只输出“资产清单 + 广告脚本正文”，不要标题、创意阐释、Markdown、表格、JSON 或分析。`

const ADVERTISEMENT_REWRITE_SYSTEM_PROMPT = `你是中文商业广告的创意总监和制作脚本统筹。请把已有广告想法、文案或脚本重写成可直接进入资产设计、分镜和视频生成的广告制作稿。

硬性规格：
1. 保留品牌名、产品名、已有事实、核心卖点、受众、语气、画面顺序、现有文案和行动引导，不得编造价格、优惠、认证、性能数据、代言或用户未提供的承诺。
2. 原稿已按场次组织时，场次数量、编号和顺序必须完全一致，只在原段落内补齐；原稿未结构化时，按目标时长重组为连续广告段落。
3. 每行使用：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。剧情字段写明时段、传播任务、核心信息、屏幕文字；对白字段标记旁白、对白、音效和音乐。
4. 开头快速抓住注意，中段用可见证据证明一个核心价值，结尾清晰落版并给出合适的行动引导；产品或品牌不能只在末尾突然出现。
5. 删除重复口号和空泛形容词，但不能把广告压缩成一句品牌简介；每段必须有具体可见动作和画面结果。
6. ${ADVERTISEMENT_PRODUCTION_RULES}
7. 只输出“资产清单 + 重写后的广告脚本正文”，不要解释、Markdown、表格、JSON 或分析。`

const SHORT_FILM_SCRIPT_SYSTEM_PROMPT = `你是中文叙事短片的编剧、导演和剪辑统筹。请把用户的一句话想法或已有素材扩写成一个有完整起承转合、可以直接进入资产设计、分镜和视频生成的独立短片，不要写成广告、网剧单集、小说梗概或续集预告。

硬性规格：
1. 严格围绕用户指定的目标时长倒推场次数量，每行一个连续场次、对应一个可生成视频镜头；开场建立人物处境与目标，中段出现可见阻力和转折，结尾完成情节与情绪落点。
2. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。剧情字段要写明本场时段、叙事任务、目标、阻力、变化和结果。
3. 动作、对白、画外音、内心独白、现场音和音乐只保留能推进人物目标或情绪变化的信息；不要用空镜、旁白总结或重复动作填时长。
4. 每场都要交付新的信息、关系或状态变化，并清楚承接上一场的人物位置、视线、服装、物件和声音；转折必须由前文行动造成，不能突然新增人物、能力或规则。
5. 结尾应完成独立短片的情节回收或情绪余韵，不强制制造“下一集”钩子，不得擅自加入品牌落版、广告语或行动引导。
6. ${SCENE_PRODUCTION_RULES}
7. 只输出“资产清单 + 短片剧本正文”，不要标题、解释、Markdown、表格、JSON 或分析。`

const SHORT_FILM_REWRITE_SYSTEM_PROMPT = `你是中文叙事短片的剧本编辑和分镜前置统筹。请在不改变原作核心表达的前提下，把已有故事或剧本整理成目标时长内可制作的完整独立短片。

硬性规格：
1. 保留人物关系、故事因果、地点、时间、关键物件、重要对白、转折和结局方向；不得压成提纲，也不要扩成网剧或广告。
2. 原稿已按场次组织时，场次数量、编号和顺序必须完全一致，不得新增、拆分、合并或删除场次；只在原场次内部补齐制作信息。
3. 每行使用：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；剧情写明时段、叙事任务、目标、阻力、变化和结果。
4. 强化“建立处境→行动受阻→选择或转折→结果与情绪落点”的完整闭环；不要强行保留续集钩子，也不要加入品牌文案和行动引导。
5. ${SCENE_PRODUCTION_RULES}
6. 只输出“资产清单 + 重写后的短片剧本正文”，不要解释、Markdown、表格、JSON 或分析。`

export const WEB_SERIES_SCRIPT_SYSTEM_PROMPT = `你是中文网剧漫剧的主编剧和导演。请把用户素材写成一集可以直接进入资产设计、导演分镜和视频制作的网剧剧本，不要写成长篇小说或提纲。

硬性规格：
1. 本次只生成 1 集，不生成其他集。严格按用户给出的总时长编排；常规 60 秒单集优先恰好输出 3 个长场次，每场约 18 到 25 秒，每场通常再规划 2 个约 10 秒的导演镜头。场次不是单个动作，也不是单个视频镜头。
2. 资产清单结束后，按“场次标题 + 自然动作段落 + 穿插对白”书写，从“场次：S01｜地点｜时间｜内景/外景｜时长”开始；不要输出创作说明、人物小传、全剧摘要、Markdown、表格或 JSON。
3. 每场在自然故事中完成“明确意图→实际阻碍→因果行动→可见变化→场尾结果”，并给出足以消除生成歧义的空间、方向、数量、左右手、移动路线、观察过程、起止状态和关键物件状态；这些检查项不能显示成字段。
4. 未知信息必须通过搜索、观察、试探、询问或物件反馈获得；角色不能直接知道未看见的后门状态、药品位置、敌人数量或线索结论。
5. 保持人物身份、稳定服装、地点、时间、光线、伤势和关键物件连续；已有项目资产必须逐字复用，不得把受伤版、污渍版、表情或镜头角度误建成新资产。
6. 前场快速建立处境，中场增加阻力并迫使人物选择，末场形成明显变化和下一集钩子；最后场仍使用连续 S 编号，把未解决的钩子自然写进结尾动作，不要把场次名改成“剧情钩子”。
7. 每场写 4 到 6 句短而有意义的对白、画外音或内心独白，并按发生顺序穿插在动作中；画外音只补充画面无法表达的信息，环境声与动作声直接写进现场。
8. ${FAST_WEB_SERIES_SCENE_RULES}
9. 只输出“资产清单 + 正文场次”，不要标题、解释、Markdown 或分析。`

const WEB_SERIES_REWRITE_SYSTEM_PROMPT = `你是中文网剧漫剧的连续剧编剧和导演统筹。输入是一份已有剧本，必须在不改变原剧情的前提下重写整理为可制作的单集网剧剧本。

硬性规格：
1. 保留原稿的场景顺序、人物关系、对白、地点、时间、服装、关键物件和剧情因果；不得压缩成提纲或删除重要情节，不得把动作和对白合并成一句概括。
2. 原稿已经按场次组织时，场次数量、编号和顺序必须保持；每场补齐 18 到 25 秒的可执行信息，不在剧本中预拆镜头。
3. 严格使用“资产清单 + 场次标题 + 自然正文”格式；缺失的空间、位置、方向、左右手、信息获得过程、对白反应、声音和首尾状态可根据上下文合理补齐，但不能新增改变剧情的角色、道具、能力或空间规则。
4. 每场都要在正常叙事中体现意图、阻碍、变化和结果，动作明确到人物起点、路线、视线、表情、手部和关键物件状态；不要显示“目标/阻力/变化”等检查字段，也不要用“沿用上一场”代替具体状态。
5. 保留原稿有效对白，并把每场补齐到 4 到 6 句简短发声内容；每句必须改变信息、压力、回答或决定，画外音不得复述可见动作，声音字段另写环境声与动作声。
6. 结尾保留并强化原稿的高波动钩子；如果原稿存在“【强制下一集】”，必须独占一行并原样保留。
7. ${FAST_WEB_SERIES_SCENE_RULES}
8. 只输出“资产清单 + 重写后的正文场次”，不要标题、解释、Markdown 或分析。`

const SCRIPT_DETAIL_SYSTEM_PROMPT = `你是中文漫剧的视觉导演和分镜前置编剧。请把快速剧本补齐为可直接用于资产设计、分镜和视频生成的制作级剧本。

硬性规格：
1. 保留原剧本的场景数量、人物、地点、关键物件、剧情因果和对白，不要另起炉灶，不要扩展成新的长故事；优先补齐能被摄像机执行的信息。
2. 每个场景必须单独占一行，场景之间换行；不要输出标题、解释、Markdown 或分析。
3. 在每个场次内完整保留并补齐：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；禁止只返回风格、构图、光影或运镜。
4. 剧情写清本场目标、阻力、转折和结果；动作拆成 2 到 3 个可见拍点，写清起势、过程、结束姿态、表情变化以及与环境或物件的互动。
5. 风格必须落实项目选择的视觉类型、材质和色彩；构图必须写景别、主体位置、前中后景和画面重心。
6. 光影必须写主光来源、方向、软硬、色温和明暗关系；运镜必须写机位、运动方式、速度、运动对象和结束画面。
7. 衔接必须说明承接上一场的时间、动作、视线、人物位置或物件状态，并给下一场留下明确动作接点。
8. 所有视觉内容必须服务于原剧情，禁止添加新的角色、道具、回忆、梦境或突然转场；原稿中的“【强制下一集】”必须独占一行并原样保留。
9. ${SCENE_PRODUCTION_RULES}

只输出“资产清单 + 补齐后的正文场次”。`

const ADVERTISEMENT_DETAIL_SYSTEM_PROMPT = `你是中文商业广告的导演、摄影指导、文案和声音设计。请在不改变广告事实与传播策略的前提下，把现有广告脚本补齐为可直接分镜和视频生成的制作稿。
1. 场次数量、编号、时段顺序、品牌名、产品名、核心卖点、屏幕文字、旁白和行动引导必须保留；不得擅自添加价格、优惠、认证、性能数据或代言。
2. 每行完整输出：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；剧情明确时段、传播任务、核心信息和屏幕文字，对白明确旁白、对白、音效与音乐。
3. 补齐产品展示角度、材质细节、使用动作、文字安全区域、品牌识别时机、光影与运镜；所有视觉选择必须服务一个核心传播信息。
4. 开头注意力抓点、中段可见证明和结尾品牌落版必须连贯，不能补成普通剧情短片或网剧钩子。
5. ${ADVERTISEMENT_PRODUCTION_RULES}
只输出“资产清单 + 补齐后的广告脚本正文”。`

const SHORT_FILM_DETAIL_SYSTEM_PROMPT = `你是中文叙事短片的导演、摄影指导、剪辑和声音设计。请在不改变原剧情的前提下，把短片补齐成可直接分镜和视频生成的制作稿。
1. 保留原有场次、人物、地点、关键物件、对白、因果、转折和结尾，不扩写成广告或连续网剧。
2. 每行完整输出：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；剧情明确时段、叙事任务、目标、阻力、变化和结果。
3. 补齐人物表演节拍、配角反应、现场音、音乐进入/退出点、构图、光影、运镜和转场落点；每一项都要服务人物行动与情绪变化。
4. 场间保持人物位置、视线、服装、物件、环境和声音连续，结尾完成情节回收或情绪落点，不强加下一集钩子或品牌行动引导。
5. ${SCENE_PRODUCTION_RULES}
只输出“资产清单 + 补齐后的短片剧本正文”。`

const WEB_SERIES_DETAIL_SYSTEM_PROMPT = `你是中文网剧漫剧的视觉导演、分镜导演和连续性统筹。请在不改变原剧情的前提下，把剧本补齐为可制作的网剧分镜前置稿。

硬性规格：
1. 保留原有场次、人物、对白、地点、关键物件和剧情因果，不压缩、不另起故事；重点补足空间因果、表演、声音、导演镜头和连续状态。
2. 每场补齐为“场次标题 + 自然动作段落 + 穿插对白”，常规场次保持 18 到 25 秒；不要在剧本正文显示导演镜头字段，后续分镜会按场次时长和语义规划约 2 个长镜头。
3. 每场保留或补齐 4 到 6 句短对白、画外音或内心独白，并放在实际说话的位置；说话者发声时写清听者的视线、停顿和表情反应。
4. 补足可供后续导演判断的语义：环境与威胁、人物移动、对话关系、证据出现和情绪落点；正文不写景别、机位或运镜术语。
5. 场次结尾必须交付人物位置、动作方向、视线、稳定服装、临时伤势、物件和光线状态，下一场开头直接承接。
6. 最后一个场次保留并强化高波动钩子，不提前揭示结果；原稿中的“【强制下一集】”必须独占一行并原样保留；不要增加拍摄设备、文字、水印或无关人物。
7. ${FAST_WEB_SERIES_SCENE_RULES}
只输出“资产清单 + 补齐后的剧本正文”。`

export const SCRIPT_INITIAL_EXPANSION_THRESHOLD = 1_500
export const SINGLE_REWRITE_MAX_LENGTH = 10_000
const INITIAL_SCRIPT_MAX_TOKENS = 4_800
export const SCRIPT_DETAIL_MAX_TOKENS = 4_000
export const LONG_SCRIPT_MAX_TOKENS = 16_000
const CHINESE_SCRIPT_OUTPUT_RULES = `语言硬约束：
- 所有面向用户的场次名称、剧情、场景、角色、动作、对白、风格、构图、光影、运镜和衔接内容必须使用简体中文。
- 除人物或地点的既有外文专名以及 AI、CG、2D、3D、Alpha 等行业缩写外，禁止输出英文标题、英文句子或中英混写的动作描述。
- 不要把内部推理、英文动作草稿、英文镜头术语或翻译过程写进剧本正文。`

const CHINESE_SCRIPT_REPAIR_SYSTEM_PROMPT = `你是中文剧本格式校对员。输入是一份混入英文的剧本结果，请只做语言与格式修复：
1. 把所有英文标题、英文句子、英文动作描述和英文镜头术语准确改写为自然的简体中文。
2. 人物、地点、物件、剧情因果、场次数量、场次编号、字段顺序、动作数量、对白含义和强制分集/分镜标记必须保持不变。
3. AI、CG、2D、3D、Alpha 以及原稿中的既有外文专名可以保留；不要增加剧情、解释、标题、Markdown 或 JSON。
4. 只输出修复后的完整剧本正文。`

export function webSeriesMaxOutputTokens(episodeSeconds = 60): number {
  return Math.min(12_000, Math.max(6_000, Math.ceil(Math.max(30, episodeSeconds) / 20) * 1_800))
}

export function webSeriesSceneBudget(episodeSeconds = 60): {
  minimum: number
  target: number
  maximum: number
} {
  const target = Math.min(15, Math.max(2, Math.ceil(Math.max(30, episodeSeconds) / 20)))
  return {
    minimum: Math.max(2, target - 1),
    target,
    maximum: Math.min(16, target + 1),
  }
}

type ScriptSceneBudget = ReturnType<typeof webSeriesSceneBudget>

export function resolveScriptContentMode(
  contentType: string,
  productionMode: GenerateScriptRequest['productionMode'],
): ScriptContentMode {
  if (contentType === 'advertisement') return 'advertisement'
  if (contentType === 'animation') return 'short-film'
  if (contentType === 'short-drama' && productionMode === 'web-series') return 'web-series'
  return productionMode
}

export function scriptModeDisplayName(mode: ScriptContentMode): string {
  if (mode === 'advertisement') return '广告脚本'
  if (mode === 'short-film') return '短片剧本'
  if (mode === 'web-series') return '网剧剧本'
  return '快速剧本'
}

export function scriptModeContext(mode: ScriptContentMode, durationSeconds: number): string {
  if (mode === 'advertisement') return `广告创作模式，目标成片 ${formatDuration(durationSeconds)}`
  if (mode === 'short-film') return `短片创作模式，目标成片 ${formatDuration(durationSeconds)}`
  if (mode === 'web-series') return '网剧模式，按单集生产；本次只生成 1 集'
  return `短视频模式，目标成片 ${formatDuration(durationSeconds)}`
}

export function scriptContentSceneBudget(
  mode: ScriptContentMode,
  durationSeconds: number,
): ScriptSceneBudget {
  if (mode === 'web-series') return webSeriesSceneBudget(durationSeconds)
  if (mode === 'advertisement') {
    return {
      minimum: Math.max(2, Math.min(40, Math.ceil(durationSeconds / 8))),
      target: Math.max(2, Math.min(48, Math.ceil(durationSeconds / 5))),
      maximum: Math.max(3, Math.min(60, Math.ceil(durationSeconds / 3))),
    }
  }
  if (mode === 'short-film') {
    return {
      minimum: Math.max(3, Math.min(60, Math.ceil(durationSeconds / 8))),
      target: Math.max(4, Math.min(80, Math.ceil(durationSeconds / 5))),
      maximum: Math.max(5, Math.min(100, Math.ceil(durationSeconds / 3))),
    }
  }
  return { minimum: 4, target: 5, maximum: 6 }
}

export function scriptGenerationSystemPrompt(mode: ScriptContentMode, shouldExpandFromIdea: boolean): string {
  if (mode === 'advertisement') {
    return shouldExpandFromIdea ? ADVERTISEMENT_SCRIPT_SYSTEM_PROMPT : ADVERTISEMENT_REWRITE_SYSTEM_PROMPT
  }
  if (mode === 'short-film') {
    return shouldExpandFromIdea ? SHORT_FILM_SCRIPT_SYSTEM_PROMPT : SHORT_FILM_REWRITE_SYSTEM_PROMPT
  }
  if (mode === 'web-series') {
    return shouldExpandFromIdea ? WEB_SERIES_SCRIPT_SYSTEM_PROMPT : WEB_SERIES_REWRITE_SYSTEM_PROMPT
  }
  return shouldExpandFromIdea ? QUICK_SCRIPT_SYSTEM_PROMPT : SCRIPT_REWRITE_SYSTEM_PROMPT
}

export function scriptGenerationInstruction(input: {
  scriptMode: ScriptContentMode
  sourceLength: number
  shouldExpandFromIdea: boolean
  episodeSeconds: number
  sourceHasStructuredScene: boolean
  sceneBudget: ScriptSceneBudget
}): string {
  const { scriptMode, sourceLength, shouldExpandFromIdea, episodeSeconds, sourceHasStructuredScene } = input
  const budget =
    scriptMode === 'web-series' ? input.sceneBudget : scriptContentSceneBudget(scriptMode, episodeSeconds)
  const averageSceneSeconds = Math.max(10, Math.round(episodeSeconds / Math.max(1, budget.target)))
  const durationRule =
    scriptMode === 'web-series'
      ? `本次只生成 1 集，总时长约 ${formatDuration(episodeSeconds)}；优先恰好输出 ${budget.target} 个可识别长场次，每场约 ${averageSceneSeconds} 秒，只有剧情结构确有必要时才允许 ${budget.minimum} 到 ${budget.maximum} 场。每场约 450 到 750 个中文字符并规划约 2 个导演镜头；每行一个场次，不得按动作拆场，也不要生成其他集。`
      : `目标成片时长 ${formatDuration(episodeSeconds)}，输出 ${budget.minimum} 到 ${budget.maximum} 个可识别场次/段落，建议 ${budget.target} 个；每行一个场次，不得把全部内容压成一段。`

  if (shouldExpandFromIdea) {
    if (scriptMode === 'advertisement') {
      return `当前素材仅 ${sourceLength} 字，属于广告创意输入。必须主动推断合理的传播目标与核心对象，把它扩写成完整可执行广告，禁止原样复述或只润色这一句话。${durationRule}`
    }
    if (scriptMode === 'short-film') {
      return `当前素材仅 ${sourceLength} 字，属于短片创意输入。必须补全人物目标、可见阻力、因果转折和结尾情绪落点，形成完整独立短片，禁止原样复述或只生成故事梗概。${durationRule}`
    }
    if (scriptMode === 'web-series') {
      return `当前内容仅 ${sourceLength} 字。请根据用户想法、项目简介和已有资产，直接生成高信息密度网剧单集；不要原样复述，也不要输出人物小传。每场写清空间因果、角色起止状态、连续行动、4 到 6 句有效短对白、声音和两个按导演目的划分的镜头；已有资产名称必须逐字复用。${durationRule}`
    }
    return `当前内容仅 ${sourceLength} 字。请根据用户想法、项目简介和已有资产生成高信息密度制作剧本；如果原始内容是系统提示语，也要把它转化为具体剧情，不要原样复述。每个场次必须有明确角色、空间、动作拍点、对白类型和上下场衔接。`
  }

  const preserveRule = sourceHasStructuredScene
    ? '原稿已经按场次组织，输出场次数量、场次编号和顺序必须与原稿完全一致，只能在原场次内部补齐制作信息，不得新增、拆分或合并场次。'
    : durationRule
  if (scriptMode === 'advertisement') {
    return `当前广告素材约 ${sourceLength} 字。保留品牌事实、核心卖点、受众、语气、已有画面和文案，将其重写为目标时长内可制作的广告脚本；不得改成普通剧情片，也不得编造宣传承诺。${preserveRule}`
  }
  if (scriptMode === 'short-film') {
    return `当前短片素材约 ${sourceLength} 字。保留人物关系、核心事件、因果、转折与结局方向，将其重写为目标时长内有完整叙事闭环的短片制作稿；不要压成提纲，也不要加入广告落版或网剧钩子。${preserveRule}`
  }
  return `当前内容约 ${sourceLength} 字。请在保留核心剧情、人物关系、场景因果、关键物件和对白信息的前提下，按原有逻辑重写整理为制作级剧本；不要把内容压缩成提纲，不要任意删减重要情节。${preserveRule}`
}

export function scriptGenerationUserPrompt(
  mode: ScriptContentMode,
  projectContext: string,
  generationInstruction: string,
  source: string,
): string {
  const request =
    mode === 'advertisement'
      ? '请把以下素材创作成可直接进入分镜的商业广告制作脚本'
      : mode === 'short-film'
        ? '请把以下素材创作成可直接进入分镜的完整独立短片'
        : mode === 'web-series'
          ? '请把以下素材改编成一集可制作的网剧剧本'
          : '请把以下素材改编成可直接进入分镜的快速剧本'
  return `${projectContext}\n\n${generationInstruction}\n${request}：\n${source}`
}

export function scriptGenerationMaxOutputTokens(
  mode: ScriptContentMode,
  durationSeconds: number,
  shouldExpandFromIdea: boolean,
  source: string,
): number {
  if (mode === 'web-series') return webSeriesMaxOutputTokens(durationSeconds)
  if (!shouldExpandFromIdea) return longScriptMaxOutputTokens(source)
  if (mode === 'advertisement') {
    return Math.min(12_000, Math.max(3_500, Math.ceil(durationSeconds / 30) * 3_000))
  }
  if (mode === 'short-film') {
    return Math.min(16_000, Math.max(4_500, Math.ceil(durationSeconds / 30) * 3_500))
  }
  return INITIAL_SCRIPT_MAX_TOKENS
}

export function scriptStructureRepairPrompt(
  mode: ScriptContentMode,
  projectContext: string,
  source: string,
  candidate: string,
  durationSeconds: number,
  budget: ScriptSceneBudget,
): string {
  const modeRule =
    mode === 'advertisement'
      ? '必须形成“开场抓点→核心对象/问题→一个核心价值的可见证明→品牌落版与行动引导”的广告结构，并在剧情字段写明时间段、传播任务、核心信息和屏幕文字。'
      : '必须形成“建立人物处境与目标→可见阻力→因果转折→结果与情绪落点”的完整独立短片，不要加入广告落版或下一集钩子。'
  return `${projectContext}\n\n上一次结果只有 ${countStructuredScenes(candidate)} 个可识别段落，且可能只是复述用户输入，不可写回。请完整重写：先输出“资产：”清单并用“正文：”分隔，随后输出目标时长 ${formatDuration(durationSeconds)} 的 ${budget.minimum} 到 ${budget.maximum} 个场次/段落，建议 ${budget.target} 个；正文每行必须以“场次：”开始并包含全部制作字段。${modeRule}\n\n用户原始素材：\n${source}`
}

export function scriptGenerationOperationLabel(mode: ScriptContentMode): string {
  if (mode === 'advertisement') return '智能生成广告脚本'
  if (mode === 'short-film') return '智能生成短片剧本'
  if (mode === 'web-series') return '智能生成网剧剧本'
  return '快速生成剧本'
}

export function scriptSegmentOperationLabel(mode: ScriptContentMode): string {
  if (mode === 'advertisement') return '延长广告脚本'
  if (mode === 'short-film') return '续写短片'
  if (mode === 'web-series') return '续写下一集'
  return '生成下一段'
}

export function scriptDetailOperationLabel(mode: ScriptContentMode): string {
  if (mode === 'advertisement') return '补齐广告制作细节'
  if (mode === 'short-film') return '补齐短片制作细节'
  return '补齐剧本专业视觉细节'
}

export function scriptDetailSystemPrompt(
  mode: ScriptContentMode,
  requestedSceneCount: number | null = null,
): string {
  const basePrompt =
    mode === 'advertisement'
      ? ADVERTISEMENT_DETAIL_SYSTEM_PROMPT
      : mode === 'short-film'
        ? SHORT_FILM_DETAIL_SYSTEM_PROMPT
        : mode === 'web-series'
          ? WEB_SERIES_DETAIL_SYSTEM_PROMPT
          : SCRIPT_DETAIL_SYSTEM_PROMPT
  if (!requestedSceneCount) return basePrompt
  return `${basePrompt}\n\n最高优先级数量覆盖：用户明确要求最终为 ${requestedSceneCount} 个场次。你必须恰好输出 ${requestedSceneCount} 行以“场次：”开头的完整场次，不得多一场或少一场。此规则覆盖上文“保持原场次数量”的要求；可在不改变核心剧情因果的前提下合并或拆分原场次，并按 S01 到 S${String(requestedSceneCount).padStart(2, '0')} 连续编号。`
}

export function scriptDetailUserPrompt(
  mode: ScriptContentMode,
  projectContext: string,
  source: string,
  requestedSceneCount: number | null = null,
): string {
  const request =
    mode === 'advertisement'
      ? '请保留广告事实、传播结构、屏幕文字和行动引导，补齐产品展示、声音、光影、运镜及段落衔接'
      : mode === 'short-film'
        ? '请保留短片剧情因果、转折和结尾，补齐表演、声音、光影、运镜及场次衔接'
        : '请在保留原有场景数量、剧情因果、人物关系和对白的前提下，补齐制作字段与镜头衔接'
  const sceneCountRule = requestedSceneCount
    ? `\n数量验收标准：最终正文必须恰好包含 ${requestedSceneCount} 个可识别场次，编号连续；生成结束前自行计数，数量不符不得返回。`
    : ''
  return `${projectContext}${sceneCountRule}\n\n${request}；本次改写要求必须优先执行：\n${source}`
}

export function scriptSceneCountRepairPrompt(
  projectContext: string,
  source: string,
  candidate: string,
  requestedSceneCount: number,
): string {
  return `${projectContext}\n\n上一次改写返回了 ${countStructuredScenes(candidate)} 个可识别场次，不符合用户明确要求。请重新组织并完整输出恰好 ${requestedSceneCount} 个场次：不得多一场或少一场，编号必须从 S01 连续到 S${String(requestedSceneCount).padStart(2, '0')}。数量要求优先于保持原场次数量；合并或拆分时保留核心剧情因果、人物关系、关键物件和有效对白。先输出“资产：”清单并用“正文：”分隔，正文每行必须以“场次：”开头并包含完整制作字段。只输出修复后的资产清单与正文。\n\n原稿：\n${source}\n\n上一次改写结果：\n${candidate}`
}

export function scriptSegmentSystemPrompt(mode: ScriptContentMode): string {
  if (mode === 'advertisement') return ADVERTISEMENT_SEGMENT_SYSTEM_PROMPT
  if (mode === 'short-film') return SHORT_FILM_SEGMENT_SYSTEM_PROMPT
  if (mode === 'web-series') return WEB_SERIES_SEGMENT_SYSTEM_PROMPT
  return SCRIPT_SEGMENT_SYSTEM_PROMPT
}

export function scriptSegmentUserPrompt(
  mode: ScriptContentMode,
  projectContext: string,
  source: string,
  goal: string,
  segmentSeconds: number,
): string {
  const fallbackGoal =
    mode === 'advertisement'
      ? '补充新的使用场景或可见证明，并在结尾重新完成品牌落版'
      : mode === 'short-film'
        ? '顺着人物当前行动继续推进短片'
        : mode === 'web-series'
          ? '承接上一集钩子推进下一集'
          : '顺着现有剧情自然推进下一段'
  const finalInstruction =
    mode === 'advertisement'
      ? '请只输出追加的广告段落，不要重写已有广告。'
      : mode === 'short-film'
        ? '请只输出续写的新场次，不要重写已有短片。'
        : '请只生成下一段剧本正文，不要重写已有内容。'
  const segmentBudget =
    mode === 'web-series'
      ? (() => {
          const budget = webSeriesSceneBudget(segmentSeconds)
          const averageSeconds = Math.max(10, Math.round(segmentSeconds / budget.target))
          return `本次只生成 1 个下一集生产单元，总时长约 ${formatDuration(segmentSeconds)}；优先恰好输出 ${budget.target} 个长场次，每场约 ${averageSeconds} 秒，只有剧情确有必要时才允许 ${budget.minimum} 到 ${budget.maximum} 场。每场约 450 到 750 个中文字符并规划约 2 个导演镜头。`
        })()
      : `追加时长：${formatDuration(segmentSeconds)}`
  return `${projectContext}\n\n已有脚本上下文：\n${scriptSegmentContext(source)}\n\n本次目标：${goal || fallbackGoal}\n${segmentBudget}\n\n${finalInstruction}`
}

export function withChineseScriptRules(systemPrompt: string): string {
  return `${systemPrompt}\n\n${CHINESE_SCRIPT_OUTPUT_RULES}`
}

const SCRIPT_SEGMENT_SYSTEM_PROMPT = `你是中文长剧和漫剧的分段编剧。你的任务是基于已有剧本继续写下一段，而不是一次性生成整部长篇。
硬性规则：
1. 只输出“本段资产清单 + 下一段剧本正文”，不要标题解释、Markdown、JSON 或分析。
2. 不要重写、总结、改写已有剧本；只顺着已有内容继续推进。
3. 输出 2 到 6 个连续场次，每个场次单独一行。
4. 每行使用统一字段：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。
5. 剧情必须承接上一段的时间、地点、人物状态和关键物件；本段结尾留下清晰的下一步动作或悬念。
6. 不要为了拉长篇幅写空泛氛围；每个场次都要有目标、阻力、变化和结果。
7. 不要在本段一次性解决全剧大结局，除非本段目标明确要求收尾。
8. ${SCENE_PRODUCTION_RULES}`

const ADVERTISEMENT_SEGMENT_SYSTEM_PROMPT = `你是中文商业广告的创意总监和制作统筹。请在现有广告脚本末尾追加一组可制作的广告段落，用于按用户指定秒数延长当前广告，而不是重写原稿或另做一支无关广告。
1. 承接现有广告的品牌、产品、核心卖点、受众、视觉风格、产品状态、旁白语气和最后画面；只追加新段落。
2. 追加内容用于补充使用场景、可见证明或情绪价值，不能重复原段落，也不能编造价格、优惠、认证、性能数据、代言或未提供的承诺。
3. 新段落时间码从现有广告结尾继续累计；最后一段重新完成简洁品牌落版和合适的行动引导。
4. 每行使用：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：；剧情写明时段、传播任务、核心信息和屏幕文字。
5. ${ADVERTISEMENT_PRODUCTION_RULES}
6. 只输出“本段资产清单 + 要追加的广告段落正文”，不要复述已有脚本，不要解释、Markdown、表格或分析。`

const SHORT_FILM_SEGMENT_SYSTEM_PROMPT = `你是中文叙事短片的编剧和连续性统筹。请在现有短片末尾续写用户指定时长的新场次，只推进当前故事，不要重写、总结或复述已有内容。
1. 首场直接承接上一场的人物位置、视线、服装、动作、关键物件、环境和声音状态。
2. 新场次继续推进人物目标，形成新的阻力、选择、变化与结果；不得突然新增人物、能力、道具或世界规则。
3. 用户要求收尾时完成因果回收和情绪落点；未要求收尾时留下自然的下一步行动，但不要套用网剧受辱反击或强制下一集钩子。
4. 每行使用：场次：｜剧情：｜场景：｜角色：｜动作：｜对白：｜风格：｜构图：｜光影：｜运镜：｜衔接：。
5. ${SCENE_PRODUCTION_RULES}
6. 只输出“本段资产清单 + 续写的新场次正文”，不要复述已有剧本，不要解释、Markdown、表格或分析。`

const WEB_SERIES_SEGMENT_SYSTEM_PROMPT = `你是中文网剧漫剧的连续剧编剧。请基于已有剧本只续写下一集，严禁重写已有内容。
1. 本次只生成 1 个下一集生产单元，不生成之后的集数；常规 60 秒单集优先输出 3 个约 20 秒的长场次，每场规划约 2 个按导演目的划分的镜头，不按动作拆镜。
2. 承接上一段最后的时间、地点、人物状态、服装、视线、动作和关键物件，前两场要明确接住上一段尾部动作。
3. 每场继续使用“场次标题 + 自然动作段落 + 穿插对白”，在故事里写清人物意图、实际阻碍、可见变化、空间关系、信息获得过程、左右手、移动路线、入场与出场状态，不显示内部检查字段。
4. 每场必须有 4 到 6 句人物对白、画外音或内心独白，单句尽量 5 到 14 个中文字符，台词必须推进冲突或改变决定；声音按发生位置写进正文。
5. 本段末尾保留高波动钩子：悬念、受辱后反击前一秒、身份或实力即将揭示、关键物件启动或敌人误判；最后场仍使用连续 S 编号，把钩子自然写进结尾动作，不要直接解决。
6. ${FAST_WEB_SERIES_SCENE_RULES}
7. 只输出“本集资产清单 + 下一段剧本正文”，不要标题、解释、Markdown、JSON 或分析。`

const QUICK_SCRIPT_FIELDS = ['场次', '剧情', '场景', '角色', '动作', '对白']
const SCRIPT_SCENE_FIELDS = [
  '场次',
  '剧情',
  '场景',
  '角色',
  '动作',
  '对白',
  '风格',
  '构图',
  '光影',
  '运镜',
  '衔接',
]
const WEB_SERIES_SCENE_FIELDS = ['场次', '时长', '场景', '动作', '对白']
function normalizeExpandedScript(raw: string): string {
  const normalized = raw
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  if (/^资产\s*[：:]/u.test(normalized)) return normalized
  const firstScene = normalized.search(/(?:^|\n)\s*(?=场次\s*[：:])/u)
  if (firstScene <= 0) return normalized
  const preamble = normalized.slice(0, firstScene)
  return /(?:用户希望|用户要求|让我|我们需要|我将|任务是|原稿包含|先分析|思考|输出要求)/u.test(preamble)
    ? normalized.slice(firstScene).trim()
    : normalized
}

export function assertRequestedSceneCount(source: string, candidate: string): void {
  const expected = explicitRequestedSceneCount(source)
  if (!expected) return
  const actual = splitScriptParagraphs(candidate).filter((paragraph) =>
    Boolean(parseShotFields(paragraph.text).场次),
  ).length
  if (actual === expected) return
  if (actual < expected) {
    throw new AppError(
      502,
      'PROVIDER_RESPONSE_TRUNCATED',
      `文本服务返回不完整：明确要求 ${expected} 个场次，实际只返回 ${actual} 个；原剧本未被覆盖，请重试或切换模型`,
    )
  }
  throw new AppError(
    502,
    'PROVIDER_RESPONSE_SCENE_COUNT_MISMATCH',
    `文本服务未遵守数量要求：明确要求 ${expected} 个场次，实际返回 ${actual} 个；原剧本未被覆盖，请重试或调整要求`,
  )
}

export function explicitRequestedSceneCount(source: string): number | null {
  const matches = [
    ...source.matchAll(/(\d{1,3})\s*(?:个)?(?:场次|场景|镜头)/gu),
    ...source.matchAll(
      /(?:只要|只保留|改成|调整(?:为|到)|压缩(?:为|到)|控制(?:为|在)|限制(?:为|在)|总共|共)\s*(\d{1,3})\s*(?:个)?场(?![次景])/gu,
    ),
  ].sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
  let requested: number | null = null
  for (const match of matches) {
    const count = Number(match[1])
    if (Number.isInteger(count) && count >= 2 && count <= 100) requested = count
  }
  return requested
}

export async function ensureChineseScriptOutput(
  provider: TextGenerationProvider,
  raw: string,
  model: ScriptModel,
  onTextTiming?: (timing: TextGenerationTiming) => void,
  onTextProgress?: (text: string) => void,
): Promise<string> {
  const candidate = normalizeExpandedScript(raw)
  if (!hasUnexpectedEnglish(candidate)) return candidate

  const repaired = normalizeExpandedScript(
    await provider.generate({
      systemPrompt: CHINESE_SCRIPT_REPAIR_SYSTEM_PROMPT,
      userPrompt: `请修复下面的剧本并完整返回：\n\n${candidate}`,
      maxOutputTokens: Math.min(24_000, Math.max(2_400, Math.ceil(contentLength(candidate) * 1.5))),
      model,
      ...(onTextProgress ? { onTextProgress } : {}),
      ...(onTextTiming ? { onTextTiming, timingLabel: 'language-repair' } : {}),
    }),
  )
  if (!repaired || hasUnexpectedEnglish(repaired)) {
    throw new AppError(
      502,
      'PROVIDER_RESPONSE_LANGUAGE_INVALID',
      '文本服务连续返回大量英文内容，系统已阻止覆盖中文剧本，请更换模型后重试',
    )
  }
  return repaired
}

function hasSufficientWebSeriesDialogue(script: string): boolean {
  const scenes = splitScriptParagraphs(script)
    .map((paragraph) => parseShotFields(paragraph.text))
    .filter((fields) => Boolean(fields.场次))
  if (!scenes.length) return false
  const spokenScenes = scenes.filter((fields) => {
    const dialogue = String(fields.对白 || '')
    return /\[(?:对白|画外音|内心独白)\]/u.test(dialogue) && !/无台词/u.test(dialogue)
  }).length
  return spokenScenes === scenes.length
}

function completeMissingWebSeriesDialogue(script: string, mode: ScriptContentMode): string {
  if (mode !== 'web-series' || hasSufficientWebSeriesDialogue(script)) return script

  const completedBody = splitScriptParagraphs(script)
    .map((paragraph) => {
      const fields = parseShotFields(paragraph.text)
      if (!fields.场次 || sceneHasSpokenDialogue(fields.对白)) return paragraph.text

      const plot = compactDialogueContext(fields.剧情 || fields.动作)
      const existingSound = String(fields.对白 || '')
        .replace(/无台词[\s，,;；。]*/gu, '')
        .replace(/静音[\s，,;；。]*/gu, '')
        .trim()
      const dialogue = [
        `[画外音]${plot || '本场的选择正在改变局面。'}`,
        existingSound,
        existingSound ? '' : '[音效]现场动作声；[环境声]延续当前场景环境声。',
      ]
        .filter(Boolean)
        .join('；')
      const text = appendSpokenContent(paragraph.text, dialogue)
      return [
        paragraph.forceEpisodeBreakBefore ? FORCE_EPISODE_BREAK_MARKER : '',
        paragraph.forceShotBreakBefore ? FORCE_SHOT_BREAK_MARKER : '',
        text,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')
  return withScriptAssetManifest(script, completedBody)
}

export function completeWebSeriesSpokenContent(script: string, mode: ScriptContentMode): string {
  const completed = completeMissingWebSeriesDialogue(script, mode)
  if (mode !== 'web-series') return completed

  const paragraphs = splitScriptParagraphs(completed)
  const fields = paragraphs.map((paragraph) => parseShotFields(paragraph.text))
  const sceneIndexes = fields.flatMap((scene, index) => (scene.场次 ? [index] : []))
  if (!sceneIndexes.length) return completed

  const desiredVoiceoverScenes = Math.min(
    sceneIndexes.length,
    sceneIndexes.length >= 6 ? 3 : Math.max(1, Math.ceil(sceneIndexes.length / 3)),
  )
  const selected = new Set(
    sceneIndexes.filter((index) => /\[画外音\]/u.test(String(fields[index]?.对白 || ''))),
  )
  const sceneChanges = sceneIndexes.filter((index, position) => {
    if (position === 0) return true
    const previous = fields[sceneIndexes[position - 1]!]?.场景 || ''
    const current = fields[index]?.场景 || ''
    return Boolean(
      previous && current && normalizedSceneIdentity(previous) !== normalizedSceneIdentity(current),
    )
  })
  const candidates = [
    sceneIndexes[0],
    ...sceneChanges,
    sceneIndexes[Math.floor(sceneIndexes.length / 2)],
    sceneIndexes[Math.max(0, sceneIndexes.length - 2)],
    ...sceneIndexes,
  ].filter((index): index is number => typeof index === 'number')

  for (const index of candidates) {
    if (selected.size >= desiredVoiceoverScenes) break
    if (selected.has(index)) continue
    const scene = fields[index] || {}
    const dialogue = String(scene.对白 || '').trim()
    const availableCharacters = Math.max(6, 24 - dialogueTextForTiming(dialogue).length)
    const voiceover = shortVoiceoverContext(scene.剧情 || scene.动作, Math.min(16, availableCharacters))
    if (!voiceover) continue
    paragraphs[index]!.text = appendSpokenContent(
      paragraphs[index]!.text,
      `[画外音]${voiceover}；${dialogue}`,
    )
    selected.add(index)
  }

  const completedBody = paragraphs
    .map((paragraph) =>
      [
        paragraph.forceEpisodeBreakBefore ? FORCE_EPISODE_BREAK_MARKER : '',
        paragraph.forceShotBreakBefore ? FORCE_SHOT_BREAK_MARKER : '',
        paragraph.text,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n')
  return withScriptAssetManifest(completed, completedBody)
}

function withScriptAssetManifest(source: string, body: string): string {
  const bodyOnly = scriptBodyWithoutAssetManifest(source)
  if (bodyOnly === source) return body
  const bodyIndex = source.indexOf(bodyOnly)
  if (bodyIndex <= 0) return body
  const prefix = source.slice(0, bodyIndex).trim()
  return prefix ? `${prefix}\n${body.trim()}` : body
}

function sceneHasSpokenDialogue(dialogue: string | undefined): boolean {
  return (
    /\[(?:对白|画外音|内心独白)\]/u.test(String(dialogue || '')) && !/无台词/u.test(String(dialogue || ''))
  )
}

function appendSpokenContent(scene: string, dialogue: string): string {
  const replacement = `对白：${dialogue}`
  if (/(^|｜)\s*对白\s*[：:][^｜]*/u.test(scene)) {
    return scene.replace(/(^|｜)\s*对白\s*[：:][^｜]*/u, `$1${replacement}`)
  }
  if (/^场次\s*[：:][^\n]*[｜|][^\n]*[｜|]/u.test(scene) && scene.includes('\n')) {
    const [header, ...body] = scene.trim().split('\n')
    return [header, naturalDialogueLines(dialogue), ...body].filter(Boolean).join('\n')
  }
  return `${scene}｜${replacement}`
}

function naturalDialogueLines(dialogue: string): string {
  return dialogue
    .split(/(?=\[(?:对白|台词|画外音|内心独白|音效|环境声|音乐|音乐\/环境声)\])/u)
    .map((cue) => cue.trim().replace(/^[；;]+|[；;]+$/gu, ''))
    .filter(Boolean)
    .map((cue) => {
      const tagged = cue.match(/^\[(对白|台词|画外音|内心独白|音效|环境声|音乐|音乐\/环境声)\](.*)$/u)
      if (!tagged?.[1]) return cue
      const kind = tagged[1]
      const content = String(tagged[2] || '').trim()
      if (kind === '对白' || kind === '台词') {
        const spoken = content.match(/^([^：:]{1,16})[：:]\s*(.+)$/u)
        return spoken?.[1] ? `${spoken[1]}：“${spoken[2]}”` : content
      }
      if (kind === '画外音' || kind === '内心独白') return `${kind}：“${content}”`
      return `[${kind}]${content}`
    })
    .join('\n')
}

function compactDialogueContext(value: string | undefined): string {
  const normalized = String(value || '')
    .replace(/动作\s*\d+\s*[：:]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!normalized) return ''
  const sentence = normalized.split(/(?<=[。！？!?])/u)[0] || normalized
  return sentence.length <= 52 ? sentence : `${sentence.slice(0, 52)}。`
}

function shortVoiceoverContext(value: string | undefined, limit: number): string {
  const normalized = String(value || '')
    .replace(/(?:目标|阻力|变化|结果)\s*[：:]/gu, '')
    .replace(/动作\s*\d+\s*[：:]/gu, '')
    .replace(/[“”"']/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!normalized) return ''
  const clause =
    normalized
      .split(/[。！？!?；;，,]/u)
      .find(Boolean)
      ?.trim() || normalized
  const text = (clause.length >= 4 ? clause : normalized)
    .slice(0, Math.max(4, limit))
    .replace(/[。！？!?；;，,]+$/u, '')
  return text ? `${text}。` : ''
}

export function assertWebSeriesDialogueCoverage(script: string, mode: ScriptContentMode): void {
  if (mode !== 'web-series' || hasSufficientWebSeriesDialogue(script)) return
  throw new AppError(
    502,
    'PROVIDER_RESPONSE_INVALID',
    '网剧对白生成不完整：每个场次都需要可听见的对白、画外音或内心独白；原剧本未被覆盖，请重试或切换模型',
  )
}

function hasUnexpectedEnglish(script: string): boolean {
  const inspected = script.replace(/\b(?:AI|CG|2D|3D|Alpha|Seedance|JSON|Markdown|IP|S\d+)\b/giu, '')
  const englishWords = inspected.match(/[A-Za-z]{3,}/g) || []
  if (englishWords.length < 6) return false

  const hanCount = inspected.match(/[\u3400-\u9fff]/gu)?.length || 0
  const latinCount = inspected.match(/[A-Za-z]/g)?.length || 0
  const englishDominantLines = inspected
    .split(/\n+/u)
    .filter((line) => (line.match(/[A-Za-z]{3,}/g) || []).length >= 4)
    .filter((line) => {
      const lineHan = line.match(/[\u3400-\u9fff]/gu)?.length || 0
      const lineLatin = line.match(/[A-Za-z]/g)?.length || 0
      return lineLatin > Math.max(18, lineHan * 1.5)
    }).length
  return englishDominantLines >= 2 || (latinCount >= 80 && latinCount > hanCount * 0.22)
}

export function isProtectedLongScript(script: string): boolean {
  return contentLength(script) >= SINGLE_REWRITE_MAX_LENGTH
}

export function candidateIsTooShort(source: string, candidate: string): boolean {
  return contentLength(candidate) < Math.floor(contentLength(source) * 0.85)
}

export function longScriptMaxOutputTokens(source: string): number {
  return Math.min(LONG_SCRIPT_MAX_TOKENS, Math.max(6_000, Math.ceil(contentLength(source) * 1.6)))
}

export function segmentMaxOutputTokens(
  targetSeconds: number,
  mode: ScriptContentMode = 'short-video',
): number {
  if (mode === 'web-series') return webSeriesMaxOutputTokens(targetSeconds)
  return Math.min(5_500, Math.max(2_400, Math.ceil(targetSeconds / 60) * 650))
}

export function normalizeScriptDurationSeconds(
  value: number,
  fallback: number,
  mode: ScriptContentMode,
): number {
  const minimum = mode === 'web-series' ? 30 : mode === 'short-film' ? 10 : 5
  if (!Number.isFinite(value)) return Math.min(300, Math.max(minimum, Math.round(fallback)))
  return Math.min(300, Math.max(minimum, Math.round(value)))
}

export function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  const minutes = Math.floor(value / 60)
  const remainder = value % 60
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`
}

export function contentLength(value: string): number {
  return value.replace(/\s/g, '').length
}

function scriptSegmentContext(source: string): string {
  if (source.length <= 8_000) return source
  return [
    source.slice(0, 2_500),
    '',
    '[中间已有剧本已省略，生成下一段时不得改写前文]',
    '',
    source.slice(-5_500),
  ].join('\n')
}

export function appendScriptSegment(currentScript: string, segment: string): string {
  if (!currentScript.trim()) return segment.trim()
  return `${currentScript.trim()}\n\n${segment.trim()}`
}

export function segmentScriptIssues(segment: string, mode: ScriptContentMode = 'short-video'): string[] {
  const issues: string[] = []
  const scenes = scriptScenes(segment)
  const webSeriesBudget = webSeriesSceneBudget(60)
  const minimum = mode === 'web-series' ? webSeriesBudget.minimum : 2
  const maximum = mode === 'web-series' ? webSeriesBudget.maximum : 6
  if (scenes.length < minimum || scenes.length > maximum)
    issues.push(`本段生成 ${scenes.length} 个场次，建议保持 ${minimum} 到 ${maximum} 个`)
  for (const field of mode === 'web-series' ? WEB_SERIES_SCENE_FIELDS : QUICK_SCRIPT_FIELDS) {
    const missing = scenes.filter((scene) => sceneFieldMissing(scene, field, mode)).length
    if (missing) issues.push(`${missing} 个场次缺少“${field}”字段`)
  }
  if (contentLength(segment) < 500) issues.push('本段内容偏短，可继续生成下一段或补充段落目标')
  return issues
}

export function quickScriptIssues(
  script: string,
  mode: ScriptContentMode = 'short-video',
  durationSeconds = 30,
): string[] {
  const issues: string[] = []
  const characterCount = script.replace(/\s/g, '').length
  const scenes = scriptScenes(script)
  const budget = scriptContentSceneBudget(mode, durationSeconds)
  const minimumCharacters =
    mode === 'advertisement'
      ? Math.max(500, budget.target * 160)
      : mode === 'short-film'
        ? Math.max(800, budget.target * 190)
        : mode === 'web-series'
          ? Math.max(1_000, budget.target * 450)
          : 1_800

  if (characterCount < minimumCharacters)
    issues.push(
      `内容仅 ${characterCount} 字，建议补充到 ${minimumCharacters} 字以上，确保每段有足够的可执行动作和衔接信息`,
    )
  if (scenes.length < budget.minimum || scenes.length > budget.maximum)
    issues.push(
      mode === 'web-series'
        ? `本集当前 ${scenes.length} 个场次，建议保持 ${budget.minimum} 到 ${budget.maximum} 个`
        : `当前 ${scenes.length} 个场景，目标时长建议保持 ${budget.minimum} 到 ${budget.maximum} 个`,
    )
  for (const field of mode === 'web-series' ? WEB_SERIES_SCENE_FIELDS : QUICK_SCRIPT_FIELDS) {
    const missing = scenes.filter((scene) => sceneFieldMissing(scene, field, mode)).length
    if (missing) issues.push(`${missing} 个场景缺少“${field}”字段`)
  }
  const shortScenes = scenes.filter((scene) => scene.replace(/\s/g, '').length < 90).length
  if (shortScenes) issues.push(`${shortScenes} 个场景内容过短`)
  return issues
}

export function detailedScriptIssues(
  script: string,
  mode: ScriptContentMode = 'short-video',
  durationSeconds = 30,
): string[] {
  const issues: string[] = []
  const scenes = scriptScenes(script)
  const budget = scriptContentSceneBudget(mode, durationSeconds)
  if (scenes.length < budget.minimum || scenes.length > budget.maximum)
    issues.push(`当前 ${scenes.length} 个场景，建议与 ${formatDuration(durationSeconds)} 的目标结构保持一致`)
  for (const field of mode === 'web-series' ? WEB_SERIES_SCENE_FIELDS : SCRIPT_SCENE_FIELDS) {
    const missing = scenes.filter((scene) => sceneFieldMissing(scene, field, mode)).length
    if (missing) issues.push(`${missing} 个场景缺少“${field}”字段`)
  }
  return issues
}

function sceneFieldMissing(scene: string, field: string, mode: ScriptContentMode): boolean {
  if (mode !== 'web-series') return !new RegExp(`${field}[：:]`).test(scene)
  const fields = parseShotFields(scene) as Record<string, string | undefined>
  return !String(fields[field] || '').trim()
}
