import { describe, expect, it } from 'vitest'
import {
  isActiveWorkspaceProject,
  normalizeWorkspace,
  normalizeTasks,
  shouldLoadTaskDetails,
  workspacePollingProjectId,
} from './workspaceLoadingPolicy'

describe('workspace loading policy', () => {
  const workspace = { project: { id: 'project-1' } }

  it('does not poll or preload a project while the library is open', () => {
    expect(workspacePollingProjectId('home', workspace)).toBeNull()
  })

  it('opens the overview with compact task summaries', () => {
    expect(workspacePollingProjectId('overview', workspace)).toBe('project-1')
    expect(shouldLoadTaskDetails('overview')).toBe(false)
  })

  it('only accepts async results for the currently selected project', () => {
    expect(isActiveWorkspaceProject('project-2', 'project-2')).toBe(true)
    expect(isActiveWorkspaceProject('project-1', 'project-2')).toBe(false)
    expect(isActiveWorkspaceProject(null, 'project-2')).toBe(false)
  })

  it('keeps a valid project open when older workspace fields are missing', () => {
    expect(
      normalizeWorkspace({ project: { id: 'project-1', name: '旧项目' }, assets: null, shots: undefined }),
    ).toEqual({
      project: {
        id: 'project-1',
        name: '旧项目',
        contentType: 'animation',
        visualStyle: 'cinematic-cg',
        episodeDurationSeconds: 60,
        aspectRatio: '16:9',
        status: 'draft',
        synopsis: '',
        script: '',
        version: 1,
      },
      scriptEpisodes: [],
      assets: [],
      shots: [],
    })
  })

  it('normalizes legacy nested values before pages render them', () => {
    const normalized = normalizeWorkspace({
      project: { id: 'legacy-project', name: null, script: null },
      scriptEpisodes: [{ id: 'episode-1', episodeNumber: '1', content: null, continuityState: [] }],
      assets: [
        {
          id: 'asset-1',
          kind: 'character',
          name: null,
          attributes: { appearanceVariants: {}, faceReference: 'invalid' },
          references: {},
        },
      ],
      shots: [{ id: 'shot-1', order: null, duration: null, title: null, prompt: null }],
    })

    expect(normalized).toMatchObject({
      project: { name: '未命名项目', script: '' },
      scriptEpisodes: [{ title: '第 1 集', content: '', continuityState: {} }],
      assets: [{ name: '未命名资产', references: [], attributes: { type: 'character', appearanceVariants: [] } }],
      shots: [{ title: '镜头 1', order: 1, duration: 3, prompt: '' }],
    })
  })

  it('makes malformed task output and metadata values render-safe', () => {
    expect(
      normalizeTasks([
        {
          id: 'task-1',
          projectId: 'project-1',
          kind: 'video',
          status: 'completed',
          metadata: [],
          outputs: {},
        },
        { id: 'task-2', outputs: [{ url: '/video.mp4' }, 'invalid'] },
        { projectId: 'project-1' },
      ]),
    ).toEqual([
      expect.objectContaining({ id: 'task-1', metadata: {}, outputs: [] }),
      expect.objectContaining({
        id: 'task-2',
        metadata: {},
        outputs: [{ id: 'task-2-output-1', url: '/video.mp4', mediaType: '', view: '' }],
      }),
    ])
  })

  it('rejects malformed workspace responses instead of rendering a blank page', () => {
    expect(normalizeWorkspace(null)).toBeNull()
    expect(normalizeWorkspace({ project: null })).toBeNull()
    expect(normalizeWorkspace({ project: { name: '缺少 id' } })).toBeNull()
  })

  it.each(['script', 'assets', 'storyboard', 'film', 'image-studio'])(
    'loads full task details for %s',
    (step) => {
      expect(shouldLoadTaskDetails(step)).toBe(true)
    },
  )
})
