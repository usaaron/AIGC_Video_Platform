import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScriptPage } from './ScriptPage'

const noop = () => {}

function renderScriptPage(project) {
  return renderToStaticMarkup(
    <ScriptPage
      project={project}
      assets={[]}
      billing={{ credits: 2_000 }}
      tasks={[]}
      onSave={noop}
      onGenerate={noop}
      onGenerateSegment={noop}
      onSuggestAssets={noop}
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
})
