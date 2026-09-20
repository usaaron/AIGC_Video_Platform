import { isValidElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ slots: [], cursor: 0 }))
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal()),
  useState(initial) {
    const index = hooks.cursor++
    if (!(index in hooks.slots)) hooks.slots[index] = initial
    return [
      hooks.slots[index],
      (value) => {
        hooks.slots[index] = value
      },
    ]
  },
}))

import { NewProjectModal } from './AppShell'

function elements(element, all = []) {
  if (Array.isArray(element)) element.forEach((child) => elements(child, all))
  else if (isValidElement(element)) {
    all.push(element)
    elements(element.props.children, all)
  }
  return all
}

function render(onCreate) {
  hooks.cursor = 0
  return elements(NewProjectModal({ onCreate, onClose: vi.fn() }))
}

function createButton(tree) {
  return tree.find((item) => item.type === 'button' && item.props.className === 'button primary')
}

describe('new project creation', () => {
  beforeEach(() => {
    hooks.slots = []
  })

  it('starts a new series with the quick script supported 90 second duration', () => {
    const onCreate = vi.fn()
    createButton(render(onCreate)).props.onClick()
    expect(onCreate).toHaveBeenCalledWith({
      name: '未命名影片',
      contentType: 'short-drama',
      visualStyle: 'cinematic-cg',
      aspectRatio: '9:16',
      episodeDurationSeconds: 90,
    })
  })

  it.each(['advertisement', 'animation'])(
    'keeps %s at 30 seconds when the author selects it',
    (contentType) => {
      const onCreate = vi.fn()
      const tree = render(onCreate)
      tree.find((item) => item.type === 'button' && item.key === contentType).props.onClick()
      createButton(render(onCreate)).props.onClick()
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ contentType, episodeDurationSeconds: 30 }),
      )
    },
  )
})
