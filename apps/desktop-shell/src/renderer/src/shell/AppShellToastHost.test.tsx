// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { AppShell } from './AppShell'
import { installPlatform } from './model-service/modelServicePageHarness'

let root: Root | undefined

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

  it('wraps the workspace window root through the extracted layer, not inline', () => {
    // 主窗与每个分离窗都经 AppShell → WorkspaceWindowRoot（role:'panel' 时渲染分离面），
    // 所以宿主挂在 WorkspaceWindowRoot **外面**，两类窗口各得一处。
    // 这一层已抽到 `window/AppShellToastLayer.tsx`（AppShell 超体积基线，抽离时行为不变）：
    // 断言改成「AppShell 用那层包住 WorkspaceWindowRoot」+「那层里才是宿主」。
    const shell = readFileSync(resolve(__dirname, './AppShell.tsx'), 'utf8')
    const layer = readFileSync(resolve(__dirname, './window/AppShellToastLayer.tsx'), 'utf8')

    const layerIndex = shell.indexOf('<AppShellToastLayer')
    const workspaceRootIndex = shell.indexOf('<WorkspaceWindowRoot')
    expect(layerIndex).toBeGreaterThan(-1)
    expect(workspaceRootIndex).toBeGreaterThan(layerIndex)

    expect(layer).toContain("from '@platform/ui/components/toast/ToastHost'")
    expect(layer).toContain('<ToastHost>')
    expect(layer).toContain('{props.children}')
  })
})
