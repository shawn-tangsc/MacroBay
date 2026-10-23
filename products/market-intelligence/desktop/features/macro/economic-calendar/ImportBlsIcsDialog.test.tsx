// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { ImportBlsIcsDialog } from './ImportBlsIcsDialog'

let root: Root | undefined

globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('ImportBlsIcsDialog', () => {
  it('shows only the local filename and safe preview counts before explicit confirmation', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    await render({ state: 'ready', filename: 'bls.ics', preview: preview() }, { onConfirm, onClose })

    expect(document.body.textContent).toContain('bls.ics')
    expect(document.body.textContent).toContain(String(preview().supportedReleaseGroups))
    expect(document.body.textContent).not.toMatch(/private|BEGIN:VCALENDAR|https?:|evidenceHash|rawRecordId|credential/i)
    await click(productText['zh-CN'].pages.intelligence.portal.calendar.manualImport.actions.confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('remains closable through both the close control and keyboard while importing', async () => {
    const onClose = vi.fn()
    await render({ state: 'importing', filename: 'bls.ics', preview: preview() }, { onClose })

    await act(async () => document.body.querySelector<HTMLButtonElement>('.ant-modal-close')?.click())
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => document.body.querySelector('.ant-modal-wrap')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('renders compact localized failures and unchanged result without raw input', async () => {
    await render({ state: 'failed', filename: 'bls.ics', failureCode: 'invalid-file' })
    expect(document.body.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.manualImport.failures['invalid-file'])
    await unmount()
    await render({ state: 'result', filename: 'bls.ics', result: unchanged() })

    expect(document.body.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.manualImport.results.unchanged)
    expect(document.body.textContent).not.toMatch(/private|BEGIN:VCALENDAR|https?:|hash|raw/i)
  })

  it('uses English import labels when the calendar uses English copy', async () => {
    const text = productText['en-US'].pages.intelligence.portal.calendar
    await render({ state: 'ready', filename: 'bls.ics', preview: preview() }, {}, text)

    expect(document.body.textContent).toContain(text.manualImport.title)
    expect(document.body.textContent).toContain(text.manualImport.actions.confirm)
    expect(document.body.textContent).toContain(text.manualImport.counts.generatedEvents)
  })
})

async function render(
  state: Parameters<typeof ImportBlsIcsDialog>[0]['dialogState'],
  handlers: { onConfirm?: () => void; onClose?: () => void } = {},
  text = productText['zh-CN'].pages.intelligence.portal.calendar
) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(
    <ImportBlsIcsDialog
      dialogState={state}
      onClose={handlers.onClose ?? (() => undefined)}
      onConfirm={handlers.onConfirm ?? (() => undefined)}
      text={text}
    />
  ))
}

async function unmount(): Promise<void> {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
}

async function click(text: string): Promise<void> {
  await act(async () => Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes(text))?.click())
}

function preview() {
  return { state: 'ready' as const, totalEvents: 313, supportedReleaseGroups: 46, generatedEvents: 115, unsupportedEvents: 198, insertedCount: 100, rescheduledCount: 10, unchangedCount: 5 }
}

function unchanged() {
  return { state: 'unchanged' as const, totalEvents: 313, supportedReleaseGroups: 46, generatedEvents: 115, unsupportedEvents: 198, unchangedCount: 115 }
}
