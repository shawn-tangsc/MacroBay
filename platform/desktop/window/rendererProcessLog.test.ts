import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { createRendererProcessLog } from './rendererProcessLog'

describe('createRendererProcessLog', () => {
  it('writes diagnostic events as newline-delimited JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'renderer-process-log-'))
    const filePath = join(directory, 'nested', 'renderer-lifecycle.ndjson')
    const log = createRendererProcessLog(filePath)

    log.write({
      timestamp: '2026-07-10T14:00:00.000Z',
      event: 'render-process-gone',
      reason: 'crashed',
      exitCode: 9
    })

    await eventually(async () => {
      const contents = await readFile(filePath, 'utf8')
      expect(contents.trim()).toBe(
        JSON.stringify({
          timestamp: '2026-07-10T14:00:00.000Z',
          event: 'render-process-gone',
          reason: 'crashed',
          exitCode: 9
        })
      )
    })
  })
})

async function eventually(assertion: () => Promise<void>): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < 1000) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw lastError
}
