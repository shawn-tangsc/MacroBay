// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InUseModelRetiredItem } from '@platform/ai/providers/inUseModelPatrol'

import { platformText } from '../../i18n/platformText'
import { InUseModelRetiredBanner } from './InUseModelRetiredBanner'
import { useInUseModelPatrol } from './useInUseModelPatrol'

/**
 * 巡检本身住在主进程（`inUseModelPatrolRuntime` 有自己的用例）。这条用例只管界面这一侧：
 * 读主进程的结论、下线才出提示、按钮只负责跳转。
 */
const labels = platformText['en-US'].models

function retiredItem(modelName: string): InUseModelRetiredItem {
  return { providerId: 'silicon', modelId: modelName, modelName, reason: 'retired' }
}

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function installPlatform(items: () => Promise<InUseModelRetiredItem[]>): void {
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      modelProviders: {
        getInUseRetired: vi.fn(items)
      }
    }
  })
}

function Host({ onChangeModel }: { onChangeModel: () => void }): React.ReactElement {
  const retired = useInUseModelPatrol()
  return createElement(InUseModelRetiredBanner, { labels, items: retired, onChangeModel })
}

async function mount(onChangeModel = (): void => undefined): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(Host, { onChangeModel }))
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
  return container
}

describe('in-use model retired banner', () => {
  it('renders the retired models the main process reported', async () => {
    installPlatform(async () => [retiredItem('chat-a')])

    const container = await mount()

    const banner = container.querySelector('[data-in-use-model-retired]')
    expect(banner?.textContent).toContain(labels.inUseModelRetired('chat-a'))
  })

  it('offers a change-model action without switching anything by itself', async () => {
    const onChangeModel = vi.fn()
    installPlatform(async () => [retiredItem('chat-a')])

    const container = await mount(onChangeModel)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-in-use-model-retired-change]')?.click()
      await Promise.resolve()
    })

    expect(onChangeModel).toHaveBeenCalledTimes(1)
  })

  it('stays silent when nothing is retired', async () => {
    installPlatform(async () => [])

    const container = await mount()

    expect(container.querySelector('[data-in-use-model-retired]')).toBeNull()
  })

  it('never treats a thrown IPC error as "retired"', async () => {
    installPlatform(async () => {
      throw new Error('ipc failed')
    })

    const container = await mount()

    expect(container.querySelector('[data-in-use-model-retired]')).toBeNull()
  })
})
