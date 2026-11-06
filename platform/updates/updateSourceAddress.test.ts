import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  isAllowedUpdateLinkUrl,
  updateLinkHost,
  updateLinkIds,
  updateLinkUrl,
  updateMetadataFileName,
  updateMetadataUrl
} from './updateSource'

/**
 * 地址只有一处：`platform/updates/updateSource.ts`。
 *
 * 这条守的是「界面不持有网址」：只要有人在渲染层再写一遍地址，那个按钮迟早会变成
 * 「打开某个字符串」。扫描范围取 `platform/` 与 `apps/`（功能代码只在这两处）。
 *
 * 针**不能写成字面量**：写成字面量的话本文件自己也命中，一上来就红。所以用拼接生成。
 */
const RELEASE_PAGE_PIN = ['releases', 'latest'].join('/')
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SCAN_ROOTS = ['platform', 'apps'] as const
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts'] as const
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'release', 'out', '.vite', 'coverage'])
const SOLE_OWNER = join('platform', 'updates', 'updateSource.ts')

function walk(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue
      files.push(...walk(join(directory, entry.name)))
      continue
    }
    if (!entry.isFile()) continue
    if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue
    files.push(join(directory, entry.name))
  }
  return files
}

describe('the release address lives in exactly one file', () => {
  it('has no other source file naming the release page', () => {
    const hits: string[] = []
    for (const root of SCAN_ROOTS) {
      for (const file of walk(join(ROOT, root))) {
        if (readFileSync(file, 'utf8').includes(RELEASE_PAGE_PIN)) hits.push(relative(ROOT, file))
      }
    }
    expect(hits.sort()).toEqual([SOLE_OWNER])
  })

  it('builds every destination from the repository constant, https only', () => {
    for (const id of updateLinkIds) {
      const url = new URL(updateLinkUrl(id))
      expect(url.protocol).toBe('https:')
      expect(url.host).toBe(updateLinkHost)
      expect(url.pathname.startsWith('/shawn-tangsc/MacroBay')).toBe(true)
    }
    // 更新日志与下载页是两个目的地，不是同一个地址。
    expect(updateLinkUrl('changelog')).not.toBe(updateLinkUrl('download'))
  })

  it('accepts the five destinations it built itself', () => {
    for (const id of updateLinkIds) {
      expect(isAllowedUpdateLinkUrl(id, updateLinkUrl(id)), id).toBe(true)
    }
  })

  it('refuses another repository on the same host', () => {
    expect(isAllowedUpdateLinkUrl('docs', 'https://github.com/someone/MacroBay/tree/main/docs')).toBe(false)
    expect(isAllowedUpdateLinkUrl('site', 'https://github.com/shawn-tangsc/OtherRepo')).toBe(false)
  })

  it('refuses lookalike paths that a string prefix check would let through', () => {
    // 写成 `startsWith('/MacroBay')` 的实现在这两条上会放行，所以专门拿它们打一次。
    expect(isAllowedUpdateLinkUrl('site', 'https://github.com/shawn-tangsc/MacroBay-evil')).toBe(false)
    expect(isAllowedUpdateLinkUrl('site', 'https://github.com/shawn-tangsc/MacroBayX')).toBe(false)
    expect(isAllowedUpdateLinkUrl('docs', 'https://github.com/shawn-tangsc/MacroBayX/tree/main/docs')).toBe(false)
  })

  it('refuses another page inside our own repository', () => {
    // 第 2 层：同一仓库里也不是哪里都能开。
    expect(isAllowedUpdateLinkUrl('docs', 'https://github.com/shawn-tangsc/MacroBay/issues')).toBe(false)
    expect(isAllowedUpdateLinkUrl('changelog', updateLinkUrl('download'))).toBe(false)
  })

  it('refuses everything that is not https on the exact host', () => {
    const page = updateLinkUrl('site')
    expect(isAllowedUpdateLinkUrl('site', page.replace('https://', 'http://'))).toBe(false)
    expect(isAllowedUpdateLinkUrl('site', 'https://example.invalid/shawn-tangsc/MacroBay')).toBe(false)
    expect(isAllowedUpdateLinkUrl('site', 'not a url')).toBe(false)
  })

  it('knows the metadata file of each shipped platform and refuses the others', () => {
    expect(updateMetadataFileName('darwin')).toBe('latest-mac.yml')
    expect(updateMetadataFileName('win32')).toBe('latest.yml')
    expect(updateMetadataFileName('linux')).toBeNull()
    expect(updateMetadataUrl('linux')).toBeNull()
    expect(updateMetadataUrl('darwin')).toMatch(/^https:\/\/.+latest-mac\.yml$/u)
  })
})
