import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScriptPage } from './ScriptPage'

const noop = () => {}

function suggestionFingerprint(value) {
  let hash = 2166136261
  for (const character of value.trim()) {
    hash ^= character.codePointAt(0) || 0
    hash = Math.imul(hash, 16777619)
  }
  return `${value.trim().length}:${(hash >>> 0).toString(16)}`
}

function renderScriptPage(
  project,
  textProviderStatus = 'configured',
  tasks = [],
  scriptEpisodes = [],
  scriptModelCapabilities = [],
) {
  return renderToStaticMarkup(
    <ScriptPage
      project={project}
      scriptEpisodes={scriptEpisodes}
      assets={[]}
      billing={{ credits: 2_000 }}
      tasks={tasks}
      textProviderStatus={textProviderStatus}
      scriptModelCapabilities={scriptModelCapabilities}
      onSave={noop}
      onSaveEpisode={noop}
      onDeleteEpisode={noop}
      onClearEpisodes={noop}
      onGenerate={noop}
      onGenerateSegment={noop}
      onSuggestAssets={noop}
      onSuggestAssetsFast={noop}
      onCreateAsset={noop}
      onUpload={noop}
      onCancelTask={noop}
      onUpdateEpisodeDuration={noop}
      onNext={noop}
    />,
  )
}

function renderUnavailableScriptPage(project) {
  return renderToStaticMarkup(
    <ScriptPage
      project={project}
      assets={[]}
      billing={{ credits: 2_000 }}
      tasks={[]}
      textProviderStatus="unavailable"
      onSave={noop}
      onGenerate={noop}
      onGenerateSegment={noop}
      onSuggestAssets={noop}
      onSuggestAssetsFast={noop}
      onCreateAsset={noop}
      onUpload={noop}
      onCancelTask={noop}
      onUpdateEpisodeDuration={noop}
      onNext={noop}
    />,
  )
}

