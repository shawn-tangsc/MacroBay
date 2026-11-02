import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * antd 静态提示（`message.*` / `notification.*`）的守卫。
 *
 * 补丁让它们**又能显示了**——在这之前它们是静默空操作；补丁修的是「不显示」，没修「该不该由它来显示」。
 * 一旦它们开始显示，就会出现第二套提示行为：顶部居中、单条 3 秒、没有关闭键、不能暂停，
 * 和我们刚定的 `Toast`（右下角、最多两条、成功 3s/失败 6s、悬停暂停、层级 1600）并存。
 *
 * 所以这里是**只减不增**的白名单：名单里的文件还在迁移中，迁完必须同笔删掉自己那行；
 * 新出现的调用点一条都不许进来。
 */

const ROOT = resolve(__dirname, '../../../..')
const ROOTS = ['apps/desktop-shell/src', 'products', 'platform']
const SKIP = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])
// 不带 `g`：带 g 的正则 `.test()` 会记住 lastIndex，循环里会一半文件判漏。
// 方法列表要全：`destroy` / `config` 不显示内容，但漏掉它们，「还剩几处」的统计就会偏低，
// 而这份名单正被用来数剩余处数。宁可多扫一个不显示的，也不要少数一个显示的。
const STATIC_CALL = /\b(?:message|notification)\.(?:open|success|error|info|warning|loading|destroy|config)\s*\(/

/** 正在迁移、尚未收口的文件（2026-11-02，补丁落地当天扫的）。 */
const BASELINE = new Set([
  'apps/desktop-shell/src/renderer/src/shell/settings/storage-cache/StorageCacheSettingsPage.tsx',
])

function files(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue
      out.push(...files(join(dir, entry.name)))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue
    out.push(join(dir, entry.name))
  }
  return out
}

const scanned = ROOTS.flatMap((root) => files(join(ROOT, root)))

describe('antd static toasts', () => {
  it('only exist in the files still being migrated, and that list only shrinks', () => {
    const offenders = scanned
      .map((file) => relative(ROOT, file))
      .filter((file) => !BASELINE.has(file))
      .filter((file) => STATIC_CALL.test(readFileSync(join(ROOT, file), 'utf8')))

    expect(offenders).toEqual([])
  })

  it('drops a file from the whitelist once it no longer calls them', () => {
    const stale = [...BASELINE].filter((file) => !STATIC_CALL.test(readFileSync(join(ROOT, file), 'utf8')))

    expect(stale).toEqual([])
  })
})
