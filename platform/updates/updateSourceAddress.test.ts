import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  updateDownloadAllowedHosts,
  updateDownloadPageUrl,
  updateMetadataFileName,
  updateMetadataUrl
} from './updateSource'

/**
 * 发布地址只有一处：`platform/updates/updateSource.ts`。
 *
 * 这条守的是需求里的「界面里不出现任何网址」：只要有人在渲染层再写一遍地址，就等于界面持有地址，
 * 那个「打开下载页」的按钮迟早会变成「打开某个字符串」。扫描范围只取 `platform/` 与 `apps/`，
 * 因为功能代码只在这两处；`scripts/`、文档不在其内。
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

function filesMentioningReleasePage(): string[] {
  const hits: string[] = []
  for (const root of SCAN_ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      if (readFileSync(file, 'utf8').includes(RELEASE_PAGE_PIN)) hits.push(relative(ROOT, file))
    }
  }
  return hits.sort()
}

describe('the release address lives in exactly one file', () => {
  it('has no other source file naming the release page', () => {
    expect(filesMentioningReleasePage()).toEqual([SOLE_OWNER])
  })

  it('builds the download page from the repository constant, https only', () => {
    const url = new URL(updateDownloadPageUrl())
    expect(url.protocol).toBe('https:')
    expect(url.pathname.endsWith(`/${RELEASE_PAGE_PIN}`)).toBe(true)
    // 打开前校验的那份白名单必须放行自己的地址，否则「打开下载页」永远被自己拒掉。
    expect(updateDownloadAllowedHosts).toContain(url.host)
  })

  it('knows the metadata file of each shipped platform and refuses the others', () => {
    expect(updateMetadataFileName('darwin')).toBe('latest-mac.yml')
    expect(updateMetadataFileName('win32')).toBe('latest.yml')
    expect(updateMetadataFileName('linux')).toBeNull()
    expect(updateMetadataUrl('linux')).toBeNull()
    expect(updateMetadataUrl('darwin')).toMatch(/^https:\/\/.+latest-mac\.yml$/u)
    expect(updateMetadataUrl('win32')).toMatch(/^https:\/\/.+latest\.yml$/u)
  })
})
