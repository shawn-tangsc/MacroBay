import { describe, expect, it } from 'vitest'

import {
  buildGeneratedImageUrl,
  generatedImageMimeType,
  isGeneratedImageFileName,
  parseGeneratedImageUrl
} from './generatedImageUrl'

/**
 * T1：图片引用的 URL 契约。
 * 只有「16 位 hex 内容 hash + png/jpg/webp」才是合法文件名；拼与解析两个方向都拒绝
 * 任意路径、任意扩展名，渲染层因此拿不到可穿越的地址。
 */
const fileName = '0123456789abcdef.png'

describe('generatedImageUrl', () => {
  it('builds an app-image url for a hash file name', () => {
    expect(buildGeneratedImageUrl(fileName)).toBe('app-image://generated-images/0123456789abcdef.png')
  })

  it('rejects file names that are not content hashes or have unsafe extensions', () => {
    for (const candidate of [
      'prompt-name.png',
      '../../etc/passwd.png',
      '0123456789abcdef.exe',
      '0123456789ABCDEF.png',
      '0123456789abcdef.png.png',
      ''
    ]) {
      expect(isGeneratedImageFileName(candidate)).toBe(false)
      expect(buildGeneratedImageUrl(candidate)).toBeNull()
    }
  })

  it('parses only the exact generated-image host and a single safe segment', () => {
    expect(parseGeneratedImageUrl('app-image://generated-images/0123456789abcdef.jpg')).toBe(
      '0123456789abcdef.jpg'
    )
    // `..` 由 URL 解析器归一化后仍落在 images 根目录、且叶子是 hash 文件名 ⇒ 安全
    expect(parseGeneratedImageUrl('app-image://generated-images/../0123456789abcdef.png')).toBe(
      '0123456789abcdef.png'
    )
    for (const url of [
      'app-image://evil/0123456789abcdef.png',
      'app-image://generated-images/..%2F..%2Fsecrets.png',
      'app-image://generated-images/a/0123456789abcdef.png',
      'app-image://generated-images/0123456789abcdef.svg',
      'file:///tmp/0123456789abcdef.png',
      'http://generated-images/0123456789abcdef.png',
      'not a url'
    ]) {
      expect(parseGeneratedImageUrl(url)).toBeNull()
    }
  })

  it('maps extensions to mime types', () => {
    expect(generatedImageMimeType('0123456789abcdef.png')).toBe('image/png')
    expect(generatedImageMimeType('0123456789abcdef.jpg')).toBe('image/jpeg')
    expect(generatedImageMimeType('0123456789abcdef.webp')).toBe('image/webp')
    expect(generatedImageMimeType('0123456789abcdef.gif')).toBeNull()
  })
})
