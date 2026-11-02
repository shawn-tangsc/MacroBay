import { describe, expect, it } from 'vitest'

import {
  compareVersions,
  evaluateUpdateCheck,
  parseUpdateMetadata,
  parseVersion,
  projectUpdateCheckState,
  shouldIgnoreRemoteVersion,
  utcDayKeyOf,
  type ParsedVersion
} from './updateCheck'

function parseOrThrow(raw: string): ParsedVersion {
  const parsed = parseVersion(raw)
  if (parsed === null) throw new Error(`expected a parsable version, got ${JSON.stringify(raw)}`)
  return parsed
}

function compare(left: string, right: string): number {
  return compareVersions(parseOrThrow(left), parseOrThrow(right))
}

const checkedAt = '2026-11-03T00:10:00.000Z'

describe('version comparison', () => {
  it('compares numeric segments instead of the raw string', () => {
    // 字符串比较会得出 0.10.0 < 0.9.9，这正是这条用例存在的原因。
    expect(compare('0.10.0', '0.9.9')).toBe(1)
    expect(compare('0.9.9', '0.10.0')).toBe(-1)
    expect(compare('0.3.1', '0.3.1')).toBe(0)
  })

  it('treats a release as newer than its own prerelease', () => {
    expect(compare('0.4.0-alpha', '0.4.0')).toBe(-1)
    expect(compare('0.4.0', '0.4.0-alpha')).toBe(1)
    expect(compare('0.4.0-alpha.1', '0.4.0-alpha.2')).toBe(-1)
    // 短的预发布更小：alpha < alpha.1
    expect(compare('0.4.0-alpha', '0.4.0-alpha.1')).toBe(-1)
  })

  it('accepts the forms release tooling actually writes', () => {
    expect(compare('v0.4.0', '0.4.0')).toBe(0)
    expect(compare('0.4.0+build.7', '0.4.0')).toBe(0)
    // 前导零按数字比：只判「谁更新」，不判版式是否规范。
    expect(compare('0.09.9', '0.9.9')).toBe(0)
    // 段数不同时缺的段按 0 算。
    expect(compare('1.2', '1.2.0')).toBe(0)
    expect(compare('1.2.1', '1.2')).toBe(1)
  })

  it('refuses to guess when the version is not a version', () => {
    for (const raw of ['', '   ', 'latest', '1.2.x', '1..2', '1.2.3-', '-alpha', 'v']) {
      expect(parseVersion(raw), raw).toBeNull()
    }
  })
})

describe('release metadata parsing', () => {
  it('reads the top-level version of a real metadata file', () => {
    const text = [
      'version: 0.4.0',
      'files:',
      '  - url: MacroBay-arm64.dmg',
      '    sha512: abc',
      '    size: 192961905',
      'path: MacroBay-arm64.dmg',
      'releaseDate: 2026-11-02T15:00:00.000Z'
    ].join('\n')
    expect(parseUpdateMetadata(text)).toEqual({ version: '0.4.0' })
  })

  it('ignores indented, quoted, commented and CRLF lines', () => {
    expect(parseUpdateMetadata('version: "0.4.0"\r\npath: x\r\n')).toEqual({ version: '0.4.0' })
    expect(parseUpdateMetadata("# comment\nversion: '0.5.0'\n")).toEqual({ version: '0.5.0' })
    expect(parseUpdateMetadata('\uFEFFversion: 0.6.0\n')).toEqual({ version: '0.6.0' })
    // 嵌套在 files 里的同名字段不算顶层版本：这正是「只认顶层」要防的。
    expect(parseUpdateMetadata('files:\n  - version: 9.9.9\npath: x\n')).toBeNull()
  })

  it('treats missing or empty version as broken content, not as the current version', () => {
    expect(parseUpdateMetadata('')).toBeNull()
    expect(parseUpdateMetadata('path: MacroBay-x64-setup.exe\n')).toBeNull()
    expect(parseUpdateMetadata('version:\n')).toBeNull()
    expect(parseUpdateMetadata('version: ""\n')).toBeNull()
  })
})

describe('prerelease visibility', () => {
  it('hides every prerelease from a reader on a stable version', () => {
    expect(shouldIgnoreRemoteVersion(parseOrThrow('0.3.1'), parseOrThrow('0.4.0-alpha'))).toBe(true)
    expect(shouldIgnoreRemoteVersion(parseOrThrow('0.3.1'), parseOrThrow('0.4.0'))).toBe(false)
  })

  it('lets a reader on a prerelease see the next prerelease and the stable release', () => {
    expect(shouldIgnoreRemoteVersion(parseOrThrow('0.4.0-alpha'), parseOrThrow('0.5.0-alpha'))).toBe(false)
    expect(shouldIgnoreRemoteVersion(parseOrThrow('0.4.0-alpha'), parseOrThrow('0.4.0'))).toBe(false)
  })
})

