import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `role="tab"` / `role="tablist"` 只许来自平台 `Tabs`（界面设计 2026-11-09 第二条）。
 *
 * 自绘页签要自己承担：roving tabindex、方向键、`aria-controls` 指向真实面板、选中态。
 * 这些一件写漏就是键盘走不通，而不是「看起来丑一点」。antd 与平台 `Tabs` 内部才有唯一实现。
 *
 * 放行规则：平台 `Tabs` 组件文件 + **按文件路径登记**的例外。**不许按注释或函数名放行**——
 * 那等于写上角色再配一句解释就过。
 */

const ROOT = process.cwd()
const SCANNED_ROOTS = ['apps', 'products', 'platform']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', 'release'])
/** 平台 `Tabs` 的实现目录：页签角色的唯一来源。 */
const PLATFORM_TABS_DIR = 'platform/ui/components/tabs/'

/**
 * 一条例外 = 四件事：为什么不能用 `Tabs`、换过去会丢哪几件能力（逐条）、每件能力在该文件里的
 * **使用处**、以及什么条件下撤掉这条例外。
 *
 * 光写一段理由不够：理由会过期。`usedBy` 必须是调用点而不是类型声明或注释——能力被删掉、
 * 或整条被换成 `Tabs` 时，「登记过期」那条用例才会红，人才会回来改登记而不是改断言。
 */
type TabException = {
  reason: string
  capabilities: ReadonlyArray<{ id: string; lost: string; usedBy: RegExp }>
  revokeWhen: string
}

/**
 * 存量例外：只减不增。
 *
 * 登记对象是**今天实际存在的能力**：工作区 Tab 条的关闭、重开、换位、分离。早先的登记文本里
 * 写的是「关闭/拖拽/重开」和「固定」——拖拽与页签级固定**都不存在**（换位是 `Alt+Shift+方向`
 * 提交完整顺序，代码里的 pin 是窄屏**区域**级呈现，不是页签固定）。登记按事实写，不按印象写。
 */
const ALLOWED: Readonly<Record<string, TabException>> = {
  'apps/desktop-shell/src/renderer/src/shell/workspace/WorkspaceTabStrip.tsx': {
    reason:
      '工作区 Tab 条：每个页签自己带关闭（含草稿三态保护与批量关闭）、重开最近关闭、换位、分离到新窗口，' +
      '并有逐页签右键菜单。平台 `Tabs` 只有 items + panels 与 ←→ 即时切换，这四件事都没有槽位。',
    capabilities: [
      {
        id: 'close-with-draft-gate',
        lost:
          '`Tabs` 的关闭只是一个叉。这里关之前要问草稿 owner（保存/丢弃/取消），批量关闭先收齐全部裁决' +
          '再落副作用——没有这层，关掉一个脏页就是静默丢内容。',
        usedBy: /guardedClose\(\[/
      },
      {
        id: 'reopen-last-closed',
        lost:
          '`Tabs` 没有「重开最近关闭」的槽位。这个入口还得活在 tablist 里并由权威回答「有没有可重开的」' +
          '（没有时禁用并给可见原因），空工作区时靠它恢复。',
        usedBy: /port\.reopenLastClosed\(\)/
      },
      {
        id: 'reorder-commits-the-authority-order',
        lost:
          '换位要把**完整**顺序（含已关闭的页签）提交给权威，组件内重排会让里外两份顺序分叉。' +
          '键盘是 `Alt+Shift+←/→` 挪一位即提交，不是拖拽，也不是组件自己记顺序。',
        usedBy: /reorderTabs\(\{ workspaceInstanceKeys: order \}\)/
      },
      {
        id: 'detach-to-its-own-window',
        lost:
          '把单个页签分离成独立窗口，并在不可分离时给可见原因（页面声明不支持／已在独立窗口／没有锚点）。' +
          '`Tabs` 没有逐页签动作面板。',
        usedBy: /port\.detachTab\(\{/
      }
    ],
    revokeWhen:
      '平台 `Tabs` 同时补上四个槽位才撤：①关闭前的逐页签裁决（含批量原子）②重开最近关闭条目' +
      '③提交完整顺序的重排 ④逐页签「分离到新窗口」并带禁用原因。少一条就仍然不能换。'
  }
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) sourceFiles(absolute, out)
    else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) out.push(absolute)
  }
  return out
}

const FILES = SCANNED_ROOTS.flatMap((root) => {
  try {
    return sourceFiles(join(ROOT, root))
  } catch {
    return []
  }
})

/** 注释里的字样不算使用处。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function offenders(): string[] {
  const hits: string[] = []
  for (const file of FILES) {
    const path = relative(ROOT, file).replace(/\\/g, '/')
    if (path.startsWith(PLATFORM_TABS_DIR)) continue
    if (ALLOWED[path] !== undefined) continue
    const source = stripComments(readFileSync(file, 'utf8'))
    if (source.includes('role="tab"') || source.includes('role="tablist"')) hits.push(path)
  }
  return hits
}

describe('role="tab" only comes from the platform Tabs', () => {
  /**
   * 「唯一自绘」这条判据：扫描面上除平台 `Tabs` 与登记路径外，没有第二处手写页签。
   * 新增第三个自绘页签（换个文件写 `role="tab"`）会在这里红，而不是等界面评审发现。
   */
  it('finds no hand-written tab outside the registered exception', () => {
    expect(offenders()).toEqual([])
  })

  it('keeps every exception justified', () => {
    for (const [path, exception] of Object.entries(ALLOWED)) {
      expect(exception.reason.length, `${path} 的理由`).toBeGreaterThan(30)
      expect(exception.revokeWhen.length, `${path} 的撤登记条件`).toBeGreaterThan(30)
      expect(exception.capabilities.length, `${path} 的能力条数`).toBeGreaterThanOrEqual(1)
      for (const capability of exception.capabilities) {
        // 只写「关闭」两个字不算登记：必须说清换过去会丢什么。
        expect(capability.lost.length, `${path} ${capability.id} 的丢失说明`).toBeGreaterThan(30)
      }
    }
    // 例外只按路径登记：不许出现「按注释/函数名放行」的形状。
    expect(Object.keys(ALLOWED).every((path) => path.endsWith('.tsx'))).toBe(true)
  })

  /**
   * 登记不许过期：每条能力都必须仍在该文件里找得到**使用处**。
   * 把某件能力删掉（或整条换成 `Tabs`）时这里红，逼着人回来改登记，而不是让理由越写越假。
   */
  it('keeps every registered capability in use, so the registry cannot go stale', () => {
    const stale: string[] = []
    for (const [path, exception] of Object.entries(ALLOWED)) {
      const source = stripComments(readFileSync(join(ROOT, path), 'utf8'))
      for (const capability of exception.capabilities) {
        if (!capability.usedBy.test(source)) stale.push(`${path}: ${capability.id}`)
      }
    }
    expect(stale).toEqual([])
  })
})
