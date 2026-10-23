// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../i18n/platformText'
import { WorkspaceWindowRoot, type WorkspaceWindowRootProps } from './WorkspaceWindowRoot'
import { ERROR_SHELL_LANGUAGE_REFRESH_MS } from './workspaceWindowSurfaces'

/**
 * Owner: apps/desktop-shell renderer / workspace（**PLAT-29** focused）。回归：本文件。
 *
 * 缺陷（真机 PLAT-10 ④ 已取证）：错误壳窗口以 `fallbackLanguage` 渲染 —— 那是 AppShell 在**窗口创建时**
 * 读一次的 `settings.get()` 快照；错误壳窗口没有面板/页面归属，收不到 PLAT-10/28/31 的受控 `snapshot`
 * 事件 ⇒ 主窗之后再切语言，错误壳仍停在旧语言（"无受控上下文 ⇒ 语言不跟随"）。
 *
 * 修复口径（**零新增通道/preload 方法**）：错误壳的语言改走**既有** `window.platform.settings.get()`
 * 只读面 —— 它与 `getHostContext().preferences.language` 是**同一个** Main 设置来源
 * （`app.ts` 两处都取 `settingsStore.get().language`），因此复用「准备期壳」同一条语言投影，
 * 只是错误壳没有受控上下文可读，只能经这条同源只读面取。错误壳是终态、且没有可订阅的推送，
 * 所以用**有界重读**（单个定时器、无变化不写 state、离开错误态即停）来跟随后续切换。
 *
 * 本文件取证：中/英各一次、语言切换后跟随、有界性、白名单、读失败/无桥的降级。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const en = platformText['en-US'].workspace
const zh = platformText['zh-CN'].workspace
const FLUSH_TURNS = 12
const ERROR_TEXT_EN = en.windowHostUnavailableTitle
const ERROR_TEXT_ZH = zh.windowHostUnavailableTitle
const ERROR_DETAIL_EN = en.windowHostUnavailableContext
const ERROR_DETAIL_ZH = zh.windowHostUnavailableContext

let root: Root | undefined
let container: HTMLDivElement | undefined

type SettingsReadMode = 'ok' | 'reject' | 'missing'
type FakeErrorWindow = {
  language: unknown
  mode: SettingsReadMode
  getCalls: number
}

function installErrorWindow(options: { language: unknown; mode?: SettingsReadMode }): FakeErrorWindow {
  const fake: FakeErrorWindow = { language: options.language, mode: options.mode ?? 'ok', getCalls: 0 }
  const workspace = {
    // 错误壳窗口 = 不在 workspace 归属图里：唯一一次受控读取就被拒（真机「未登记窗口」同形）
    getHostContext: async () => ({ status: 'rejected', errorCode: 'not-owner' }),
    getSnapshot: async () => ({ status: 'rejected', errorCode: 'not-owner' }),
    command: async () => ({ status: 'rejected', errorCode: 'not-owner' }),
    onEvent: () => () => undefined
  }
  const settings = {
    get: async () => {
      fake.getCalls += 1
      if (fake.mode === 'reject') throw new Error('settings unavailable')
      return { language: fake.language }
    }
  }
  Reflect.set(window, 'platform', fake.mode === 'missing' ? { workspace } : { workspace, settings })
  return fake
}

afterEach(async () => {
  if (root) {
    const current = root
    root = undefined
    await act(async () => { current.unmount() })
  }
  container = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < FLUSH_TURNS; turn += 1) await Promise.resolve()
  })
}

async function renderErrorShell(props: Partial<WorkspaceWindowRootProps> = {}): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const current = root
  await act(async () => {
    current.render(createElement(WorkspaceWindowRoot, props as WorkspaceWindowRootProps))
  })
  await settle()
  return container
}

const errorShell = (view: HTMLDivElement): HTMLElement | null =>
  view.querySelector<HTMLElement>('[data-window-shell="error"]')

/** 有界重读的一个周期（fake timer；生产常量只在这里被引用，绝不另抄一个时长字面量）。 */
async function advanceRefresh(times = 1): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ERROR_SHELL_LANGUAGE_REFRESH_MS * times)
  })
  await settle()
}

