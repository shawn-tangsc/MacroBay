import { describe, expect, it } from 'vitest'

import { platformText } from './platformText'

/**
 * 平台文案表的**中英键路径必须完全相等**（2026-11-10）。
 *
 * 同一个风险、而且更大：这张表 3000 多条叶子路径，被整体重写过一次就会静默丢掉另一条线刚加的键，
 * 运行期读到 `undefined` 才炸——读者看到的是一行空白，不是构建错误。
 *
 * 判据与产品表一致：叶子路径集合逐条对齐；缺一侧、多一侧都红，并**点名那条路径**。
 * 平台表今天没有设计使然的例外；将来若真有（如按语言的读法差异），必须显式写在下面这份空清单里，
 * 不许用后缀白名单或正则糊。
 */
const BY_DESIGN_EXCEPTIONS = {
  zhOnly: [] as readonly string[],
  enOnly: [] as readonly string[]
}

type Language = keyof typeof platformText

function isLeaf(value: unknown): boolean {
  if (typeof value === 'function') return true
  if (Array.isArray(value)) return true
  return typeof value !== 'object' || value === null
}

function collectKeyPaths(value: unknown, prefix: string, out: Set<string>): void {
  if (isLeaf(value)) {
    if (prefix.length > 0) out.add(prefix)
    return
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectKeyPaths(child, prefix.length === 0 ? key : `${prefix}.${key}`, out)
  }
}

function keyPaths(language: Language): Set<string> {
  const out = new Set<string>()
  collectKeyPaths(platformText[language], '', out)
  return out
}

describe('platformCopy: every key path exists on both languages', () => {
  it('collects a real number of paths, so an empty table cannot pass this test', () => {
    expect(keyPaths('zh-CN').size).toBeGreaterThan(1000)
    expect(keyPaths('en-US').size).toBeGreaterThan(1000)
  })

  it('names every path present on one side only', () => {
    const zh = keyPaths('zh-CN')
    const en = keyPaths('en-US')
    const allowedZh = new Set(BY_DESIGN_EXCEPTIONS.zhOnly)
    const allowedEn = new Set(BY_DESIGN_EXCEPTIONS.enOnly)
    expect({
      unexpectedZhOnly: [...zh].filter((path) => !en.has(path) && !allowedZh.has(path)).sort(),
      unexpectedEnOnly: [...en].filter((path) => !zh.has(path) && !allowedEn.has(path)).sort(),
      missingZhOnly: BY_DESIGN_EXCEPTIONS.zhOnly.filter((path) => !(zh.has(path) && !en.has(path))),
      missingEnOnly: BY_DESIGN_EXCEPTIONS.enOnly.filter((path) => !(en.has(path) && !zh.has(path)))
    }).toEqual({ unexpectedZhOnly: [], unexpectedEnOnly: [], missingZhOnly: [], missingEnOnly: [] })
  })
})
