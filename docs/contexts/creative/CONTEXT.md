# Creative Platform Context

The creative platform is the user-facing workflow for turning a project into scripts, assets, image batches, video tasks and reusable library items.

## Language

**生图大师**:
序幕TV 的图片生成工作台，面向批次式图片创作和结果复用。
_Avoid_: 图片大师、序幕 image2、ImageForge

**项目资产**:
只属于一个项目的角色、场景、物品、服装、音频、图片、剧本或成片草稿。
_Avoid_: 资产库

**资产库**:
账号级长期资产集合，用于保存、下载和跨项目复用用户主动入库的内容。
_Avoid_: 项目资产、媒体库

**媒体库**:
底层文件上传和读取层，承载图片、音频、视频等对象文件。
_Avoid_: 资产库

**引用图**:
生成图片时用于限定主体、服装、配饰、风格、构图或色调的输入图。
_Avoid_: 本地 Key 图、外部直传图

**批次**:
用户一次提交的一组图片生成结果。
_Avoid_: 后端任务码、provider task id

**生成快照**:
一次生成的可追溯参数记录，包括最终提示词、负面提示词、引用图、清晰度和辅助能力状态。
_Avoid_: 当前表单状态

**可信人像**:
人物授权和真人人脸相关的特例资产概念。
_Avoid_: 通用资产库项、普通引用图
