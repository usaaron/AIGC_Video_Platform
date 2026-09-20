import { beforeEach, describe, expect, it, vi } from 'vitest'

// Exercise the hook's effects and async completions without adding a browser DOM
// dependency to the web unit suite. Rendering and effect cleanup remain explicit.
const hooks = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [], dirty: false }))
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal()
  const changed = (previous, next) =>
    !previous || !next || next.some((value, index) => !Object.is(value, previous[index]))
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
          if (!Object.is(current, next)) hooks.dirty = true
          hooks.slots[index].value = next
        },
      ]
    },
    useRef(initial) {
      const index = hooks.cursor++
      hooks.slots[index] ||= { current: initial }
      return hooks.slots[index]
    },
    useMemo(factory, dependencies) {
      const index = hooks.cursor++
      if (changed(hooks.slots[index]?.dependencies, dependencies)) {
        hooks.slots[index] = { value: factory(), dependencies }
      }
      return hooks.slots[index].value
    },
    useEffect(effect, dependencies) {
      const index = hooks.cursor++
      const previous = hooks.slots[index]
      if (!changed(previous?.dependencies, dependencies)) return
      const slot = { dependencies, cleanup: previous?.cleanup }
      hooks.slots[index] = slot
      hooks.effects.push(() => {
        slot.cleanup?.()
        slot.cleanup = effect()
      })
    },
  }
})

import { useAssetSuggestions } from './useAssetSuggestions'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function mount(overrides = {}) {
  let props = {
    projectId: 'project-one',
    script: '人物：林夏',
    autoSource: '人物：林夏',
    scopeFingerprint: 'manual-one',
    autoScopeFingerprint: 'saved-one',
    direction: { style: 'auto' },
    onSuggestAssetsFast: vi.fn().mockResolvedValue({ summary: '已保存范围', assets: [] }),
    setStoppingTaskId: vi.fn(),
    ...overrides,
  }
  let value
  const render = (update = {}) => {
    props = { ...props, ...update }
    let iterations = 0
    do {
      if (++iterations > 30) throw new Error('Hook did not settle')
      hooks.cursor = 0
      hooks.dirty = false
      value = useAssetSuggestions(props)
      hooks.effects.splice(0).forEach((effect) => effect())
    } while (hooks.dirty)
    return value
  }
  render()
  return {
    render,
    get value() {
      return value
    },
    get props() {
      return props
    },
    async flush() {
      await Promise.resolve()
      await Promise.resolve()
      return render()
    },
    unmount() {
      hooks.slots.forEach((slot) => slot.cleanup?.())
    },
  }
}

beforeEach(() => {
  hooks.slots = []
  hooks.cursor = 0
  hooks.effects = []
  hooks.dirty = false
})

