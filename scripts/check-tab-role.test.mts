import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findForeignTabs, isRegisteredTabPath, scanRepositoryFiles, TAB_EXCEPTIONS } from './check-tab-role.mts'

/**
 * 断的是**扫描器本身**（源码文本 → 命中行），以及对偶两例：白名单外该红、白名单内该绿。
 *
 * 为什么要有对偶：只写「仓库现在 0 命中」时，扫描器坏掉也是绿的（没有输入就永远不命中）。
 * 这两例把「它到底在不在盯」变成机械判据：删掉 `TAB_EXCEPTIONS` 里的工作区 Tab 条那一条，
 * 第二例立刻变红，第一例不受影响——所以删登记这件事不可能悄悄发生。
 */
const WORKSPACE_TAB_STRIP = 'apps/desktop-shell/src/renderer/src/shell/workspace/WorkspaceTabStrip.tsx'

describe('role="tab" scanner', () => {
  it('counts a hand-drawn tab outside the registered paths', () => {
    const source = [
      'export const Strip = () => (',
      '  <div role="tablist">',
      '    <button role="tab">A</button>',
      '  </div>',
      ')'
    ].join('\n')
    expect(findForeignTabs(source)).toEqual([
      { line: 2, role: 'tablist' },
      { line: 3, role: 'tab' }
    ])
    expect(isRegisteredTabPath('apps/desktop-shell/src/renderer/src/shell/settings/ThirdTabStrip.tsx')).toBe(false)
  })

  it('registers the workspace tab strip, which is the one exception in the repository', () => {
    // 白名单里的路径 + 同一行角色 = 不当成新违规（它不是「没写」，是「已登记」）。
    expect(isRegisteredTabPath(WORKSPACE_TAB_STRIP)).toBe(true)
    expect(Object.keys(TAB_EXCEPTIONS)).toEqual([WORKSPACE_TAB_STRIP])
    // 平台 `Tabs` 自己的实现目录永远放行。
    expect(isRegisteredTabPath('platform/ui/components/tabs/Tabs.tsx')).toBe(true)
  })

  it('reports one hit per container, not one per role', () => {
    // 外层 tablist 与它的页签写在同一行：同一个容器，只报一次（否则台账里会多一笔重复欠账）。
    expect(findForeignTabs('<div role="tablist"><button role="tab">A</button></div>')).toEqual([{ line: 1, role: 'tablist' }])
  })

  it('does not count a role that only appears in comments', () => {
    const source = [
      '// 不要手写 role="tab"，请用平台 Tabs',
      '/* 也不许：role="tablist" */',
      'export const X = () => null'
    ].join('\n')
    expect(findForeignTabs(source)).toEqual([])
  })

  it('finds no hand-written tab outside the registered exception', () => {
    expect(scanRepositoryFiles()).toEqual([])
  })

  it('keeps the exception justified, and its capabilities still in use', () => {
    for (const [path, exception] of Object.entries(TAB_EXCEPTIONS)) {
      expect(exception.reason.length, `${path} 的理由`).toBeGreaterThan(30)
      expect(exception.revokeWhen.length, `${path} 的撤登记条件`).toBeGreaterThan(30)
      expect(exception.capabilities.length, `${path} 的能力条数`).toBeGreaterThanOrEqual(1)
      const source = readFileSync(join(process.cwd(), path), 'utf8')
      for (const capability of exception.capabilities) {
        // 只写「关闭」两个字不算登记：必须说清换过去会丢什么，而且那件能力今天还在用。
        expect(capability.lost.length, `${path} ${capability.id} 的丢失说明`).toBeGreaterThan(30)
        expect(capability.usedBy.test(source), `${path} ${capability.id} 已不再被使用，登记过期了`).toBe(true)
      }
    }
  })
})
