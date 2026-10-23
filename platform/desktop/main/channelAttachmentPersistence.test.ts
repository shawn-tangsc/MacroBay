import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { persistChannelAttachments } from './channelAttachmentPersistence'

describe('channel attachment persistence', () => {
  it('writes image and file attachments under channel attachment folders', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'channel-attachments-'))

    const result = await persistChannelAttachments({
      sessionId: 'session-1',
      workspacePath: workspaceRoot,
      attachments: [
        {
          kind: 'image',
          name: 'chart.png',
          mimeType: 'image/png',
          data: Buffer.from('png-image').toString('base64')
        },
        {
          kind: 'file',
          name: 'report.txt',
          mimeType: 'text/plain',
          data: Buffer.from('hello report').toString('base64')
        }
      ]
    })

    expect(result.savedFiles).toHaveLength(2)
    expect(result.savedFiles[0]?.savedPath).toContain('/.agent-workspace/channel-images/')
    expect(result.savedFiles[1]?.savedPath).toContain('/.agent-workspace/channel-files/')
    await expect(readFile(result.savedFiles[0]!.savedPath, 'utf8')).resolves.toBe('png-image')
    await expect(readFile(result.savedFiles[1]!.savedPath, 'utf8')).resolves.toBe('hello report')
  })

  it('sanitizes unsafe file names and infers an image extension when missing', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'channel-attachments-'))

    const result = await persistChannelAttachments({
      sessionId: 'session-2',
      workspacePath: workspaceRoot,
      attachments: [
        {
          kind: 'image',
          name: 'unsafe/name',
          mimeType: 'image/jpeg',
          data: Buffer.from('jpeg-image').toString('base64')
        },
        {
          kind: 'file',
          name: 'bad:name?.txt',
          mimeType: 'text/plain',
          data: Buffer.from('safe-name').toString('base64')
        }
      ]
    })

    expect(result.savedFiles[0]?.savedPath).toMatch(/unsafe_name\.jpg$/)
    expect(result.savedFiles[1]?.savedPath).toMatch(/bad_name_\.txt$/)
  })
})
