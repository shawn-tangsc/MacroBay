#!/usr/bin/env tsx
/**
 * `role="switch"` 只许来自平台组件（界面设计 2026-11-09 判据；E2 #1）。
 *
 * 为什么：手写开关要把「轨道/滑块/`aria-checked`/键盘 Space」四件事各写一遍，每处都可能漏一件；
 * 平台组件才有唯一实现。antd 自己的 `Switch` 不产生这个**字面量**（运行时拼属性），误伤为零。
 *
 * 放行规则（只此两类）：
 * 1. 平台 `Switch` 组件文件；
 * 2. 白名单里**按文件路径**登记的存量站点，每条写清理由与「换它会怎样」。
 *    反对按注释/函数名放行——那等于写上属性再配一句解释就过。
 *
 * 白名单只在本文件里，每条都写成**欠账**（理由 + 清掉后删这一行）；它不是「已批准例外」。
 *
 * 扫描只证明「写法还在」，**不能证明渲染正确**——台账只写「结构守住了」。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCANNED_ROOTS = ['apps', 'products', 'platform']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', 'release'])

/** 平台组件的唯一实现文件。 */
const PLATFORM_SWITCH_FILES = new Set<string>()

/**
 * **待清欠账**（不是「已批准例外」）：只减不增，清掉一处就删一行。
 *
 * 这两条的理由是「换组件要同步改行高」——那是**工作量**，不是能力边界，所以它们不被批准为长期例外；
 * 台账各有一行，判据是「改成平台 `Switch` + 行高与现状一致（或界面设计重新签）」。
 * 写在这里只是为了让门禁能跑，不是给历史遗留发通行证。
 */
const ALLOWED: Readonly<Record<string, string>> = {
  'products/market-intelligence/desktop/pages/intelligence/AgentPortal.tsx':
    '欠账：换平台 Switch 要同步改卡片行高；清掉后删这一行'
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

/**
 * 剥掉注释再扫：**注释里写这串属性不是违规**。
 * 真实误报：`ModelServiceModelDrawer.tsx:250` 的注释里带着这串字面量，被逐行扫成了手写开关，
 * 白白记了一笔欠账。块注释与行注释都要剥（`//` 与 `/* … *\/`），否则以后任何一句
 * 「不要手写 <该属性>」的说明都会变成违规。
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .map((line) => {
      const index = line.indexOf('//')
      // 行注释：只剥第一次出现的 `//`（URL 里的 `//` 会先撞上，但那行本来也不含被守的属性字面量）。
      return index === -1 ? line : line.slice(0, index)
    })
    .join('\n')
}

/** 纯函数：给定源码文本，返回命中的行号（1 起）。用例直接喂字符串，不依赖仓库里恰好有哪个文件。 */
export function roleSwitchLines(source: string): number[] {
  return stripComments(source)
    .split('\n')
    .flatMap((line, index) => (line.includes('role="switch"') ? [index + 1] : []))
}

const hits: string[] = []
for (const root of SCANNED_ROOTS) {
  let files: string[] = []
  try { files = sourceFiles(join(ROOT, root)) } catch { files = [] }
  for (const file of files) {
    const relativePath = relative(ROOT, file).split('\\').join('/')
    if (PLATFORM_SWITCH_FILES.has(relativePath)) continue
    if (ALLOWED[relativePath] !== undefined) continue
    roleSwitchLines(readFileSync(file, 'utf8')).forEach((line) => {
      hits.push(`${relativePath}:${line}`)
    })
  }
}

const invokedDirectly = process.argv[1]?.endsWith('check-role-switch.mts') === true
if (!invokedDirectly) {
  // 被用例 import：只导出纯函数，不跑仓库扫描。
} else if (hits.length > 0) {
  console.log('role="switch" 门禁未通过：手写开关只许出现在平台组件或已登记的存量里。')
  for (const hit of hits) console.log(`  ${hit}`)
  console.log('处理方式：换成平台 `Switch`；确需保留就先在 `docs/ui-rules.md` 登记理由与「换它会怎样」。')
  process.exit(1)
}
console.log(`role="switch" 门禁通过：${ALLOWED ? Object.keys(ALLOWED).length : 0} 个已登记存量，没有新增手写开关。`)
