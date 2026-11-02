// @vitest-environment happy-dom
import { ConfigProvider } from 'antd'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WINDOW_ANTD_BUTTON_CONFIG } from '@platform/ui/theme/windowAntdTheme'

import type { NewsSentimentSettingsView } from '../../../../service/intelligence/schema/newsSentiment'
import { productText } from '../../../shared/i18n/productText'
import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import { NewsSentimentSettingsModal } from './NewsSentimentSettingsModal'

const text = productText['zh-CN'].pages.intelligence.portal.newsSentiment

const SETTINGS: NewsSentimentSettingsView = {
  settings: { modelScoringEnabled: true, providerId: '', modelId: '', updatedAt: '2026-10-24T13:00:00.000Z' },
  resolution: { source: 'platform-fast', defaultModelState: 'ready', providerId: 'p', modelId: 'm' },
  defaultFastModel: { providerId: 'p', modelId: 'm', name: 'Provider · Fast' }
}

function client(overrides: Partial<NewsSentimentClient> = {}): NewsSentimentClient {
  return {
    query: vi.fn(),
    getItem: vi.fn(),
    getSettings: vi.fn(async () => SETTINGS),
    saveSettings: vi.fn(async () => SETTINGS),
    rescore: vi.fn(async () => ({ queued: true })),
    rebuild: vi.fn(async () => ({ queued: true })),
    translateBody: vi.fn(),
    ...overrides
  } as NewsSentimentClient
}

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

async function mount(props: { client?: NewsSentimentClient; onClose?: () => void } = {}): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    // 与 AppShell 同一个按钮配置：不关掉 antd 的汉字自动空格，按钮文案会和真机不一致。
    root?.render(
      <ConfigProvider button={WINDOW_ANTD_BUTTON_CONFIG}>
        <NewsSentimentSettingsModal
          client={props.client ?? client()}
          onClose={props.onClose ?? (() => undefined)}
          open
          showTranslation={false}
          text={text}
        />
      </ConfigProvider>
    )
  })
  await act(async () => {})
  return container
}

describe('NewsSentimentSettingsModal on the platform Modal', () => {
  it('takes its title from the product key, not a sentence passed by the call site', async () => {
    await mount()
    expect(document.querySelector('.ant-modal-title')?.textContent).toBe(text.settingsModal.title)
    expect(text.settingsModal.title).toBe('舆情设置')
  })

  it('rides above a drawer without the call site writing a z-index', async () => {
    await mount()
    expect(document.querySelector<HTMLElement>('.ant-modal-wrap')?.style.zIndex).toBe('1500')
  })

  it('renders the two actions through the footer slot and closes on cancel', async () => {
    const onClose = vi.fn()
    await mount({ onClose })

    const footer = document.querySelector('.ant-modal-footer')
    expect(footer?.textContent).toContain(text.settingsModal.cancel)
    expect(footer?.textContent).toContain(text.settingsModal.save)

    const cancel = [...document.querySelectorAll<HTMLButtonElement>('.ant-modal-footer button')].find(
      (button) => button.textContent === text.settingsModal.cancel
    )
    await act(async () => cancel!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('saves through the primary action and then closes', async () => {
    const saveSettings = vi.fn(async () => SETTINGS)
    const onClose = vi.fn()
    await mount({ client: client({ saveSettings }), onClose })

    const primary = document.querySelector<HTMLButtonElement>('.ant-modal-footer .ant-btn-primary')
    expect(primary?.textContent).toBe(text.settingsModal.save)
    await act(async () => primary!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
