import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createAppLog } from '../../observability/logging/appLog'
import { createRendererProcessLog } from './rendererProcessLog'

describe('createRendererProcessLog', () => {
  it('sends diagnostic events through the single application log, tagged with their source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'renderer-process-log-'))
    const appLog = createAppLog({
      directory,
      redact: (text) => text,
      now: () => new Date('2026-07-10T14:00:00.000Z')
    })
    const log = createRendererProcessLog(appLog)

    log.write({
      timestamp: '2026-07-10T14:00:00.000Z',
      event: 'render-process-gone',
      reason: 'crashed',
      exitCode: 9
    })

    const contents = await readFile(appLog.path, 'utf8')
    expect(JSON.parse(contents.trim())).toEqual({
      time: '2026-07-10T14:00:00.000Z',
      level: 'error',
      event: 'render-process-gone',
      category: 'renderer',
      timestamp: '2026-07-10T14:00:00.000Z',
      reason: 'crashed',
      exitCode: 9
    })
  })

  it('marks console errors as errors and other console levels as warnings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'renderer-process-log-levels-'))
    const appLog = createAppLog({ directory, redact: (text) => text })
    const log = createRendererProcessLog(appLog)

    log.write({
      timestamp: '2026-07-10T14:00:01.000Z',
      event: 'console-message',
      level: 'error',
      message: 'boom',
      lineNumber: 12,
      sourceId: 'app://renderer/index.js'
    })
    log.write({
      timestamp: '2026-07-10T14:00:02.000Z',
      event: 'console-message',
      level: 'warning',
      message: 'careful',
      lineNumber: 13,
      sourceId: 'app://renderer/index.js'
    })

    const levels = (await readFile(appLog.path, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).level)
    expect(levels).toEqual(['error', 'warn'])
  })
})