describe('script content modes', () => {
  it('renders advertisement-specific duration and production language', () => {
    const html = renderScriptPage({
      id: 'advertisement-1',
      name: '序幕TV宣传片',
      contentType: 'advertisement',
      episodeDurationSeconds: 30,
      aspectRatio: '16:9',
      synopsis: '',
      script: '',
    })

    expect(html).toContain('《序幕TV宣传片》广告脚本')
    expect(html).toContain('广告创作模式')
    expect(html).toContain('广告时长')
    expect(html).toContain('开场抓点、核心价值、可见证明与品牌落版')
    expect(html).toContain('传播结构 · 产品画面 · 旁白文案 · 品牌落版')
    expect(html).toContain('inputMode="numeric"')
    expect(html).toContain('pattern="[0-9]*"')
    expect(html).not.toContain('type="number"')
    expect(html).not.toContain('由新建影片的内容类型决定')
    expect(html).not.toContain('15～30 秒短片')
    expect(html).not.toContain('短视频模式')
  })

  it('renders short-film narrative and continuation language', () => {
    const developedScript =
      '场次：S01｜剧情：林夏寻找遗失的信。｜场景：雨夜车站。｜角色：林夏；站务员。｜动作：动作1：林夏翻找长椅；动作2：站务员递来失物箱。｜对白：[对白]林夏：我必须找到它。｜风格：现实主义短片。｜构图：中景。｜光影：冷色站台灯。｜运镜：缓慢跟随。｜衔接：信件仍未找到。'.repeat(
        2,
      )
    const html = renderScriptPage({
      id: 'short-film-1',
      name: '末班来信',
      contentType: 'animation',
      episodeDurationSeconds: 45,
      aspectRatio: '16:9',
      synopsis: '女孩在末班车前寻找一封信。',
      script: developedScript,
    })

    expect(html).toContain('《末班来信》短片剧本')
    expect(html).toContain('短片创作模式')
    expect(html).toContain('短片时长')
    expect(html).toContain('叙事闭环 · 角色行动 · 对白声音 · 镜头衔接')
    expect(html).toContain('续写短片')
    expect(html).toContain('续写时长')
    expect(html).not.toContain('剧本追加')
  })

  it('defaults to DeepSeek Flash and keeps the model list in provider order', () => {
    const html = renderScriptPage({
      id: 'model-order-1',
      name: '模型顺序测试',
      contentType: 'short-drama',
      episodeDurationSeconds: 60,
      aspectRatio: '9:16',
      synopsis: '验证前端模型顺序。',
      script: '',
    })

    const flashIndex = html.indexOf('DeepSeek V4 Flash')
    const proIndex = html.indexOf('DeepSeek V4 Pro')
    const glmIndex = html.indexOf('GLM 5.2（当前不可用）')
    const seqoraIndex = html.indexOf('序幕-5.6')

    expect(flashIndex).toBeGreaterThan(-1)
    expect(flashIndex).toBeLessThan(proIndex)
    expect(proIndex).toBeLessThan(glmIndex)
    expect(glmIndex).toBeLessThan(seqoraIndex)
    expect(html).toContain('<option value="glm-5.2" disabled="">')
    expect(html).toContain('<option value="deepseek-v4-flash" selected="">')
    expect(html).toContain('辅助资产建议')
    expect(html).toContain('随剧本自动识别人物、场景、物品、服装和品牌')
    expect(html).toContain('不会占用生成队列')
  })

  it('uses server capabilities instead of hard-coded model availability', () => {
    const html = renderScriptPage(
      {
        id: 'model-capabilities-1',
        name: '模型能力测试',
        contentType: 'short-drama',
        episodeDurationSeconds: 60,
        aspectRatio: '9:16',
        synopsis: '',
        script: '',
      },
      'configured',
      [],
      [],
      [
        { id: 'deepseek-v4-flash', available: true },
        { id: 'deepseek-v4-pro', available: false },
        { id: 'glm-5.2', available: true },
        { id: 'gpt-5.6-sol', available: false },
      ],
    )

    expect(html).toContain('<option value="glm-5.2">GLM 5.2</option>')
    expect(html).toContain(
      '<option value="deepseek-v4-pro" disabled="">DeepSeek V4 Pro（当前不可用）</option>',
    )
    expect(html).toContain('<option value="gpt-5.6-sol" disabled="">序幕-5.6（当前不可用）</option>')
  })

  it('shows the accumulated model text as a read-only live draft', () => {
    const html = renderScriptPage(
      {
        id: 'streaming-script-1',
        name: '实时剧本测试',
        contentType: 'short-drama',
        episodeDurationSeconds: 60,
        aspectRatio: '9:16',
        synopsis: '主角在雨夜追查真相。',
        script: '',
      },
      'configured',
      [
        {
          id: 'task-streaming-script',
          projectId: 'streaming-script-1',
          kind: 'text',
          label: '智能生成网剧剧本',
          status: 'running',
          metadata: {
            generationStage: 'script-generate',
            scriptOperation: 'generate',
            textPreview: '场次：S01｜剧情：主角推开仓库门。',
            textPreviewValidation: {
              recognizedScenes: 2,
              checkedScenes: 1,
              structurallyCompleteScenes: 1,
              dialogueScenes: 1,
            },
          },
        },
      ],
    )

    expect(html).toContain('实时草稿')
    expect(html).toContain('已生成片段 · 校验同步进行')
    expect(html).toContain('已收到片段，继续补全')
    expect(html).toContain('主角推开仓库门')
    expect(html).toContain('已识别 2 场')
    expect(html).toContain('已校验 1 场')
    expect(html).toContain('模型仍在继续补全；完整校验通过后才会写入正文')
  })

  it('keeps a live preview frame visible before the first model text arrives', () => {
    const html = renderScriptPage(
      {
        id: 'waiting-script-1',
        name: '等待首字测试',
        contentType: 'short-drama',
        episodeDurationSeconds: 60,
        aspectRatio: '9:16',
        synopsis: '主角准备推门。',
        script: '',
      },
      'configured',
      [
        {
          id: 'task-waiting-script',
          projectId: 'waiting-script-1',
          kind: 'text',
          label: '智能生成网剧剧本',
          status: 'running',
          createdAt: '2026-08-30T00:00:00.000Z',
          updatedAt: '2026-08-30T00:00:00.000Z',
          metadata: {
            generationStage: 'script-generate',
            scriptOperation: 'generate',
          },
        },
      ],
    )

    expect(html).toContain('script-live-preview is-waiting')
    expect(html).toContain('正在等待首段内容')
    expect(html).toContain('script-live-preview-skeleton')
    expect(html).toContain('第 1 集')
  })

  it('offers stop, fast extraction, and skip actions while asset analysis is running', () => {
    const script = '场次：S01｜场景：雨夜车站｜角色：林夏｜道具：旧雨伞'
    const project = {
      id: 'asset-analysis-controls-1',
      name: '资产分析控制测试',
      contentType: 'short-drama',
      episodeDurationSeconds: 60,
      aspectRatio: '9:16',
      synopsis: '',
      script,
    }
    const html = renderScriptPage(project, 'configured', [
      {
        id: 'asset-analysis-task-1',
        projectId: project.id,
        kind: 'text',
        status: 'running',
        createdAt: '2026-09-01T00:00:00.000Z',
        metadata: {
          generationStage: 'script-asset-suggestions',
          scriptOperation: 'suggest-assets',
          sourceScriptFingerprint: suggestionFingerprint(script),
          assetRevision: 'none',
        },
      },
    ])

    expect(html).toContain('停止资产分析')
    expect(html).toContain('使用剧本快速提取')
    expect(html).toContain('跳过并进入资产设计')
  })

  it('removes the live preview for completed tasks and ignores another project task', () => {
    const project = {
      id: 'preview-isolation-1',
      name: '预览隔离测试',
      contentType: 'short-drama',
      episodeDurationSeconds: 60,
      aspectRatio: '9:16',
      synopsis: '验证任务状态和项目隔离。',
      script: '',
    }
    const completedHtml = renderScriptPage(project, 'configured', [
      {
        id: 'completed-script-task',
        projectId: project.id,
        kind: 'text',
        label: '已完成的剧本任务',
        status: 'completed',
        metadata: {
          generationStage: 'script-generate',
          scriptOperation: 'generate',
          textPreview: '这段内容不应继续显示。',
        },
      },
    ])
    const otherProjectHtml = renderScriptPage(project, 'configured', [
      {
        id: 'other-project-script-task',
        projectId: 'another-project',
        kind: 'text',
        label: '其他项目的剧本任务',
        status: 'running',
        metadata: {
          generationStage: 'script-generate',
          scriptOperation: 'generate',
          textPreview: '其他项目内容不应显示。',
        },
      },
    ])

    expect(completedHtml).not.toContain('script-live-preview')
    expect(completedHtml).not.toContain('这段内容不应继续显示')
    expect(otherProjectHtml).not.toContain('script-live-preview')
    expect(otherProjectHtml).not.toContain('其他项目内容不应显示')
  })

  it('collapses saved web-series episodes and only offers deletion on the final episode', () => {
    const project = {
      id: 'series-episodes-1',
      name: '追光者',
      contentType: 'short-drama',
      episodeDurationSeconds: 60,
      aspectRatio: '9:16',
      synopsis: '',
      script: '第一集\n\n【强制下一集】\n\n第二集',
    }
    const baseEpisode = {
      projectId: project.id,
      tenantId: 'tenant-1',
      draftContent: '',
      status: 'saved',
      summary: '',
      continuityState: {},
      revision: 1,
      lastEditedBy: 'user-1',
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    }
    const html = renderScriptPage(
      project,
      'configured',
      [],
      [
        { ...baseEpisode, id: 'episode-1', episodeNumber: 1, title: '第 1 集', content: '第一集' },
        { ...baseEpisode, id: 'episode-2', episodeNumber: 2, title: '第 2 集', content: '第二集' },
      ],
    )

    const navigatorIndex = html.indexOf('class="script-episode-navigator"')
    const editorIndex = html.indexOf('class="script-textarea-wrap"')

    expect(html).not.toContain('script-episode-stack')
    expect(html).toContain('已保存 2 集')
    expect(html).toContain('aria-label="选择要编辑的剧集"')
    expect(html).toContain('第 1 集 · 3 字 · 已保存')
    expect(navigatorIndex).toBeGreaterThan(-1)
    expect(navigatorIndex).toBeLessThan(editorIndex)
    expect(html).toContain('继续生成第 3 集')
    expect(html).toContain('aria-label="清空全部剧集"')
    expect(html).not.toContain('aria-label="删除第 1 集"')

    const draftHtml = renderScriptPage(
      project,
      'configured',
      [],
      [
        { ...baseEpisode, id: 'episode-1', episodeNumber: 1, title: '第 1 集', content: '第一集' },
        {
          ...baseEpisode,
          id: 'episode-2',
          episodeNumber: 2,
          title: '第 2 集',
          content: '第二集',
          draftContent: '第二集草稿',
          status: 'draft',
        },
      ],
    )
    expect(draftHtml).toContain('aria-label="删除第 2 集"')
    expect(draftHtml).not.toContain('aria-label="删除第 1 集"')
  })

  it('does not offer a false generating state when the text provider is unavailable', () => {
    const html = renderUnavailableScriptPage({
      id: 'unavailable-1',
      name: '预发测试',
      contentType: 'short-drama',
      episodeDurationSeconds: 60,
      aspectRatio: '9:16',
      synopsis: '测试文本模型不可用时的提示。',
      script: '',
    })

    expect(html).toContain('当前预发环境未配置可用的文本模型')
    expect(html).toContain('disabled=""')
  })

  it('fails closed when provider health is not available yet', () => {
    const html = renderScriptPage(
      {
        id: 'unknown-provider-1',
        name: '状态检查中',
        contentType: 'short-drama',
        episodeDurationSeconds: 60,
        aspectRatio: '9:16',
        synopsis: '测试健康检查未返回时的提示。',
        script: '',
      },
      null,
    )

    expect(html).toContain('暂时无法确认文本模型状态')
    expect(html).toContain('disabled=""')
  })
})