describe('PLAT-29 ①：错误壳语言来自既有 settings 只读面（与受控偏好同源），中/英各一次', () => {
  it('设置当前语言 zh-CN ⇒ 错误壳中文（即使 AppShell 传的 fallbackLanguage 已过期）', async () => {
    installErrorWindow({ language: 'zh-CN' })
    const view = await renderErrorShell({ fallbackLanguage: 'en-US' })

    expect(errorShell(view)).not.toBeNull()
    expect(errorShell(view)?.textContent).toContain(ERROR_TEXT_ZH)
    expect(errorShell(view)?.textContent).toContain(ERROR_DETAIL_ZH)
    expect(errorShell(view)?.textContent).not.toContain(ERROR_TEXT_EN)
    // 文案仍走既有 i18n 面（错误壳 DOM/class 不变）
    expect(errorShell(view)?.getAttribute('role')).toBe('alert')
  })

  it('设置当前语言 en-US ⇒ 错误壳英文（即使 AppShell 传的 fallbackLanguage 已过期）', async () => {
    installErrorWindow({ language: 'en-US' })
    const view = await renderErrorShell({ fallbackLanguage: 'zh-CN' })

    expect(errorShell(view)?.textContent).toContain(ERROR_TEXT_EN)
    expect(errorShell(view)?.textContent).toContain(ERROR_DETAIL_EN)
    expect(errorShell(view)?.textContent).not.toContain(ERROR_TEXT_ZH)
  })
})

describe('PLAT-29 ②：主窗切换语言后错误壳跟随（有界重读，不重开窗口）', () => {
  it('en-US → zh-CN → en-US：错误壳文案逐次跟随，DOM 不被替换', async () => {
    vi.useFakeTimers()
    const fake = installErrorWindow({ language: 'en-US' })
    const view = await renderErrorShell({ fallbackLanguage: 'en-US' })
    const firstNode = errorShell(view)
    expect(firstNode?.textContent).toContain(ERROR_TEXT_EN)

    fake.language = 'zh-CN'
    await advanceRefresh()
    expect(errorShell(view)?.textContent).toContain(ERROR_TEXT_ZH)
    expect(errorShell(view)?.textContent).not.toContain(ERROR_TEXT_EN)
    // 跟随绝不等于重开：同一个壳节点仍在原位
    expect(errorShell(view)).toBe(firstNode)

    fake.language = 'en-US'
    await advanceRefresh()
    expect(errorShell(view)?.textContent).toContain(ERROR_TEXT_EN)
    expect(errorShell(view)).toBe(firstNode)
  })

  it('切换一次 ⇒ 有界：挂载读一次 + 每个刷新周期至多一次；无变化不新增读取', async () => {
    vi.useFakeTimers()
    const fake = installErrorWindow({ language: 'en-US' })
    await renderErrorShell()
    const afterMount = fake.getCalls
    expect(afterMount).toBeGreaterThanOrEqual(1)
    expect(afterMount).toBeLessThanOrEqual(2)

    await advanceRefresh(3)
    // 语言没变：重读次数有界（每周期至多一次），绝不会自持放大
    expect(fake.getCalls - afterMount).toBeGreaterThanOrEqual(3)
    expect(fake.getCalls - afterMount).toBeLessThanOrEqual(4)

    const settledCalls = fake.getCalls
    await activeUnmount()
    await advanceRefresh(3)
    // 离开错误壳（卸载）后：定时器已清、绝不再读
    expect(fake.getCalls).toBe(settledCalls)
  })
})

/** 卸载但保留 fake（`afterEach` 里再卸载会重复；这里只清 root）。 */
async function activeUnmount(): Promise<void> {
  if (!root) return
  const current = root
  root = undefined
  await act(async () => { current.unmount() })
}

describe('PLAT-29 ③：白名单与降级（维持既有 fallbackLanguage 语义，绝不自造）', () => {
  it('设置里的语言在白名单外 ⇒ 维持 fallbackLanguage，绝不照抄未知语言', async () => {
    installErrorWindow({ language: 'de-DE' })
    const view = await renderErrorShell({ fallbackLanguage: 'zh-CN' })
    expect(errorShell(view)?.textContent).toContain(ERROR_TEXT_ZH)
    expect(errorShell(view)?.textContent).not.toContain('de-DE')
  })

  it('设置桥缺失（旧渲染环境）⇒ 保留既有 fallbackLanguage 行为，且不启动重读定时器', async () => {
    vi.useFakeTimers()
    const fake = installErrorWindow({ language: 'zh-CN', mode: 'missing' })
    const view = await renderErrorShell({ fallbackLanguage: 'zh-CN' })
    expect(errorShell(view)?.textContent).toContain(ERROR_TEXT_ZH)

    await advanceRefresh(3)
    // 没有设置只读面 ⇒ 零读取（绝不因为缺少来源而反复重试/轮询）
    expect(fake.getCalls).toBe(0)
  })

  it('设置读取失败 ⇒ 维持当前文案（一次失败绝不把错误壳换成空白/未知语言）', async () => {
    installErrorWindow({ language: 'zh-CN', mode: 'reject' })
    const view = await renderErrorShell({ fallbackLanguage: 'en-US' })
    expect(errorShell(view)?.textContent).toContain(ERROR_TEXT_EN)
    expect(errorShell(view)?.textContent).not.toBe('')
  })
})
