import { describe, expect, it } from 'vitest'
import type { Asset } from './project.js'
import { analyzeScriptForProduction, suggestScriptAssets } from './scriptAnalysis.js'

const now = new Date().toISOString()

function asset(input: Partial<Asset> & Pick<Asset, 'id' | 'kind' | 'name'>): Asset {
  return {
    id: input.id,
    projectId: 'project-1',
    tenantId: 'tenant-1',
    kind: input.kind,
    sourceMode: 'generate',
    name: input.name,
    description: input.description ?? '',
    prompt: input.prompt ?? '',
    promptMode: 'standard',
    customPromptMode: 'append',
    customPrompt: '',
    negativePrompt: '',
    references: [],
    attributes:
      input.kind === 'audio'
        ? {
            type: 'audio',
            audioType: 'ambience',
            gender: 'unspecified',
            ageGroup: 'young',
            emotion: 'neutral',
            tone: 'warm',
            speed: 'normal',
            language: 'mandarin',
            duration: 15,
            loop: false,
          }
        : input.kind === 'scene'
          ? {
              type: 'scene',
              space: 'exterior',
              sceneType: 'street',
              era: 'modern',
              time: 'night',
              weather: 'clear',
              mood: 'mystery',
              camera: 'wide',
              visualStyle: 'cinematic-cg',
              emptyScene: true,
              activitySpace: true,
            }
          : input.kind === 'prop'
            ? {
                type: 'prop',
                usage: 'key',
                category: 'daily',
                material: 'mixed',
                condition: 'used',
                view: 'front',
                background: 'solid',
                visualStyle: 'cinematic-cg',
              }
            : {
                type: 'character',
                subjectType: 'human',
                gender: 'female',
                ageGroup: 'young',
                exactAge: null,
                species: '',
                anthropomorphic: false,
                visualStyle: 'cinematic-cg',
                framing: 'full',
                bodyType: 'balanced',
                background: 'solid',
                faceStatus: 'pending',
                bodyStatus: 'pending',
                faceReference: null,
                bodyReference: null,
                legStretch: false,
                faceBrightening: false,
                turnaround: false,
                turnaroundReferences: [],
                turnaroundLayout: 'sheet',
              },
    imageUrl: input.imageUrl ?? null,
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  }
}

describe('script analysis', () => {
  it('splits script semantically and links existing assets to shots', () => {
    const result = analyzeScriptForProduction(`雨夜，林夏走入三号站台。\n\n林夏打开铁盒，看见胶片。`, [
      asset({ id: 'asset-lin', kind: 'character', name: '林夏', imageUrl: '/lin.jpg' }),
      asset({ id: 'asset-station', kind: 'scene', name: '三号站台', imageUrl: '/station.jpg' }),
    ])

    expect(result.shots).toHaveLength(2)
    expect(result.shots[0]).toMatchObject({
      assetIds: ['asset-lin', 'asset-station'],
      imageUrl: '/lin.jpg',
    })
    expect(result.shots[1]?.assetIds).toContain('asset-lin')
  })

  it('suggests recurring props but ignores one-off props', () => {
    const suggestions = suggestScriptAssets('林夏撑开雨伞。雨伞落在站台边。她打开钥匙。')

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'prop',
          name: '雨伞',
          priority: 'high',
        }),
      ]),
    )
    expect(suggestions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'prop', name: '钥匙' })]),
    )
  })
})