describe('automatic asset extraction lifecycle', () => {
  it('preserves saved suggestions without rescanning when selecting or editing draft text', async () => {
    const app = mount()
    await app.flush()
    const scan = app.props.onSuggestAssetsFast
    app.value.reset({ preserveAutomatic: true })
    app.render({ script: '另一集未保存的编辑', scopeFingerprint: 'manual-two' })
    await app.flush()
    expect(scan).toHaveBeenCalledOnce()
    expect(app.value.result.summary).toBe('已保存范围')
    expect(app.value.status).toBe('ready')
  })

  it('preserves an in-flight saved scan during draft edits and deduplicates manual clicks', async () => {
    const response = deferred()
    const scan = vi.fn().mockReturnValue(response.promise)
    const app = mount({ onSuggestAssetsFast: scan })
    app.value.reset({ preserveAutomatic: true })
    app.render({ script: '人物：新草稿', scopeFingerprint: 'draft-two' })
    response.resolve({ summary: '原保存范围', assets: [] })
    await app.flush()
    expect(app.value.result.summary).toBe('原保存范围')
    const manual = deferred()
    scan.mockReturnValue(manual.promise)
    const request = app.value.extractFast()
    app.value.extractFast()
    expect(scan).toHaveBeenCalledTimes(2)
    expect(scan).toHaveBeenLastCalledWith('人物：新草稿', { style: 'auto' })
    manual.resolve({ summary: '手动包含草稿', assets: [] })
    await request
    await app.flush()
    expect(app.value.result.summary).toBe('手动包含草稿')
  })

  it('allows manual retry after failure without an automatic retry loop', async () => {
    const scan = vi
      .fn()
      .mockRejectedValueOnce(new Error('网络中断'))
      .mockResolvedValue({ summary: '重试成功', assets: [] })
    const app = mount({ onSuggestAssetsFast: scan })
    await app.flush()
    app.render({ onSuggestAssetsFast: (...args) => scan(...args), scopeFingerprint: 'new-draft' })
    await app.flush()
    expect(scan).toHaveBeenCalledOnce()
    expect(app.value.error).toBe('网络中断')
    await app.value.extractFast()
    await app.flush()
    expect(scan).toHaveBeenCalledTimes(2)
    expect(app.value.error).toBe('')
    expect(app.value.result.summary).toBe('重试成功')
  })

  it.each(['success', 'failure'])(
    'ignores an old request %s after saved content or assets change',
    async (outcome) => {
      const old = deferred()
      const scan = vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockResolvedValue({ summary: '新版范围', assets: [] })
      const app = mount({ onSuggestAssetsFast: scan })
      app.render({ autoScopeFingerprint: 'saved-two' })
      await app.flush()
      if (outcome === 'success') old.resolve({ summary: '旧范围', assets: [] })
      else old.reject(new Error('旧请求失败'))
      await app.flush()
      expect(scan).toHaveBeenCalledTimes(2)
      expect(app.value.result.summary).toBe('新版范围')
      expect(app.value.error).toBe('')
    },
  )

  it('clears a removed saved scope and ignores its late response', async () => {
    const response = deferred()
    const app = mount({ onSuggestAssetsFast: vi.fn().mockReturnValue(response.promise) })
    app.render({ autoSource: '', autoScopeFingerprint: '' })
    response.resolve({ summary: '已删除正文', assets: [] })
    await app.flush()
    expect(app.value.result).toBeNull()
    expect(app.value.status).toBe('idle')
    expect(app.props.onSuggestAssetsFast).toHaveBeenCalledOnce()
  })

  it('isolates requests when switching projects, even with the same saved fingerprint', async () => {
    const response = deferred()
    const scan = vi
      .fn()
      .mockReturnValueOnce(response.promise)
      .mockResolvedValue({ summary: '第二项目', assets: [] })
    const app = mount({ onSuggestAssetsFast: scan })
    app.render({ projectId: 'project-two' })
    await app.flush()
    response.resolve({ summary: '第一项目', assets: [] })
    await app.flush()
    expect(scan).toHaveBeenCalledTimes(2)
    expect(app.value.result.summary).toBe('第二项目')
  })

  it('does not reapply completed model results from repeated task polling', async () => {
    const completed = {
      id: 'model-one',
      status: 'completed',
      metadata: { textResult: { summary: '旧模型结果', assets: [] } },
    }
    const app = mount({ latestTask: completed })
    await app.flush()
    await app.value.extractFast()
    await app.flush()
    app.render({ latestTask: { ...completed } })
    expect(app.value.result.summary).toBe('已保存范围')
    app.render({ autoScopeFingerprint: 'saved-two', latestTask: { ...completed } })
    await app.flush()
    app.render({ latestTask: { ...completed } })
    expect(app.value.result.summary).toBe('已保存范围')
  })

  it('discards an in-flight fast result when an active model task arrives', async () => {
    const response = deferred()
    const app = mount({ onSuggestAssetsFast: vi.fn().mockReturnValue(response.promise) })
    const task = { id: 'model-one', status: 'running' }
    app.render({ latestTask: task, activeTask: task })
    response.resolve({ summary: '过时的快速提取', assets: [] })
    await app.flush()
    expect(app.value.status).toBe('suggesting')
    expect(app.value.result).toBeNull()
    const completed = {
      ...task,
      status: 'completed',
      metadata: { textResult: { summary: '模型结果', assets: [] } },
    }
    app.render({ latestTask: completed, activeTask: null })
    expect(app.value.result.summary).toBe('模型结果')
  })

  it('keeps manual fast results when a cancelled model task is polled afterward', async () => {
    const task = { id: 'model-one', status: 'running' }
    const app = mount({
      script: '手动提交的未保存草稿',
      latestTask: task,
      activeTask: task,
      onCancelTask: vi.fn().mockResolvedValue(undefined),
    })
    await app.value.extractFast()
    await app.flush()
    app.render({ latestTask: { ...task, status: 'cancelled' }, activeTask: null })
    await app.flush()
    expect(app.value.result.summary).toBe('已保存范围')
    expect(app.value.error).toBe('')
    expect(app.props.onSuggestAssetsFast).toHaveBeenCalledOnce()
    expect(app.props.onSuggestAssetsFast).toHaveBeenLastCalledWith('手动提交的未保存草稿', { style: 'auto' })
  })

  it('accepts the model result after switching to fast extraction fails to cancel its task', async () => {
    const task = { id: 'model-one', status: 'running' }
    const app = mount({
      latestTask: task,
      activeTask: task,
      onCancelTask: vi.fn().mockRejectedValue(new Error('取消失败，任务仍在运行')),
    })
    await app.value.extractFast()
    await app.flush()
    app.render({ latestTask: { ...task } })
    expect(app.value.error).toBe('取消失败，任务仍在运行')
    expect(app.props.onSuggestAssetsFast).not.toHaveBeenCalled()

    app.render({
      latestTask: {
        ...task,
        status: 'completed',
        metadata: { textResult: { summary: '仍在运行的模型已完成', assets: [] } },
      },
      activeTask: null,
    })
    expect(app.value.result.summary).toBe('仍在运行的模型已完成')
    expect(app.value.error).toBe('')
    expect(app.value.status).toBe('ready')
    expect(app.props.onSuggestAssetsFast).not.toHaveBeenCalled()
  })

  it('does not lose an automatic scan while waiting for a task cancellation', async () => {
    const scan = vi.fn().mockResolvedValue({ summary: '取消后扫描', assets: [] })
    const app = mount({ stoppingTaskId: 'task-one', onSuggestAssetsFast: scan })
    expect(scan).not.toHaveBeenCalled()
    app.render({ stoppingTaskId: null })
    await app.flush()
    expect(scan).toHaveBeenCalledOnce()
    expect(app.value.result.summary).toBe('取消后扫描')
  })

  it('invalidates an unfinished scan on unmount', async () => {
    const response = deferred()
    const app = mount({ onSuggestAssetsFast: vi.fn().mockReturnValue(response.promise) })
    app.unmount()
    hooks.dirty = false
    response.resolve({ summary: '卸载后的结果', assets: [] })
    await Promise.resolve()
    await Promise.resolve()
    expect(hooks.dirty).toBe(false)
  })

  it('leaves a failed asset import retryable and only marks successful imports as created', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('临时保存失败')).mockResolvedValueOnce(undefined)
    const app = mount({ onImportAssets: write })
    await app.flush()
    const selected = [{ kind: 'scene', name: '档案室', prompt: '档案室内景' }]
    expect(await app.value.importSelected(selected)).toBe(false)
    app.render()
    expect(app.value.error).toBe('临时保存失败')
    expect(app.value.createdKeys.size).toBe(0)
    expect(await app.value.importSelected(selected)).toBe(true)
    app.render()
    expect(app.value.error).toBe('')
    expect(app.value.createdKeys.size).toBe(1)
    expect(write).toHaveBeenCalledTimes(2)
  })
})
