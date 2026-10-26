import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Owner: platform/desktop/menu（**应用菜单只实现一次**）。
 *
 * 产品要求（本文件即是这条要求的护栏）：新增/删除菜单、实现菜单功能时，**除非有特殊情况**，
 * macOS 与 Windows 只写一份实现。落地方式：
 *  - 唯一定义点是 `appMenu.ts` 的 template → `Menu.setApplicationMenu`；
 *  - macOS 由 Electron 直接画成屏幕顶部的系统菜单；
 *  - Windows（主窗 `frame: false`，系统不再画菜单栏）由渲染层 `AppMenuBar` 读**顶层标签**、
 *    点开时让 Main 用同一个子菜单 `popup()` —— 渲染层没有第二份菜单表。
 *
 * 因此本文件断言：`setApplicationMenu`/`buildFromTemplate` 只出现在 `appMenu.ts`；
 * 渲染层的菜单条里不出现任何菜单文案或菜单构造（出现即意味着重复实现）。
 */

const ROOT = process.cwd()
const SOURCE_ROOTS = ['platform', 'apps/desktop-shell/src']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage'])

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) {
      collectSourceFiles(absolute, out)
      continue
    }
    if (!/\.(ts|tsx)$/.test(name)) continue
    // 断言文件自己会包含这些字面量，不参与扫描
    if (/\.(test|spec)\.tsx?$/.test(name)) continue
    out.push(relative(ROOT, absolute).replace(/\\/g, '/'))
  }
  return out
}

const sources = SOURCE_ROOTS.flatMap((root) => collectSourceFiles(resolve(ROOT, root)))
const read = (file: string): string => readFileSync(resolve(ROOT, file), 'utf8')

describe('应用菜单只有一处定义（mac / Windows 不重复实现）', () => {
  it('setApplicationMenu 只出现在 menu/appMenu.ts（托盘菜单是另一份，不属于应用菜单）', () => {
    const owners = sources.filter((file) => /Menu\.setApplicationMenu\(/.test(read(file)))
    expect(owners).toEqual(['platform/desktop/menu/appMenu.ts'])
    // 唯一的应用菜单模板确实由 buildFromTemplate 构造
    expect(read('platform/desktop/menu/appMenu.ts')).toContain('Menu.buildFromTemplate(template)')
  })

  it('渲染层菜单条只有顶层标签的排版，没有第二份菜单文案/菜单构造', () => {
    const source = read('apps/desktop-shell/src/renderer/src/shell/window/AppMenuBar.tsx')
    // 标签只能来自 Main（window.platform.window.menu.list）；出现 label: '...' 或菜单名即重复定义
    expect(source).not.toMatch(/\blabel:\s*['"]/)
    expect(source).not.toContain('MenuItemConstructorOptions')
    expect(source).not.toMatch(/['"](File|Edit|View|Window|Help)['"]/)
    expect(source).toContain('window.platform?.window?.menu')
  })

  it('Windows 菜单条点开走的是同一份原生子菜单（按索引 popup，不是渲染层重画菜单）', async () => {
    // 与主进程实现的契约：list 给标签、popup 给索引；两条通道都只服务现成的应用菜单
    const main = read('platform/desktop/main/app.ts')
    expect(main).toContain('IpcChannels.windowMenuList')
    expect(main).toContain('IpcChannels.windowMenuPopup')
    expect(main).toContain('Menu.getApplicationMenu()')
    expect(main).toContain('submenu.popup(')
  })
})
