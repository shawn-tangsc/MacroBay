import { describe, expect, it } from 'vitest'

import { BUILD_INFO_KEYS, createBuildInfo, readBuildInfo, type BuildInfoSource } from './buildInfo'

const COMMIT = 'a'.repeat(40)

function source(overrides: Partial<BuildInfoSource> = {}): BuildInfoSource {
  return {
    commit: COMMIT,
    tag: 'v0.3.1',
    dirty: false,
    version: '0.3.1',
    builtAt: new Date('2026-11-01T11:20:00.000Z'),
    platform: 'darwin',
    arch: 'arm64',
    ...overrides
  }
}

describe('build info', () => {
  it('writes exactly the whitelisted fields, so nothing else can ride along', () => {
    const info = createBuildInfo(source())
    // 严格相等，不是「包含」：多一个键（比如 cwd、HOME、用户名）在这里就红。
    expect(Object.keys(info).sort()).toEqual([...BUILD_INFO_KEYS].sort())
  })

  it('keeps dirty true when the tree is dirty instead of omitting it', () => {
    const info = createBuildInfo(source({ dirty: true }))
    expect(info.dirty).toBe(true)
    expect(readBuildInfo(JSON.stringify(info))).toEqual(info)
  })

  it('records a null tag when the build did not come from a tag', () => {
    expect(createBuildInfo(source({ tag: null })).tag).toBeNull()
  })

  it('refuses an abbreviated commit: provenance that cannot be resolved is not provenance', () => {
    expect(() => createBuildInfo(source({ commit: 'abc1234' }))).toThrow(/40-char sha/u)
  })

  it('refuses platforms and architectures the packaging contract does not ship', () => {
    expect(() => createBuildInfo(source({ platform: 'linux' }))).toThrow(/unsupported platform/u)
    expect(() => createBuildInfo(source({ arch: 'ia32' }))).toThrow(/unsupported arch/u)
  })

  it('rejects a file carrying an extra field when read back', () => {
    const info = createBuildInfo(source())
    const polluted = JSON.stringify({ ...info, cwd: '/Users/someone/project' })
    expect(() => readBuildInfo(polluted)).toThrow(/outside the whitelist: cwd/u)
  })

  it('rejects a file with a missing field or an unknown schema version', () => {
    const info = createBuildInfo(source())
    const { arch: _arch, ...withoutArch } = info
    expect(() => readBuildInfo(JSON.stringify(withoutArch))).toThrow(/missing field\(s\): arch/u)
    expect(() => readBuildInfo(JSON.stringify({ ...info, schemaVersion: 2 }))).toThrow(/unsupported schemaVersion/u)
  })
})
