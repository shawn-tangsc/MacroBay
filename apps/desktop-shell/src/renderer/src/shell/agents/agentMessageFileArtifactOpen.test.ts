import { describe, expect, it, vi } from 'vitest'

import { openAgentMessageFileArtifact } from './agentMessageFileArtifactOpen'

describe('agent message file artifact opener', () => {
  it('routes file artifacts through the platform open-file-with-app seam', async () => {
    const openFileWithApp = vi.fn(async () => ({ ok: true }))

    await expect(
      openAgentMessageFileArtifact(
        {
          id: '/Users/demo/project/hello.py',
          absolutePath: '/Users/demo/project/hello.py',
          displayPath: 'hello.py',
          fileName: 'hello.py',
          extension: 'PY',
          kind: 'code',
          operation: 'edited'
        },
        'cursor',
        { openFileWithApp }
      )
    ).resolves.toBe(true)

    expect(openFileWithApp).toHaveBeenCalledWith({
      targetId: 'cursor',
      filePath: '/Users/demo/project/hello.py'
    })
  })
})
