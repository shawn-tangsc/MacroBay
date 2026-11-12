// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { MacroIndicatorDrawer } from './MacroIndicatorDrawer'

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  document.body.innerHTML = ''
})

function Harness({ onOpened }: Readonly<{ onOpened: () => void }>): React.ReactElement {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" onClick={() => { setOpen(true); onOpened() }}>open</button>
    {open ? <MacroIndicatorDrawer locale="zh-CN" onClose={() => setOpen(false)} /> : null}
  </>
}

describe('key-indicator drawer', () => {
  it('mounts on body when opened and closes on Escape', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    let opened = 0
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><Harness onOpened={() => { opened += 1 }} /></ShellLanguageProvider>)
    })
    const trigger = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'open')!
    await act(async () => { trigger.click() })
    expect(opened).toBe(1)
    // The drawer is portalled to body: a drawer rendered inside the rail gets clipped by it, and
    // that looks exactly like "the button does nothing".
    const drawer = document.body.querySelector('.mi-analysis-drawer[data-placement="right"]')
    expect(drawer).not.toBeNull()
    expect(drawer!.querySelector('.mk-sec')).not.toBeNull()
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.body.querySelector('.mi-analysis-drawer[data-placement="right"]')).toBeNull()
  })

  it('really turns the mini calendar page, disables 回到本月 on the current month, and shows a refresh state', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} /></ShellLanguageProvider>)
    })
    const byName = (name: string) => document.body.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement
    const title = () => document.body.querySelector('.mk-minical__h h3')!.textContent
    expect(title()).toContain('2026 年 11 月')
    expect(byName('回到本月').disabled).toBe(true)
    await act(async () => { byName('上一个月').click() })
    expect(title()).toContain('2026 年 10 月')
    expect(byName('回到本月').disabled).toBe(false)
    await act(async () => { byName('回到本月').click() })
    expect(title()).toContain('2026 年 11 月')
    await act(async () => { byName('刷新市场日历').click() })
    expect(document.body.querySelector('.mk-minical__busy')).not.toBeNull()
  })
})
