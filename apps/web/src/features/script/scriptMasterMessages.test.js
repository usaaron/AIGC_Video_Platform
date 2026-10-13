import { describe, expect, it, vi } from 'vitest'
import { subscribeScriptMasterMessages } from './scriptMasterMessages'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function setup(projectId = 'project-1', surface = 'embedded') {
  const hostWindow = new EventTarget()
  hostWindow.location = { origin: 'https://studio.example' }
  const source = {}
  const callbacks = {
    getFrameWindow: vi.fn(() => source),
    onReady: vi.fn(),
    onSynced: vi.fn(),
    onNavigate: vi.fn(),
    onError: vi.fn(),
  }
  const cleanup = subscribeScriptMasterMessages({ hostWindow, projectId, surface, ...callbacks })
  function send(data, overrides = {}) {
    const event = new Event('message')
    Object.assign(event, {
      origin: hostWindow.location.origin,
      source,
      data: {
        projectId: projectId ?? null,
        ...(Object.prototype.hasOwnProperty.call(data, 'surface') ? {} : { surface }),
        ...data,
      },
      ...overrides,
    })
    hostWindow.dispatchEvent(event)
  }
  return { ...callbacks, cleanup, send, hostWindow }
}

describe('script master host messages', () => {
  it.each(['assets', 'storyboard'])(
    'opens %s only after the synced screenplay has refreshed',
    async (view) => {
      const app = setup()
      const refresh = deferred()
      app.onSynced.mockReturnValue(refresh.promise)
      app.send({ type: 'seqora:script-master:synced', view })
      expect(app.onSynced).toHaveBeenCalledOnce()
      expect(app.onNavigate).not.toHaveBeenCalled()
      refresh.resolve()
      await refresh.promise
      expect(app.onNavigate).toHaveBeenCalledExactlyOnceWith(view)
      expect(app.onError).not.toHaveBeenCalled()
      app.cleanup()
    },
  )

  it('keeps the current page and reports a failed refresh without replaying the import', async () => {
    const app = setup()
    app.onSynced.mockRejectedValue(new Error('offline'))
    app.send({ type: 'seqora:script-master:synced', view: 'assets' })
    await Promise.resolve()
    expect(app.onSynced).toHaveBeenCalledOnce()
    expect(app.onNavigate).not.toHaveBeenCalled()
    expect(app.onError).toHaveBeenCalledExactlyOnceWith('内容已同步，但制作稿暂未刷新；请重新打开制作稿。')
    app.cleanup()
  })

  it('does not navigate or report an old error after leaving the project', async () => {
    for (const success of [true, false]) {
      const app = setup()
      const refresh = deferred()
      app.onSynced.mockReturnValue(refresh.promise)
      app.send({ type: 'seqora:script-master:synced', view: 'assets' })
      app.cleanup()
      if (success) refresh.resolve()
      else refresh.reject(new Error('offline'))
      await Promise.resolve()
      expect(app.onNavigate).not.toHaveBeenCalled()
      expect(app.onError).not.toHaveBeenCalled()
    }
  })

  it('ignores completion from an iframe replaced during refresh', async () => {
    const app = setup()
    const refresh = deferred()
    app.onSynced.mockReturnValue(refresh.promise)
    app.send({ type: 'seqora:script-master:synced', view: 'assets' })
    app.getFrameWindow.mockReturnValue({})
    refresh.resolve()
    await refresh.promise
    expect(app.onNavigate).not.toHaveBeenCalled()
    app.cleanup()
  })

  it('keeps ordinary sync receipts on the current page', async () => {
    const app = setup()
    for (const view of [undefined, 'script', 'admin']) {
      app.send({ type: 'seqora:script-master:synced', view })
      await Promise.resolve()
    }
    expect(app.onSynced).toHaveBeenCalledTimes(3)
    expect(app.onNavigate).not.toHaveBeenCalled()
    app.cleanup()
  })

  it('rejects messages from another origin, iframe, or project', async () => {
    const app = setup()
    for (const type of ['ready', 'synced', 'navigate']) {
      const data = { type: `seqora:script-master:${type}`, view: 'assets' }
      app.send(data, { origin: 'https://other.example' })
      app.send(data, { source: {} })
      app.send({ ...data, projectId: 'project-2' })
    }
    await Promise.resolve()
    expect(app.onReady).not.toHaveBeenCalled()
    expect(app.onSynced).not.toHaveBeenCalled()
    expect(app.onNavigate).not.toHaveBeenCalled()
    expect(app.onError).not.toHaveBeenCalled()
    app.cleanup()
  })

  it('keeps embedded and standalone message channels separate', () => {
    const app = setup(null, 'standalone')
    app.send({ type: 'seqora:script-master:ready', surface: 'embedded' })
    expect(app.onReady).not.toHaveBeenCalled()
    app.send({ type: 'seqora:script-master:ready', surface: 'standalone' })
    expect(app.onReady).toHaveBeenCalledOnce()
    app.cleanup()
  })

  it('rejects an untagged message instead of guessing the host surface', async () => {
    const app = setup()
    app.send({ type: 'seqora:script-master:ready', surface: undefined })
    app.send({ type: 'seqora:script-master:synced', surface: undefined, view: 'assets' })
    app.send({ type: 'seqora:script-master:navigate', surface: undefined, view: 'assets' })
    await Promise.resolve()
    expect(app.onReady).not.toHaveBeenCalled()
    expect(app.onSynced).not.toHaveBeenCalled()
    expect(app.onNavigate).not.toHaveBeenCalled()
    app.cleanup()
  })

  it('never lets standalone messages refresh or navigate a host project', async () => {
    const app = setup(null, 'standalone')
    for (const type of ['synced', 'navigate']) {
      for (const surface of [undefined, 'standalone', 'embedded']) {
        app.send({ type: `seqora:script-master:${type}`, surface, view: 'assets' })
      }
    }
    await Promise.resolve()
    expect(app.onSynced).not.toHaveBeenCalled()
    expect(app.onNavigate).not.toHaveBeenCalled()
    expect(app.onError).not.toHaveBeenCalled()
    app.cleanup()
  })

  it('preserves explicit navigation to supported production pages', () => {
    const app = setup()
    for (const view of ['script', 'assets', 'storyboard', 'admin']) {
      app.send({ type: 'seqora:script-master:navigate', view })
    }
    expect(app.onNavigate.mock.calls).toEqual([['script'], ['assets'], ['storyboard']])
    app.cleanup()
  })

  it('accepts ready without a bound project and stops listening when closed', () => {
    const app = setup(null)
    app.send({ type: 'seqora:script-master:ready', projectId: 'project-1' })
    expect(app.onReady).not.toHaveBeenCalled()
    app.send({ type: 'seqora:script-master:ready' })
    expect(app.onReady).toHaveBeenCalledOnce()
    app.cleanup()
    app.send({ type: 'seqora:script-master:ready' })
    expect(app.onReady).toHaveBeenCalledOnce()
  })
})
