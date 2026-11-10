#!/usr/bin/env tsx
/**
 * `role="tab"` / `role="tablist"` 只许来自平台 `Tabs`（界面设计 2026-11-09 第二条；E2 #2）。
 *
 * 为什么：自绘页签要自己承担 roving tabindex、方向键、`aria-controls` 指向真实面板、选中态。
 * 这些写漏一件就是键盘走不通，不是「看起来丑一点」。平台 `Tabs`（内部 antd）才有唯一实现。
 *
 * 放行规则（只此两类）：
 * 1. 平台 `Tabs` 组件目录；
 * 2. 白名单里**按文件路径**登记的存量，每条写清理由、换过去会丢哪几件能力、以及什么条件下撤掉。
 *    反对按注释/函数名放行——那等于写上角色再配一句解释就过。
 *
 * **当前唯一的登记存量是工作区 Tab 条**（`WorkspaceTabStrip.tsx`），`docs/ui-rules.md` 里那句
 * 「the workspace tab strip is the one registered exception」就是这条。
 * `ModelServiceModelDrawer.tsx` **不入白名单**：它的 `role="switch"` 欠账已随源码合规删除，
 * 与页签无关，别把它当第二个例外。
 *
 * 扫描只证明「写法还在」，**不能证明渲染正确**——台账只写「结构守住了」。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCANNED_ROOTS = ['apps', 'products', 'platform']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', 'release'])

/** 平台 `Tabs` 的实现目录：页签角色的唯一来源。 */
const PLATFORM_TABS_DIR = 'platform/ui/components/tabs/'

/**
 * 一条登记 = 四件事：为什么不能用 `Tabs`、换过去会丢哪几件能力（逐条）、每件能力在该文件里的
 * **使用处**、以及什么条件下撤掉这条登记。
 *
 * 光写一段理由不够：理由会过期。`usedBy` 必须是调用点而不是类型声明或注释——能力被删掉、
 * 或整条被换成 `Tabs` 时，「登记过期」那条用例才会红，人才会回来改登记而不是改断言。
 */
export type TabException = {
  reason: string
  capabilities: ReadonlyArray<{ id: string; lost: string; usedBy: RegExp }>
  revokeWhen: string
}

/**
 * 存量登记：只减不增。**今天只此一条**（`ui-rules` 中英两版写的是同一句）。
 */
export const TAB_EXCEPTIONS: Readonly<Record<string, TabException>> = {
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

/**
 * 剥注释再扫：**注释里写这串属性不是违规**。
 *
 * 真实误报过一次：说明「不要手写 role=\"tab\"」的注释被逐行扫成了违规，白记一笔。
 * 块注释与行注释都剥，否则以后任何一句讲这条规则的说明都会变成违规。
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .map((line) => {
      const index = line.indexOf('//')
      return index === -1 ? line : line.slice(0, index)
    })
    .join('\n')
}

/** 一次命中：行号（1 起）与那个容器上的角色。同一行只报一次——一个容器一个角色。 */
export type TabHit = Readonly<{ line: number; role: 'tab' | 'tablist' }>

/**
 * 纯函数：给定源码文本，返回命中的行与角色。
 *
 * 只认**字面量**（antd 与平台 `Tabs` 是运行时拼属性，误伤为零）。
 * 同一行同时出现 `tablist` 与 `tab`（外层容器与它的一颗页签写在一行）只报一次，
 * 因为那是同一个容器，报两遍只会让台账里多出一笔重复欠账。
 */
export function findForeignTabs(source: string): readonly TabHit[] {
  const hits: TabHit[] = []
  stripComments(source).split('\n').forEach((line, index) => {
    if (line.includes('role="tablist"') || line.includes("role='tablist'")) hits.push({ line: index + 1, role: 'tablist' })
    else if (line.includes('role="tab"') || line.includes("role='tab'")) hits.push({ line: index + 1, role: 'tab' })
  })
  return hits
}

/** 这个路径是否已经登记（平台 `Tabs` 目录或白名单里的存量）。纯函数，用例直接喂路径。 */
export function isRegisteredTabPath(path: string): boolean {
  return path.startsWith(PLATFORM_TABS_DIR) || TAB_EXCEPTIONS[path] !== undefined
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

/** 仓扫：返回 `路径:行 (角色)` 形式的清单。CLI 与用例共用，避免两套扫法各漂各的。 */
export function scanRepositoryFiles(): string[] {
  const hits: string[] = []
  for (const root of SCANNED_ROOTS) {
    let files: string[] = []
    try { files = sourceFiles(join(ROOT, root)) } catch { files = [] }
    for (const file of files) {
      const path = relative(ROOT, file).split('\\').join('/')
      if (isRegisteredTabPath(path)) continue
      findForeignTabs(readFileSync(file, 'utf8')).forEach((hit) => {
        hits.push(`${path}:${hit.line} (role="${hit.role}")`)
      })
    }
  }
  return hits
}

const invokedDirectly = process.argv[1]?.endsWith('check-tab-role.mts') === true
if (invokedDirectly) {
  const hits = scanRepositoryFiles()
  if (hits.length > 0) {
    console.log('role="tab" 门禁未通过：自绘页签只许出现在平台 `Tabs` 或已登记的存量里。')
    for (const hit of hits) console.log(`  ${hit}`)
    console.log('处理方式：换成平台 `Tabs`；确需保留就先在 `docs/ui-rules.md` 登记理由、丢掉的能力与撤销条件。')
    process.exit(1)
  }
  console.log(`role="tab" 门禁通过：${Object.keys(TAB_EXCEPTIONS).length} 个已登记存量（当前唯一一条是工作区 Tab 条），没有新增自绘页签。`)
}
