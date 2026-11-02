// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { productText } from '../../shared/i18n/productText'
import { IntelligenceRightColumn } from './IntelligenceRightColumn'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const text = productText['zh-CN'].pages.intelligence.portal.calendarCard

/** A stand-in agent that keeps internal state, so unmounting it would be visible. */
function StatefulAgent(): React.ReactElement {
  const [count, setCount] = useState(0)
  return <button data-agent-counter onClick={() => setCount(count + 1)} type="button">{count}</button>
}

async function render(initialView: 'card' | 'agent' = 'card') {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const click = async (selector: string) => act(async () => host.querySelector<HTMLButtonElement>(selector)!.click())
  await act(async () => root.render(<IntelligenceRightColumn card={<p data-card>卡片</p>} text={text} initialView={initialView}><StatefulAgent /></IntelligenceRightColumn>))
  return { host, click }
}

it('shows the card by default and switches to the agent', async () => {
  const { host, click } = await render()
  expect(host.querySelector('[data-right-column-view]')?.getAttribute('data-right-column-view')).toBe('card')
  expect(host.querySelector('[data-card]')?.closest('div[hidden]')).toBeNull()
  await click('.mi-right-column__switch')
  expect(host.querySelector('[data-right-column-view]')?.getAttribute('data-right-column-view')).toBe('agent')
  expect(host.querySelector('[data-card]')?.closest('div[hidden]')).not.toBeNull()
})

it('collapses the agent to a rail and expands it without losing its state', async () => {
  const { host, click } = await render('agent')
  await click('[data-agent-counter]')
  await click('[data-agent-counter]')
  expect(host.querySelector('[data-agent-counter]')?.textContent).toBe('2')
  await click('.mi-right-column__collapse')
  expect(host.querySelector('[data-right-column-view]')?.getAttribute('data-right-column-view')).toBe('agent-collapsed')
  expect(host.querySelector('.mi-right-column__collapse')?.getAttribute('aria-expanded')).toBe('false')
  expect(host.querySelector('.mi-right-column__rail')).not.toBeNull()
  // Expanding restores the same subtree: the counter is still 2, so it was never remounted.
  await click('.mi-right-column__rail')
  expect(host.querySelector('[data-agent-counter]')?.textContent).toBe('2')
  expect(host.querySelector('.mi-right-column__rail')).toBeNull()
})

it('keeps the agent state across a trip to the card and back', async () => {
  const { host, click } = await render('agent')
  await click('[data-agent-counter]')
  await click('.mi-right-column__switch')
  await click('.mi-right-column__switch')
  expect(host.querySelector('[data-agent-counter]')?.textContent).toBe('1')
})
