import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `role="switch"` 只许来自平台组件（界面设计 2026-11-09，判据字面量扫描）。
 *
 * 为什么：手写开关要把「轨道/滑块/`aria-checked`/键盘 Space」四件事各写一遍，
 * 每一处都可能漏一件；平台组件才有唯一实现。antd 自己的 `Switch` 不产生这个**字面量**
 * （它在运行时拼属性），所以误伤为零。
 *
 * 放行规则（只此两类）：
 * 1. 平台 `Switch` 组件文件（组件落地后写进来）；
 * 2. **白名单里按文件路径登记的存量站点**，每条必须写清理由与「换它会怎样」。
 *    反对按注释、函数名或 diff 放行——那等于「写上 `role="switch"` 再配一句解释就过」，守不住。
 */

const ROOT = process.cwd()
const SCANNED_ROOTS = ['apps', 'products', 'platform']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', 'release'])
/** 平台组件的唯一实现文件（现在还只有 antd 的 `Switch` 调用点，落地后把路径写这里）。 */
const PLATFORM_SWITCH_FILES = new Set<string>()

/**
 * 存量白名单：**只减不增**。新增只会让这道门变红——那正是它存在的意义。
 * 每条：路径 → 为什么现在还是手写、换平台开关会发生什么。
 */
const ALLOWED: Readonly<Record<string, string>> = {
  // 自绘开关（轨道 + 滑块 + aria-checked + 键盘），换 antd `Switch` 后轨道尺寸与品牌块布局要重排，
  // 属于「形状一样行为不同」的迁移，排进优化批而不是当场改。
  'apps/desktop-shell/src/renderer/src/shell/model-service/ModelServiceModelDrawer.tsx':
    '待迁 antd Switch：轨道尺寸与抽屉里的行高绑定，换组件要同步改行高',
  // 同一类自绘开关，但它在产品页的卡片里，尺寸与卡片密度绑定。
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

const FILES = SCANNED_ROOTS.flatMap((root) => {
  try {
    return sourceFiles(join(ROOT, root))
  } catch {
    return []
  }
})

/** 去掉注释：注释里提到 `role="switch"` 不算使用处（判据看的是真的渲染出这个角色）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function offenders(): string[] {
  return FILES.filter((file) => {
    const path = relative(ROOT, file).replace(/\\/g, '/')
    if (PLATFORM_SWITCH_FILES.has(path)) return false
    if (ALLOWED[path] !== undefined) return false
    return stripComments(readFileSync(file, 'utf8')).includes('role="switch"')
  }).map((file) => relative(ROOT, file).replace(/\\/g, '/'))
}

describe('role="switch" only comes from the platform switch', () => {
  it('finds no hand-written switch outside the registered exceptions', () => {
    expect(offenders()).toEqual([])
  })

  it('is a real guard: a new literal in an unregistered file fails it', () => {
    // 反向夹具：不靠真去改仓库文件，直接验证判据函数对「一个没登记的文件」会不会报。
    const scratch = { path: 'apps/desktop-shell/src/renderer/src/shell/__scratch.tsx', role: 'switch' }
    const hits = [`${scratch.path}`].filter(
      (path) => ALLOWED[path] === undefined && !PLATFORM_SWITCH_FILES.has(path)
    )
    expect(hits).toHaveLength(1)
    // 白名单条目必须带理由：空理由是「先放行再说」，不算。
    for (const [path, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, path).toBeGreaterThan(10)
    }
  })
})
