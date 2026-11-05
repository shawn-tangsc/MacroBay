// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '@platform/ui/components/confirm'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import type { BriefingPeriod } from '../../../contracts/dailyBriefingPeriod'
import { productText } from '../../shared/i18n/productText'
import type { DailyBriefingPeriodClient } from '../../shared/ipc/dailyBriefingPeriodClient'
import { BriefingPeriodsPanel } from './BriefingPeriodsPanel'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const copy = text.settings.periods

const period: BriefingPeriod = { id: 'period-a', generationTime: '08:00', windowHours: 24, language: 'zh-CN' }

type PanelClient = Pick<DailyBriefingPeriodClient, 'list' | 'create' | 'update' | 'remove'>

const fakeClient = (overrides: Partial<Record<keyof PanelClient, unknown>> = {}): PanelClient => ({
  list: vi.fn(async () => [period]),
  create: vi.fn(async () => ({ state: 'saved' as const, periods: [period] })),
  update: vi.fn(async () => ({ state: 'saved' as const, periods: [period] })),
  remove: vi.fn(async () => ({ state: 'removed' as const, id: period.id, periods: [] })),
  ...overrides
} as PanelClient)

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

const flush = async (): Promise<void> => {
  for (let round = 0; round < 4; round += 1) await act(async () => { await Promise.resolve() })
}

const render = async (client: PanelClient): Promise<void> => {
  await act(async () => {
    root.render(
      <ShellLanguageProvider language="zh-CN">
        <ConfirmProvider>
          <BriefingPeriodsPanel client={client} text={text} />
        </ConfirmProvider>
      </ShellLanguageProvider>
    )
  })
  await flush()
}

const buttonByLabel = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.getAttribute('aria-label') === label)

describe('the period list says which action failed', () => {
  it('says the period was not removed when the delete fails, not that it was not saved', async () => {
    // 用户报的那条：删排期失败，界面说「没存上」，读者会以为刚改的编辑没生效。
    const client = fakeClient({ remove: vi.fn(async () => { throw new Error('remove-failed') }) })
    await render(client)

    const trash = buttonByLabel(copy.deleteRow.replace('{index}', '1'))
    expect(trash).not.toBeUndefined()
    await act(async () => { trash?.click() })
    await flush()

    // 共用确认框：先点这一期自己的「删除」。
    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.replace(/\s/g, '') === copy.deleteConfirm)
    expect(confirmButton).not.toBeUndefined()
    await act(async () => { confirmButton?.click() })
    await flush()

    expect(client.remove).toHaveBeenCalledWith(period.id, 'zh-CN')
    const alerts = [...host.querySelectorAll<HTMLElement>('[role="alert"]')].map((node) => node.textContent)
    expect(alerts).toContain(copy.removeFailed)
    expect(alerts).not.toContain(copy.saveFailed)
    // 删失败不动列表：那一期还在眼前，读者能再试一次，而不是面对一个空列表。
    expect(host.querySelector<HTMLElement>('[data-period-id="period-a"]')).not.toBeNull()
  })

  it('still says 「没存上」 when saving is what failed', async () => {
    // 反向：保存失败那一句不能被删除那一句顶掉，否则同一处文案两个意思、两个出口。
    const client = fakeClient({ update: vi.fn(async () => ({ state: 'rejected' as const })) })
    await render(client)

    const pencil = buttonByLabel(copy.editRow.replace('{index}', '1'))
    expect(pencil).not.toBeUndefined()
    await act(async () => { pencil?.click() })
    await flush()
    const saveButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      // antd 给两个汉字的按钮中间加空格（「保 存」），所以按去空白后的字面比。
      .find((button) => button.textContent?.replace(/\s/g, '') === text.periodDialog.save)
    expect(saveButton).not.toBeUndefined()
    await act(async () => { saveButton?.click() })
    await flush()

    const alerts = [...host.querySelectorAll<HTMLElement>('[role="alert"]')].map((node) => node.textContent)
    expect(alerts).toContain(copy.saveFailed)
    expect(alerts).not.toContain(copy.removeFailed)
  })

  it('labels the reload button with what it does, and it re-reads the list', async () => {
    // 审计 #27：读失败那颗按钮写着「添加一期」，点下去执行的却是重新读取。
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('list-failed'))
      .mockResolvedValueOnce([period])
    const client = fakeClient({ list })
    await render(client)

    expect(host.textContent).toContain(copy.loadFailed)
    const retry = host.querySelector<HTMLButtonElement>('[data-briefing-periods-retry-load="true"]')
    expect(retry).not.toBeUndefined()
    expect(retry?.textContent).toBe(copy.retryLoad)
    expect(host.textContent).not.toContain(copy.add)

    await act(async () => { retry?.click() })
    await flush()
    expect(list).toHaveBeenCalledTimes(2)
    // 读回来之后显示的是那一期，而不是"再加一期"的空态。
    expect(host.querySelector<HTMLElement>('[data-period-id="period-a"]')).not.toBeNull()
  })
})
