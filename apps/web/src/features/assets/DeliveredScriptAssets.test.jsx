import { beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [], dirty: false }))
const suggestions = vi.hoisted(() => ({ current: null }))
vi.mock('../script/useAssetSuggestions', () => ({ useAssetSuggestions: () => suggestions.current }))
// Run component effects explicitly, following the hook harness used by
// useAssetSuggestions.test.jsx without adding a browser DOM dependency.
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal()
  const changed = (previous, next) =>
    !previous || next.some((value, index) => !Object.is(value, previous[index]))
  return {
    ...react,
    useState(initial) {
      const index = hooks.cursor++
      hooks.slots[index] ||= { value: typeof initial === 'function' ? initial() : initial }
      return [
        hooks.slots[index].value,
        (update) => {
          const current = hooks.slots[index].value
          const next = typeof update === 'function' ? update(current) : update
          hooks.dirty ||= !Object.is(current, next)
          hooks.slots[index].value = next
        },
      ]
    },
    useMemo(factory, dependencies) {
      const index = hooks.cursor++
      if (changed(hooks.slots[index]?.dependencies, dependencies))
        hooks.slots[index] = { value: factory(), dependencies }
      return hooks.slots[index].value
    },
    useEffect(effect, dependencies) {
      const index = hooks.cursor++
      if (!changed(hooks.slots[index]?.dependencies, dependencies)) return
      hooks.slots[index] = { dependencies }
      hooks.effects.push(effect)
    },
  }
})

import { DeliveredScriptAssets } from './DeliveredScriptAssets'
import { AssetSuggestionsPanel } from '../script/AssetSuggestionsPanel'

const room = { kind: 'scene', name: '档案室' }
const cast = { kind: 'character', name: '沉默者' }
const prop = { kind: 'prop', name: '铜钥匙' }

beforeEach(() => {
  hooks.slots = []
  hooks.cursor = 0
  hooks.effects = []
  hooks.dirty = false
  suggestions.current = {
    status: 'ready',
    result: null,
    createdKeys: new Set(),
    creatingKeys: new Set(),
    importSelected: vi.fn(),
    extractFast: vi.fn(),
  }
})

function mount() {
  const props = {
    project: { id: 'project', contentType: 'short-drama', visualStyle: 'cinematic-cg' },
    scriptEpisodes: [
      {
        id: 'ep-1',
        episodeNumber: 1,
        status: 'saved',
        content: '场次：S01｜角色：沉默者｜场景：档案室｜动作：推门。',
      },
    ],
    assets: [{ ...room, id: 'room-1' }],
    onCreateAsset: vi.fn(),
    onImportAssets: vi.fn(),
    onSuggestAssetsFast: vi.fn(),
  }
  let details
  const render = () => {
    let attempts = 0
    do {
      if (++attempts > 20) throw new Error('Component did not settle')
      hooks.cursor = 0
      hooks.dirty = false
      details = DeliveredScriptAssets(props).props.children[0]
      hooks.effects.splice(0).forEach((effect) => effect())
    } while (hooks.dirty)
    return details
  }
  return {
    props,
    render,
    get details() {
      return details
    },
  }
}

describe('delivered script asset confirmation', () => {
  it('reveals newly read records even when the project already contains assets', () => {
    const app = mount()
    expect(app.render().props.open).toBe(false)
    suggestions.current.result = { assets: [room, cast] }
    expect(app.render().props.open).toBe(true)
    const panel = app.details.props.children.find((child) => child?.type === AssetSuggestionsPanel)
    expect(panel.props.createdKeys).toEqual(new Set(['scene:档案室']))
    expect(panel.props.copy.importSelected).toBe('确认加入资产')
    expect(panel.props.showPrompt).toBe(false)
    expect(panel.props.showExport).toBe(false)
    expect(app.props.onCreateAsset).not.toHaveBeenCalled()
    expect(app.props.onImportAssets).not.toHaveBeenCalled()
    expect(suggestions.current.importSelected).not.toHaveBeenCalled()
  })

  it('keeps a manual collapse until another pending record arrives', () => {
    const app = mount()
    suggestions.current.result = { assets: [room, cast] }
    expect(app.render().props.open).toBe(true)
    app.details.props.onToggle({ currentTarget: { open: false } })
    expect(app.render().props.open).toBe(false)
    suggestions.current.result = { assets: [room, cast] }
    expect(app.render().props.open).toBe(false)
    suggestions.current.result = { assets: [room, cast, prop] }
    expect(app.render().props.open).toBe(true)
  })

  it('keeps already imported records collapsed and reusable', () => {
    const app = mount()
    suggestions.current.result = { assets: [room, cast] }
    suggestions.current.createdKeys = new Set(['character:沉默者'])
    expect(app.render().props.open).toBe(false)
    expect(suggestions.current.extractFast).not.toHaveBeenCalled()
  })
})
