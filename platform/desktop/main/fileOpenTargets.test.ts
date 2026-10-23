import { describe, expect, it, vi } from 'vitest'

import {
  buildFileEditorUrl,
  openFileWithTarget,
  validateOpenFileWithTargetRequest
} from './fileOpenTargets'

describe('fileOpenTargets', () => {
  it('validates allow-listed target ids and absolute local paths', () => {
    expect(
      validateOpenFileWithTargetRequest({ targetId: 'vscode', filePath: '/Users/demo/project/hello.py' })
    ).toEqual({ targetId: 'vscode', filePath: '/Users/demo/project/hello.py' })

    expect(() =>
      validateOpenFileWithTargetRequest({ targetId: 'unknown', filePath: '/Users/demo/project/hello.py' })
    ).toThrow(/allow-listed/)
    expect(() => validateOpenFileWithTargetRequest({ targetId: 'vscode', filePath: 'relative.py' })).toThrow(
      /absolute/
    )
  })

  it('builds VS Code and Cursor file protocol URLs', () => {
    expect(buildFileEditorUrl('vscode', '/Users/demo/project/hello world.py')).toBe(
      'vscode://file//Users/demo/project/hello%20world.py?windowId=_blank'
    )
    expect(buildFileEditorUrl('cursor', '/Users/demo/project/hello.py')).toBe(
      'cursor://file//Users/demo/project/hello.py?windowId=_blank'
    )
  })

  it('opens files through the requested desktop target', async () => {
    const openExternal = vi.fn(async () => undefined)
    const openPath = vi.fn(async () => '')
    const showItemInFolder = vi.fn()
    const openWithSystemApp = vi.fn(async () => undefined)

    await expect(
      openFileWithTarget(
        { targetId: 'cursor', filePath: '/Users/demo/project/hello.py' },
        { openExternal, openPath, showItemInFolder, openWithSystemApp }
      )
    ).resolves.toEqual({
      ok: true,
      targetId: 'cursor',
      filePath: '/Users/demo/project/hello.py',
      openedPath: '/Users/demo/project/hello.py'
    })
    expect(openExternal).toHaveBeenCalledWith('cursor://file//Users/demo/project/hello.py?windowId=_blank')

    await openFileWithTarget(
      { targetId: 'finder', filePath: '/Users/demo/project/hello.py' },
      { openExternal, openPath, showItemInFolder, openWithSystemApp }
    )
    expect(showItemInFolder).toHaveBeenCalledWith('/Users/demo/project/hello.py')

    await openFileWithTarget(
      { targetId: 'terminal', filePath: '/Users/demo/project/hello.py' },
      { openExternal, openPath, showItemInFolder, openWithSystemApp }
    )
    expect(openWithSystemApp).toHaveBeenCalledWith('Terminal', '/Users/demo/project')
  })
})
