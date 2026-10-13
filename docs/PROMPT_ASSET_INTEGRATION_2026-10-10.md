# 资产提示词融合（第四步）

> 后续启用更新：同日已更新构建并在当前本地预览启用，详见 [本地启用验证](PROMPT_LOCAL_ACTIVATION_2026-10-10.md)。下文“未重启”指本步代码完成当时。

2026-10-10。已修改本地主项目及配套独立剧本服务；未部署、重启或进行付费生成。

用户确认正式参考为“已确认面部＋同一造型的正/侧/背独立图”；附件“去头正面身体＋完整背面＋面部特写”的三联图只作明确需要时的可选总览，不默认增加生成数。

## 已修改

- `apps/web/src/features/assets/promptCompiler.js`：身份/造型/临时状态分层；各视角生成单独源图，不在源图内拼表；同衣服背面结构必须连续。写实材质规则按风格与物种启用，保留年龄、疤痕、皱纹等。透明背景保留，柔光允许必要体积与材质明暗。造型 prompt 和 continuityNote 保留并标明用途，场景/道具的临时状态不固化为长期属性。
- `apps/api/src/core/generation/tokenAdventImageProvider.ts`：每张输出的视角约束；参考图明确 subject 用途优先于第一张的位置。只有全部未标用途的旧请求才以首图为身份基准，仅服装/风格参考不错误充当人物身份。单张自定义图不追加三视图源图规则。
- `packages/contracts/src/project.ts`：造型内的三视图参考新增可选 `view: front | side | back`，旧记录兼容；普通面部、全身与导入参考Schema保持原行为。
- `apps/web/src/features/assets/turnaroundReferences.js`、`CharacterWorkflow.jsx`：新保存正/侧/背必须各有一张可用图片；保留视角和原造型归属，预览按字段排正/侧/背。历史全部无标签记录仍按原顺序读取，不重写。
- 配套独立剧本服务：新增共享资产视觉合同，修改换装状态规则；剧情树拆分输入补已有资产完整设计和适用条件。原请求与输出结构保持，仅补上下文和规则。

高级自定义替换提示词仍保留作者原文。默认生图数、计费、任务和重试逻辑未变。三联图没有新增按钮；可使用已有图片大师单图3:2入口及完整记录中的可选模板。“一张设定表”按钮仍表示既有16:9正/侧/背拼表，不是附件三联图。

## 验证与启用

Web相关49项、API Provider22项、全部共享contracts87项、独立剧本后端125项通过。contracts/API TypeScript与Web构建通过，构建产物在支持工作区work内隔离。Web lint仅已有AppShell.jsx的runningJobs未使用警告；API定向及contracts lint通过。1200/390像素静态组件样例检查通过，使用占位图而非真实资产。

尚未测试真实模型画面效果或分镜按朝向自动选图，后者是第五步。运行服务未重载；部署时需先构建contracts再更新API/Web，防止旧运行时Schema剥离新增view字段。

详细的原规则、修改位置、关键新提示词、附件取舍、三联图可选模板与验证边界见配套仓库 [第四步完整记录](../../script-master-update/deploy/PROMPT_INTEGRATION_STEP4_2026-10-10.md)。本轮编辑前备份与校验值在支持工作区 `work/prompt-integration-step4-20261010/`。
