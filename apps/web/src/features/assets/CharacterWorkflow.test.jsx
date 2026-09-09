import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CharacterWorkflow } from './CharacterWorkflow'

const face = { id: 'face-1-single', url: '/api/v1/generation/tasks/face-1/outputs/single' }

function generationButton(attributes, tasks = [], stage = 'body', label = '生成全身候选') {
  const html = renderToStaticMarkup(
    <CharacterWorkflow
      assetId="character-1"
      assetName="Character"
      stage={stage}
      attributes={attributes}
      references={[]}
      tasks={tasks}
    />,
  )
  return html.match(/<button\b[\s\S]*?<\/button>/g).find((button) => button.includes(label))
}

const bodyGenerationButton = (attributes, tasks) => generationButton(attributes, tasks)

describe('character body prerequisites', () => {
  it('allows an explicitly activated historical body version despite a newer generated candidate', () => {
    const oldBody = { id: 'body-old', url: '/api/v1/generation/tasks/body-old/outputs/single' }
    const latestBody = {
      id: 'body-new',
      kind: 'image',
      status: 'completed',
      createdAt: '2026-09-08T00:00:00.000Z',
      metadata: { assetId: 'character-1', generationStage: 'body' },
      outputs: [
        { id: 'body-new', url: '/api/v1/generation/tasks/body-new/outputs/single', mediaType: 'image' },
      ],
    }
    const attributes = {
      faceStatus: 'approved',
      faceReference: face,
      bodyStatus: 'approved',
      bodyReference: oldBody,
      activeAppearanceVariantId: 'variant-old',
      appearanceVariants: [
        { id: 'variant-old', name: 'Old costume', bodyReference: oldBody, turnaroundReferences: [] },
      ],
    }
    expect(generationButton(attributes, [latestBody], 'turnaround', '生成三视图')).not.toContain(
      'disabled=""',
    )
    expect(
      generationButton(
        { ...attributes, activeAppearanceVariantId: null },
        [latestBody],
        'turnaround',
        '生成三视图',
      ),
    ).toContain('disabled=""')
    expect(
      generationButton(
        { ...attributes, bodyReference: { id: oldBody.id } },
        [latestBody],
        'turnaround',
        '生成三视图',
      ),
    ).toContain('disabled=""')
  })

  it('requires the confirmed face image, even when legacy data says approved', () => {
    expect(bodyGenerationButton({ faceStatus: 'approved', faceReference: null })).toContain('disabled=""')
    expect(bodyGenerationButton({ faceStatus: 'approved', faceReference: { id: face.id } })).toContain(
      'disabled=""',
    )
    expect(bodyGenerationButton({ faceStatus: 'pending', faceReference: face })).toContain('disabled=""')
  })

  it('allows body generation with a confirmed image without requiring a video whitelist entry', () => {
    expect(bodyGenerationButton({ faceStatus: 'approved', faceReference: face })).not.toContain('disabled=""')
  })

  it('requires confirmation of a newly generated face before continuing with a body', () => {
    const task = {
      id: 'face-2',
      kind: 'image',
      status: 'completed',
      createdAt: '2026-09-07T00:00:00.000Z',
      metadata: { assetId: 'character-1', generationStage: 'face' },
      outputs: [
        {
          id: 'face-2-single',
          view: 'single',
          mediaType: 'image',
          url: '/api/v1/generation/tasks/face-2/outputs/single',
        },
      ],
    }
    expect(bodyGenerationButton({ faceStatus: 'approved', faceReference: face }, [task])).toContain(
      'disabled=""',
    )
  })
})
