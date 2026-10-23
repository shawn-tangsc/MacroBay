import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import { installStdioBrokenPipeGuard } from './stdioBrokenPipeGuard'

describe('installStdioBrokenPipeGuard', () => {
  it('swallows stdout and stderr EPIPE errors from detached log pipes', () => {
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()

    installStdioBrokenPipeGuard({ stdout, stderr })

    expect(() => stdout.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).not.toThrow()
    expect(() => stderr.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).not.toThrow()
  })

  it('does not swallow non-EPIPE stream errors', () => {
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()

    installStdioBrokenPipeGuard({ stdout, stderr })

    expect(() => stdout.emit('error', Object.assign(new Error('boom'), { code: 'EINVAL' }))).toThrow('boom')
  })
})
