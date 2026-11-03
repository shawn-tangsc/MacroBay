import { describe, expect, it } from 'vitest'

import { AMBIENT_DECLARATIONS, filesOutsideProjectInclude, withAmbientDeclarations } from './pre-commit-scope.mts'

/**
 * 判据只有一句：**主 `typecheck` 查不到的文件，必须在预检里被单独列出来补查**。
 *
 * 这几条反过来写就是在钉住错误：若哪天有人把 `products/` 从 `OUTSIDE_PROJECT_INCLUDE` 里删掉，
 * 预检就会安静地放行一个从未被类型检查的产品文件——正是今晚发现的那个洞（`include` 的花括号
 * 在 TypeScript 里不生效，`products/` 从来没进过检查）。
 */

describe('预检补查范围', () => {
  it('products 下的源码与用例都要补查（include 那行从来没匹配到它们）', () => {
    expect(
      filesOutsideProjectInclude([
        'products/market-intelligence/service/intelligence/etf/etfCurrentStateRefreshService.ts',
        'products/market-intelligence/desktop/pages/intelligence/DailyBriefingPage.test.tsx'
      ])
    ).toHaveLength(2)
  })

  it('tools 与 vitest.config.ts 也补查（它们根本不在 include 里）', () => {
    expect(filesOutsideProjectInclude(['tools/head-tree-integrity/headTreeImports.ts', 'vitest.config.ts'])).toEqual([
      'tools/head-tree-integrity/headTreeImports.ts',
      'vitest.config.ts'
    ])
  })

  it('主 include 覆盖到的路径不重复查（platform / shell 已经查过了）', () => {
    expect(
      filesOutsideProjectInclude([
        'platform/notifications/contracts/notificationEventPolicy.ts',
        'apps/desktop-shell/src/renderer/src/shell/notifications/NotificationCenterDrawer.tsx'
      ])
    ).toEqual([])
  })

  it('非代码文件不进补查（列出来只会制造噪音）', () => {
    expect(filesOutsideProjectInclude(['products/market-intelligence/README.md', 'products/x/panel.css'])).toEqual([])
  })

  it('环境声明跟着临时配置一起查，否则 window.platform 会被报成不存在', () => {
    const files = withAmbientDeclarations(['products/market-intelligence/desktop/shared/ipc/dailyBriefingClient.ts'])
    for (const declaration of AMBIENT_DECLARATIONS) expect(files).toContain(declaration)
    expect(files[files.length - 1]).toBe('products/market-intelligence/desktop/shared/ipc/dailyBriefingClient.ts')
    // A staged file that is itself an ambient declaration must not be listed twice.
    expect(withAmbientDeclarations([AMBIENT_DECLARATIONS[0]!])).toHaveLength(AMBIENT_DECLARATIONS.length)
  })
})
