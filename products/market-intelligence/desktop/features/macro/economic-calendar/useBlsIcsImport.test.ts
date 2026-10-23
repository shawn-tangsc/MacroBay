// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MacroEconomicCalendarClient } from '../../../shared/ipc/macroEconomicCalendarClient'
import { useBlsIcsImport } from './useBlsIcsImport'

let root: Root | undefined
let restorePlatform: (() => void) | undefined

globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  restorePlatform?.()
  restorePlatform = undefined
  document.body.replaceChildren()
})

describe('useBlsIcsImport', () => {
  it('does nothing when the existing file picker is cancelled', async () => {
    const bridge = installFileBridge({ selectedPaths: [] })
    const client = importClient()
    const page = await renderHook(client)

    await click(page.container, 'select')

    expect(bridge.readTextFile).not.toHaveBeenCalled()
    expect(client.previewManualBlsIcs).not.toHaveBeenCalled()
    expect(page.state()).toEqual({ phase: 'closed', pending: 'false' })
  })

  it.each([
    ['rejects a non-ICS filename before reading it', '/private/calendar.txt', undefined, false, undefined],
    ['redacts a text-file bridge failure', '/private/bls.ics', new Error('read /private/bls.ics https://secret.example.test/?credential=hidden'), false, 'bls.ics'],
    ['rejects a truncated text-file bridge result', '/private/bls.ics', undefined, true, 'bls.ics']
  ])('%s', async (_name, selectedPath, readError, truncated, filename) => {
    const bridge = installFileBridge({ selectedPaths: [selectedPath], readError, truncated })
    const client = importClient()
    const page = await renderHook(client)

    await click(page.container, 'select')

    expect(client.previewManualBlsIcs).not.toHaveBeenCalled()
    expect(page.state()).toEqual({ phase: 'failed', pending: 'false', ...(filename ? { filename } : {}), failure: 'invalid-file' })
    expect(page.container.textContent).not.toMatch(/private|secret|credential|BEGIN:VCALENDAR/i)
    if (readError) expect(bridge.readTextFile).toHaveBeenCalledWith(selectedPath)
  })

  it('clears the raw body after a failed preview', async () => {
    installFileBridge({ selectedPaths: ['/private/bls.ics'] })
    const client = importClient({ preview: async () => ({ state: 'failed', failureCode: 'unsupported-calendar' }) })
    const page = await renderHook(client)

    await click(page.container, 'select')

    expect(client.previewManualBlsIcs).toHaveBeenCalledWith({ body: rawBody, truncated: false })
    expect(page.state()).toEqual({ phase: 'failed', pending: 'false', filename: 'bls.ics', failure: 'unsupported-calendar' })
  })

  it('keeps only a filename during preview, then clears the body and refreshes after import', async () => {
    installFileBridge({ selectedPaths: ['/private/bls.ics'] })
    const onImported = vi.fn(async () => undefined)
    const client = importClient()
    const page = await renderHook(client, onImported)

    await click(page.container, 'select')

    expect(page.state()).toEqual({ phase: 'ready', pending: 'true', filename: 'bls.ics' })
    expect(page.container.textContent).not.toMatch(/private|BEGIN:VCALENDAR|secret/i)
    await click(page.container, 'confirm')

    expect(client.importManualBlsIcs).toHaveBeenCalledWith({ body: rawBody, truncated: false })
    expect(onImported).toHaveBeenCalledTimes(1)
    expect(page.state()).toEqual({ phase: 'result', pending: 'false', filename: 'bls.ics', result: 'imported' })
  })

  it('clears the raw body without refreshing when import reports unchanged', async () => {
    installFileBridge({ selectedPaths: ['/private/bls.ics'] })
    const onImported = vi.fn(async () => undefined)
    const client = importClient({ imported: async () => unchanged() })
    const page = await renderHook(client, onImported)

    await click(page.container, 'select')
    await click(page.container, 'confirm')

    expect(onImported).not.toHaveBeenCalled()
    expect(page.state()).toEqual({ phase: 'result', pending: 'false', filename: 'bls.ics', result: 'unchanged' })
  })

  it('clears the raw body when the user closes a valid preview', async () => {
    installFileBridge({ selectedPaths: ['/private/bls.ics'] })
    const client = importClient()
    const page = await renderHook(client)

    await click(page.container, 'select')
    await click(page.container, 'close')
    await click(page.container, 'confirm')

    expect(client.importManualBlsIcs).not.toHaveBeenCalled()
    expect(page.state()).toEqual({ phase: 'closed', pending: 'false' })
  })
})

