// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BriefingPeriod } from '../../../contracts/dailyBriefingPeriod'
import { dailyBriefingGenerationGrid } from '../../../contracts/dailyBriefing'
import { productText } from '../../shared/i18n/productText'
import { BriefingPeriodDialog } from './BriefingPeriodDialog'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

const period = (overrides: Partial<BriefingPeriod> = {}): BriefingPeriod => ({
  id: 'period_a',
  generationTime: '07:00',
  windowHours: 24,
  language: 'zh-CN',
  ...overrides
})

let host: HTMLDivElement
let root: Root

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

const render = async (props: Partial<React.ComponentProps<typeof BriefingPeriodDialog>> = {}) => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const onSave = props.onSave ?? vi.fn()
  const onClose = props.onClose ?? vi.fn()
  await act(async () => {
    root.render(<BriefingPeriodDialog open text={text} periods={props.periods ?? []} {...(props.editing ? { editing: props.editing } : {})} onSave={onSave} onClose={onClose} />)
  })
  await act(async () => { await Promise.resolve() })
  return { onSave, onClose }
}

/** antd's Select is a combobox: open it, then click the option with that title. */
const pick = async (label: string, option: string): Promise<void> => {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  const selector = input.closest('.ant-select')!.querySelector<HTMLElement>('.ant-select-selector')!
  // antd opens on mousedown, not click.
  await act(async () => { selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await Promise.resolve() })
  const item = [...document.querySelectorAll<HTMLElement>('.ant-select-item-option')]
    .find((node) => node.textContent?.trim() === option)!
  expect(item, `option ${option} for ${label}`).not.toBeUndefined()
  await act(async () => { item.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

const saveButton = (): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.replace(/\s/g, '') === text.periodDialog.save)!

describe('briefing period dialog', () => {
  it('offers the three values and saves them as a draft', async () => {
    const { onSave } = await render()
    expect(document.body.textContent).toContain(text.periodDialog.generationTime)
    expect(document.body.textContent).toContain(text.periodDialog.windowHours)
    expect(document.body.textContent).toContain(text.periodDialog.language)

    await pick(text.periodDialog.generationTime, '09:00')
    await pick(text.periodDialog.windowHours, text.periodDialog.windowValue.replace('{hours}', '12'))
    await act(async () => { saveButton().click() })

    expect(onSave).toHaveBeenCalledWith({ generationTime: '09:00', windowHours: 12, language: 'zh-CN' })
  })

  it('states the grid the form actually offers, from the policy table rather than from prose', async () => {
    const { onSave } = await render()
    const hint = document.querySelector<HTMLElement>('[data-time-grid]')
    expect(hint, 'the form never names its grid').not.toBeNull()
    const grid = dailyBriefingGenerationGrid
    // Every number in the sentence is the table's: first, last, count and step.
    expect(hint!.textContent).toContain(grid.first)
    expect(hint!.textContent).toContain(grid.last)
    expect(hint!.textContent).toContain(String(grid.count))
    expect(hint!.textContent).toContain(String(grid.stepMinutes))
    // And the options really do cover the ends the sentence promises.
    await pick(text.periodDialog.generationTime, '00:00')
    await pick(text.periodDialog.generationTime, '23:30')
    await act(async () => { saveButton().click() })
    expect(onSave).toHaveBeenCalledWith({ generationTime: '23:30', windowHours: 24, language: 'zh-CN' })
  })

  it('names the row a duplicate collides with and disables Save before it is pressed', async () => {
    const { onSave } = await render({ periods: [period()] })
    // The default draft is exactly the saved row: 07:00 / 24h / Chinese.
    const conflict = document.querySelector<HTMLElement>('[data-period-conflict]')
    expect(conflict).not.toBeNull()
    expect(conflict?.textContent).toContain('07:00')
    expect(conflict?.textContent).toContain('24')
    expect(conflict?.textContent).toContain(text.history.languages['zh-CN'])
    expect(saveButton().disabled).toBe(true)

    // Changing one of the three frees it; the button is usable without a click-and-error cycle.
    await pick(text.periodDialog.generationTime, '08:00')
    expect(document.querySelector('[data-period-conflict]')).toBeNull()
    expect(saveButton().disabled).toBe(false)
    await act(async () => { saveButton().click() })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('edits a period from its own values, and saving it unchanged is not a collision', async () => {
    const { onSave } = await render({ periods: [period()], editing: period() })
    // The edited row is ignored by the uniqueness check: otherwise an untouched edit could not save.
    expect(document.querySelector('[data-period-conflict]')).toBeNull()
    expect(saveButton().disabled).toBe(false)
    await act(async () => { saveButton().click() })
    expect(onSave).toHaveBeenCalledWith({ generationTime: '07:00', windowHours: 24, language: 'zh-CN' })
  })
})
