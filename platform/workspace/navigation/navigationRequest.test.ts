// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { APP_NAVIGATE_EVENT, handoffFocusAfterNavigation, navigateTo } from './navigationRequest'

afterEach(() => {
  document.body.replaceChildren()
})

function listener(): ReturnType<typeof vi.fn> {
  const spy = vi.fn()
  window.addEventListener(APP_NAVIGATE_EVENT, spy as EventListener)
  return spy
}

describe('navigateTo', () => {
  it('sends a built-in page as a nav key', () => {
    const spy = listener()
    navigateTo({ page: 'agents' })
    expect((spy.mock.calls[0]![0] as CustomEvent).detail).toEqual({ navKey: 'agents' })
  })

  it('sends a settings destination with the panel key the registry knows', () => {
    const spy = listener()
    navigateTo({ page: 'settings', panel: 'market-intelligence.intelligence-sources' })
    expect((spy.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      navKey: 'settings',
      settingsPanelKey: 'market-intelligence.intelligence-sources'
    })
  })

  it('carries the assistant target when the caller knows which topic to open', () => {
    const spy = listener()
    navigateTo({ page: 'assistants', assistant: { assistantId: 'assistant-1', topicId: 'topic-9' } })
    expect((spy.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      navKey: 'assistants',
      assistant: { assistantId: 'assistant-1', topicId: 'topic-9' }
    })
  })

  it('is the only entry: it does not swallow failures and returns nothing', () => {
    expect(navigateTo({ page: 'assistants' })).toBeUndefined()
  })
})

describe('handoffFocusAfterNavigation', () => {
  it('prefers the element the call site marked, so the reader lands on the first action', () => {
    const container = document.createElement('main')
    container.innerHTML = '<h2>heading</h2><textarea data-nav-focus></textarea>'
    document.body.append(container)

    const target = handoffFocusAfterNavigation(container)
    expect(target).toBe(container.querySelector('[data-nav-focus]'))
    expect(document.activeElement).toBe(target)
  })

  it('falls back to the first heading, marked as a landing spot but not in the tab order', () => {
    const container = document.createElement('main')
    container.innerHTML = '<h2>heading</h2><p>body</p>'
    document.body.append(container)

    const target = handoffFocusAfterNavigation(container)
    expect(target).toBe(container.querySelector('h2'))
    expect((target as HTMLElement).tabIndex).toBe(-1)
    expect(document.activeElement).toBe(target)
  })

  it('lands on the container itself when the destination has no heading at all', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>a settings panel without a title</p>'
    document.body.append(container)

    const target = handoffFocusAfterNavigation(container)
    expect(target).toBe(container)
    expect(container.tabIndex).toBe(-1)
    expect(document.activeElement).toBe(container)
  })

  it('does nothing when there is no container, instead of throwing during navigation', () => {
    expect(handoffFocusAfterNavigation(null)).toBeNull()
  })
})
