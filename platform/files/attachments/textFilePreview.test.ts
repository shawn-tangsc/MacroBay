import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEXT_FILE_READ_LIMIT_BYTES, readTextFilePreview } from './textFilePreview'

/**
 * 这四条行为是附件预览对外的全部契约：文本读取 / 截断 / 超大·二进制 / 读取失败。
 * 从 `platform/desktop/main/app.ts` 搬来时它零测试覆盖，这里先钉住行为，再切换调用方。
 */
describe('readTextFilePreview', () => {
  let root = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'macrobay-text-file-preview-'))
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads a UTF-8 text file and returns its trimmed path', async () => {
    const filePath = join(root, 'note.md')
    await writeFile(filePath, '# 观潮\n\n今天的宏观数据。\n', 'utf8')

    const preview = await readTextFilePreview(`  ${filePath}\n`)

    expect(preview).toEqual({
      path: filePath,
      text: '# 观潮\n\n今天的宏观数据。\n',
      truncated: false
    })
  })

  it('stops at the read limit and flags the preview as truncated', async () => {
    const filePath = join(root, 'large.log')
    await writeFile(filePath, 'a'.repeat(TEXT_FILE_READ_LIMIT_BYTES + 4096), 'utf8')

    const preview = await readTextFilePreview(filePath)

    expect(preview.truncated).toBe(true)
    expect(preview.text).toHaveLength(TEXT_FILE_READ_LIMIT_BYTES)
  })

  it('rejects binary content and paths that are not regular files', async () => {
    const binaryPath = join(root, 'image.png')
    await writeFile(binaryPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]))
    await expect(readTextFilePreview(binaryPath)).rejects.toThrow(
      'Binary files are not supported in text attachments yet.'
    )

    const directoryPath = join(root, 'folder')
    await mkdir(directoryPath)
    await expect(readTextFilePreview(directoryPath)).rejects.toThrow('Only files can be attached.')
  })

  it('rejects an empty path and a path that cannot be read', async () => {
    await expect(readTextFilePreview('   ')).rejects.toThrow('File path is required.')

    const missingPath = join(root, 'missing.txt')
    await expect(readTextFilePreview(missingPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