describe('evaluating one check', () => {
  const base = { currentVersion: '0.3.1', checkedAt, lastSuccessAt: null }

  it('reports a newer version as available', () => {
    expect(evaluateUpdateCheck({ ...base, metadataText: 'version: 0.4.0\n' })).toEqual({
      status: 'available',
      latestVersion: '0.4.0',
      checkedAt
    })
  })

  it('reports the same or an older version as up to date', () => {
    expect(evaluateUpdateCheck({ ...base, metadataText: 'version: 0.3.1\n' })).toEqual({
      status: 'up-to-date',
      latestVersion: '0.3.1',
      checkedAt
    })
    expect(evaluateUpdateCheck({ ...base, metadataText: 'version: 0.2.2\n' })).toEqual({
      status: 'up-to-date',
      latestVersion: '0.3.1',
      checkedAt
    })
  })

  it('ignores a hidden prerelease instead of reporting it', () => {
    expect(evaluateUpdateCheck({ ...base, metadataText: 'version: 0.4.0-alpha\n' })).toEqual({
      status: 'up-to-date',
      latestVersion: '0.3.1',
      checkedAt
    })
  })

  it('answers "cannot tell" instead of "up to date" when the content is broken', () => {
    const broken = evaluateUpdateCheck({ ...base, metadataText: 'path: MacroBay-x64-setup.exe\n' })
    expect(broken).toMatchObject({ status: 'unavailable', reason: 'invalid-metadata' })

    const unparsable = evaluateUpdateCheck({ ...base, metadataText: 'version: not-a-version\n' })
    expect(unparsable).toMatchObject({ status: 'unavailable', reason: 'invalid-metadata' })

    // 我们自己这版号解析不出来，同样不许猜。
    const oddCurrent = evaluateUpdateCheck({ ...base, currentVersion: 'dev', metadataText: 'version: 0.4.0\n' })
    expect(oddCurrent).toMatchObject({ status: 'unavailable', reason: 'invalid-metadata' })
  })

  it('carries the last successful check so the row can say when it last worked', () => {
    const result = evaluateUpdateCheck({
      currentVersion: '0.3.1',
      metadataText: 'not: a release file\n',
      checkedAt,
      lastSuccessAt: '2026-11-02T09:00:00.000Z'
    })
    expect(result).toEqual({
      status: 'unavailable',
      reason: 'invalid-metadata',
      checkedAt,
      lastSuccessAt: '2026-11-02T09:00:00.000Z'
    })
  })

  it('reports a platform without release metadata as unsupported, not as a failed download', () => {
    expect(evaluateUpdateCheck({ ...base, metadataText: null })).toMatchObject({
      status: 'unavailable',
      reason: 'unsupported-platform'
    })
  })
})

describe('the UTC day bucket', () => {
  it('puts two instants of the same UTC day in one bucket even across midnight locally', () => {
    expect(utcDayKeyOf('2026-11-02T23:50:00.000Z')).toBe('2026-11-02')
    expect(utcDayKeyOf('2026-11-03T00:10:00.000Z')).toBe('2026-11-03')
    expect(utcDayKeyOf('2026-11-02T00:00:00.000Z')).toBe('2026-11-02')
  })

  it('returns null for an unreadable instant so a bad value cannot freeze checks forever', () => {
    expect(utcDayKeyOf('not-a-time')).toBeNull()
    expect(utcDayKeyOf('')).toBeNull()
  })
})

describe('what the settings row reads', () => {
  it('keeps "no capability", "not checked yet" and "cannot tell" apart', () => {
    const development = projectUpdateCheckState({ mode: 'development', currentVersion: '0.3.1', result: null })
    const idle = projectUpdateCheckState({ mode: 'packaged', currentVersion: '0.3.1', result: null })
    const unavailable = projectUpdateCheckState({
      mode: 'packaged',
      currentVersion: '0.3.1',
      result: { status: 'unavailable', reason: 'offline', checkedAt, lastSuccessAt: null }
    })

    expect(development).toEqual({ state: 'development' })
    expect(idle).toEqual({ state: 'idle', currentVersion: '0.3.1' })
    // 开发态不能带出版本号：它就是靠「什么都没有」跟「还没检查」一眼分开的。
    expect(development).not.toHaveProperty('currentVersion')
    // 「上次检查」配的是这一次尝试的时刻；上一次成功的时刻不进界面（只留在结论里排查用）。
    expect(unavailable).toEqual({ state: 'unavailable', currentVersion: '0.3.1', checkedAt })
  })

  it('drops the internal reason code on the way to the row', () => {
    const projection = projectUpdateCheckState({
      mode: 'packaged',
      currentVersion: '0.3.1',
      result: { status: 'unavailable', reason: 'proxy-failed', checkedAt, lastSuccessAt: null }
    })
    // 原因码只进日志；带上它会诱使界面把它翻译成第二句话。
    expect(projection).not.toHaveProperty('reason')
  })

  it('projects the two settled conclusions with the versions the row shows', () => {
    expect(
      projectUpdateCheckState({
        mode: 'packaged',
        currentVersion: '0.3.1',
        result: { status: 'available', latestVersion: '0.4.0', checkedAt }
      })
    ).toEqual({ state: 'available', currentVersion: '0.3.1', latestVersion: '0.4.0', checkedAt })

    expect(
      projectUpdateCheckState({
        mode: 'packaged',
        currentVersion: '0.3.1',
        result: { status: 'up-to-date', latestVersion: '0.3.1', checkedAt }
      })
    ).toEqual({ state: 'up-to-date', currentVersion: '0.3.1', latestVersion: '0.3.1', checkedAt })
  })
})
