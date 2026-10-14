import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { videoReviewVersion } from '@seqora/contracts'
import { VideoReviewPanel } from './VideoReviewPanel'
import { ContinuityConnector } from './StoryboardComponents'
const task = {
  id: 'v',
  kind: 'video',
  provider: 'seedance',
  status: 'completed',
  metadata: {},
  outputs: [{ view: 'last-frame' }],
}
describe('video content review UI', () => {
  it('shows concrete scene review criteria and missing-spec leads without approving the video', () => {
    const current = {
      ...task,
      metadata: {
        sourcePromptSnapshot:
          '首帧与空间调度\n人群挤在隔离栏前，守卫在内侧。\n动作时序\n人群推栏杆。\n镜尾状态\n栏杆倾斜。',
      },
    }
    const html = renderToStaticMarkup(createElement(VideoReviewPanel, { task: current, onReview: () => {} }))
    expect(html).toContain('4 项设定待复核')
    for (const text of [
      '接触点、支撑或连接',
      '前中远景',
      '按职责和动机回应',
      '未提示缺项也不表示画面自动通过',
      '待内容验收',
    ])
      expect(html).toContain(text)
  })
  it('does not display completed legacy video as approved', () => {
    const html = renderToStaticMarkup(createElement(VideoReviewPanel, { task, onReview: () => {} }))
    expect(html).toContain('已生成 · 待内容验收')
    expect(html).toContain('已观看，验收通过')
    expect(html).toContain('已排队的衔接镜头可自动继续')
  })
  it('shows rigid physics status, violations, and base/connection frame coverage', () => {
    const current = {
      ...task,
      metadata: {
        rigidPhysicsContract: {
          objects: [
            {
              id: 'barrier',
              label: '固定隔离栏',
              anchors: [
                { id: 'left-base', role: 'base' },
                { id: 'right-base', role: 'base' },
              ],
            },
            { id: 'gate', label: '滑动闸门', anchors: [{ id: 'track', role: 'connection' }] },
          ],
        },
        rigidPhysicsAudit: {
          status: 'failed',
          checkedFrames: 12,
          violations: [{ code: 'ANCHOR_DRIFT', objectId: 'barrier', frame: 7, detail: '底脚漂移' }],
          frameEvidence: [
            {
              frame: 0,
              objectId: 'barrier',
              anchorPoints: { 'left-base': { x: 0.1, y: 0.8 }, 'right-base': { x: 0.9, y: 0.8 } },
            },
            {
              frame: 1,
              objectId: 'barrier',
              anchorPoints: { 'left-base': { x: 0.1, y: 0.8 }, 'right-base': { x: 0.9, y: 0.8 } },
            },
            { frame: 0, objectId: 'gate', anchorPoints: { track: { x: 0.5, y: 0.8 } } },
          ],
        },
      },
    }
    const html = renderToStaticMarkup(createElement(VideoReviewPanel, { task: current, onReview: () => {} }))
    for (const text of [
      '刚性物理验收',
      '物理验收失败',
      '锚点漂移 · 第 8 帧',
      '底脚与连接点逐帧证据覆盖',
      '2/12 帧',
      '底脚 left-base',
      '连接点 track',
    ])
      expect(html).toContain(text)
  })
  it('does not say tail frame is ready before review', () => {
    const props = {
      previousShot: { title: '上一镜', order: 1 },
      shot: { title: '下一镜', order: 2, continuityMode: 'continue' },
      previousVideoTask: task,
    }
    expect(renderToStaticMarkup(createElement(ContinuityConnector, props))).toContain('待内容验收，暂不承接')
    const approved = {
      ...task,
      metadata: { contentReview: { decision: 'approved', mediaVersion: videoReviewVersion(task) } },
    }
    expect(
      renderToStaticMarkup(createElement(ContinuityConnector, { ...props, previousVideoTask: approved })),
    ).toContain('上一镜头尾帧已就绪')
  })
})
