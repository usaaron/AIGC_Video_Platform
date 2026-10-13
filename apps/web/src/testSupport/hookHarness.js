// Minimal effect runner for lifecycle tests in the DOM-free web unit suite.
// Timers and asynchronous state updates stay explicit so tests can count work
// before flushing renders, rather than hiding repeated updates in batching.
export const hookState = { slots: [], cursor: 0, effects: [], dirty: false, stateUpdates: 0 }

const changed = (previous, next) =>
  !previous || !next || next.some((value, index) => !Object.is(value, previous[index]))

export const mockReactHooks = {
  useState(initial) {
    const index = hookState.cursor++
    hookState.slots[index] ||= { value: typeof initial === 'function' ? initial() : initial }
    return [
      hookState.slots[index].value,
      (update) => {
        const current = hookState.slots[index].value
        const next = typeof update === 'function' ? update(current) : update
        if (!Object.is(current, next)) {
          hookState.dirty = true
          hookState.stateUpdates += 1
          hookState.slots[index].value = next
        }
      },
    ]
  },
  useRef(initial) {
    const index = hookState.cursor++
    hookState.slots[index] ||= { current: initial }
    return hookState.slots[index]
  },
  useEffect(effect, dependencies) {
    const index = hookState.cursor++
    const previous = hookState.slots[index]
    if (!changed(previous?.dependencies, dependencies)) return
    const slot = { dependencies, cleanup: previous?.cleanup }
    hookState.slots[index] = slot
    hookState.effects.push(() => {
      slot.cleanup?.()
      slot.cleanup = effect()
    })
  },
}

export function resetHookHarness() {
  hookState.slots.forEach((slot) => slot.cleanup?.())
  Object.assign(hookState, { slots: [], cursor: 0, effects: [], dirty: false, stateUpdates: 0 })
}

export function mountHook(hook, initialProps) {
  let props = initialProps
  let value
  const render = (update = {}) => {
    props = { ...props, ...update }
    let attempts = 0
    do {
      if (++attempts > 30) throw new Error('Hook did not settle')
      hookState.cursor = 0
      hookState.dirty = false
      value = hook(props)
      hookState.effects.splice(0).forEach((effect) => effect())
    } while (hookState.dirty)
    return value
  }
  render()
  return {
    render,
    get value() {
      return value
    },
    unmount() {
      hookState.slots.forEach((slot) => slot.cleanup?.())
    },
  }
}
