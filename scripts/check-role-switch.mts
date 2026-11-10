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
 * 白名单的**登记出处是 `docs/ui-rules.md`**（评审可见），本文件里的常量只是它的执行副本：
 * 改白名单要两处一起改，否则评审看不到理由。
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

/** 存量白名单：只减不增。每条：路径 → 为什么现在还是手写、换平台开关会发生什么。 */
const ALLOWED: Readonly<Record<string, string>> = {
  'apps/desktop-shell/src/renderer/src/shell/model-service/ModelServiceModelDrawer.tsx':
    '待迁 antd Switch：轨道尺寸与抽屉里的行高绑定，换组件要同步改行高',
  'products/market-intelligence/desktop/pages/intelligence/AgentPortal.tsx':
    '待迁 antd Switch：卡片密度决定轨道尺寸，换组件要一起改卡片行高'
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

const hits: string[] = []
for (const root of SCANNED_ROOTS) {
  let files: string[] = []
  try { files = sourceFiles(join(ROOT, root)) } catch { files = [] }
  for (const file of files) {
    const relativePath = relative(ROOT, file).split('\\').join('/')
    if (PLATFORM_SWITCH_FILES.has(relativePath)) continue
    if (ALLOWED[relativePath] !== undefined) continue
    const source = readFileSync(file, 'utf8')
    source.split('\n').forEach((line, index) => {
      if (line.includes('role="switch"')) hits.push(`${relativePath}:${index + 1}`)
    })
  }
}

if (hits.length > 0) {
  console.log('role="switch" 门禁未通过：手写开关只许出现在平台组件或已登记的存量里。')
  for (const hit of hits) console.log(`  ${hit}`)
  console.log('处理方式：换成平台 `Switch`；确需保留就先在 `docs/ui-rules.md` 登记理由与「换它会怎样」。')
  process.exit(1)
}
console.log(`role="switch" 门禁通过：${ALLOWED ? Object.keys(ALLOWED).length : 0} 个已登记存量，没有新增手写开关。`)
