// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { AppShell } from './AppShell'
import { installPlatform } from './model-service/modelServicePageHarness'

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')
})

describe('toast host mounting', () => {
  it('mounts the host inside the shell render root, so useToast has a provider', async () => {
    installPlatform()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(AppShell))
      await Promise.resolve()
    })

    // 宿主自己在页面内容之外渲染一个 role=region 的提示区；它出现即证明主窗根里有 ToastHost。
    const region = container.querySelector('.toast-region')
    expect(region).not.toBeNull()
    expect(region?.getAttribute('role')).toBe('region')
  })

  it('wraps the workspace window root, which is the single entry for main and detached windows', () => {
    // 主窗与每个分离窗都经 AppShell → WorkspaceWindowRoot（role:'panel' 时渲染分离面），
    // 所以宿主挂在 WorkspaceWindowRoot **外面**，两类窗口各得一处，且都在页面之上。
    const source = readFileSync(resolve(__dirname, './AppShell.tsx'), 'utf8')
    const hostIndex = source.indexOf('<ToastHost>')
    const workspaceRootIndex = source.indexOf('<WorkspaceWindowRoot')
    expect(source.indexOf("import { ToastHost } from '@platform/ui/components/toast/ToastHost'")).toBeGreaterThan(-1)
    expect(hostIndex).toBeGreaterThan(-1)
    expect(workspaceRootIndex).toBeGreaterThan(hostIndex)
  })
})