const rawBody = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:secret\nEND:VEVENT\nEND:VCALENDAR'

async function renderHook(client: Pick<MacroEconomicCalendarClient, 'previewManualBlsIcs' | 'importManualBlsIcs'>, onImported?: () => Promise<void>) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(createElement(Harness, { client, onImported })))
  return {
    container,
    state: () => ({
      phase: container.querySelector('output')?.getAttribute('data-phase'),
      pending: container.querySelector('output')?.getAttribute('data-pending'),
      ...(container.querySelector('output')?.getAttribute('data-filename') ? { filename: container.querySelector('output')?.getAttribute('data-filename') } : {}),
      ...(container.querySelector('output')?.getAttribute('data-failure') ? { failure: container.querySelector('output')?.getAttribute('data-failure') } : {}),
      ...(container.querySelector('output')?.getAttribute('data-result') ? { result: container.querySelector('output')?.getAttribute('data-result') } : {})
    })
  }
}

function Harness({ client, onImported }: { client: Pick<MacroEconomicCalendarClient, 'previewManualBlsIcs' | 'importManualBlsIcs'>; onImported?: () => Promise<void> }) {
  const flow = useBlsIcsImport({ client, onImported })
  const state = flow.dialogState
  return createElement('div', undefined,
    createElement('button', { onClick: () => void flow.selectFile(), type: 'button' }, 'select'),
    createElement('button', { onClick: () => void flow.confirmImport(), type: 'button' }, 'confirm'),
    createElement('button', { onClick: flow.closeDialog, type: 'button' }, 'close'),
    createElement('output', {
      'data-failure': state.state === 'failed' ? state.failureCode : undefined,
      'data-filename': 'filename' in state ? state.filename : undefined,
      'data-pending': String(flow.hasPendingBody),
      'data-phase': state.state === 'closed' ? 'closed' : state.state === 'failed' ? 'failed' : state.state === 'result' ? 'result' : state.state,
      'data-result': state.state === 'result' ? state.result.state : undefined
    })
  )
}

async function click(container: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === label)?.click()
    await flush()
  })
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function installFileBridge(input: { selectedPaths: string[]; readError?: Error; truncated?: boolean }) {
  const selectFiles = vi.fn(async () => input.selectedPaths)
  const readTextFile = vi.fn(async (path: string) => {
    if (input.readError) throw input.readError
    return { path, text: rawBody, truncated: input.truncated ?? false }
  })
  const original = Object.getOwnPropertyDescriptor(window, 'platform')
  Object.defineProperty(window, 'platform', { configurable: true, value: { app: { selectFiles, readTextFile } } })
  restorePlatform = () => {
    if (original) Object.defineProperty(window, 'platform', original)
    else Reflect.deleteProperty(window, 'platform')
  }
  return { selectFiles, readTextFile }
}

function importClient(input: {
  preview?: () => Promise<ReturnType<typeof readyPreview> | { state: 'failed'; failureCode: 'unsupported-calendar' }>
  imported?: () => Promise<ReturnType<typeof imported> | ReturnType<typeof unchanged>>
} = {}) {
  return {
    previewManualBlsIcs: vi.fn(input.preview ?? (async () => readyPreview())),
    importManualBlsIcs: vi.fn(input.imported ?? (async () => imported()))
  }
}

function readyPreview() {
  return { state: 'ready' as const, totalEvents: 313, supportedReleaseGroups: 46, generatedEvents: 115, unsupportedEvents: 198, insertedCount: 100, rescheduledCount: 10, unchangedCount: 5 }
}

function imported() {
  return { ...readyPreview(), state: 'imported' as const }
}

function unchanged() {
  return { state: 'unchanged' as const, totalEvents: 313, supportedReleaseGroups: 46, generatedEvents: 115, unsupportedEvents: 198, unchangedCount: 115 }
}
