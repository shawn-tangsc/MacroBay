/**
 * 产物溯源：`build-info.json` 随安装包一起分发，拿到一个 dmg / exe 不查 git 也能说出它出自哪个提交。
 *
 * 这份文件会公开：白名单里的字段全部都是仓库本来就公开的事实，或者 release 元数据的一部分。
 * 键集合由测试严格守住——多塞一个 `cwd` 不会报错，只会在某个用户的 issue 里被贴出来。
 */

export const BUILD_INFO_FILE_NAME = 'build-info.json'
export const BUILD_INFO_SCHEMA_VERSION = 1

/** 允许写进产物的字段，顺序即输出顺序。加字段必须同时改测试。 */
export const BUILD_INFO_KEYS = [
  'schemaVersion',
  'commit',
  'tag',
  'dirty',
  'version',
  'builtAt',
  'platform',
  'arch'
] as const

export type BuildInfoKey = (typeof BUILD_INFO_KEYS)[number]

export type BuildPlatform = 'darwin' | 'win32'
export type BuildArch = 'arm64' | 'x64'

export interface BuildInfo {
  schemaVersion: number
  /** 完整 40 位提交哈希：反查的核心。 */
  commit: string
  /** 不是从 tag 打出来的就写 `null`，不许拿分支名冒充。 */
  tag: string | null
  /** 工作区有未提交改动时为 `true`：这个包就不可复现，明说比藏起来好。 */
  dirty: boolean
  version: string
  builtAt: string
  platform: BuildPlatform
  arch: BuildArch
}

export interface BuildInfoSource {
  commit: string
  tag: string | null
  dirty: boolean
  version: string
  builtAt: Date
  platform: string
  arch: string
}

const COMMIT_PATTERN = /^[0-9a-f]{40}$/u

function describe(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function createBuildInfo(source: BuildInfoSource): BuildInfo {
  if (!COMMIT_PATTERN.test(source.commit)) {
    throw new Error(`build-info: commit must be a full 40-char sha, got ${describe(source.commit)}`)
  }
  if (source.platform !== 'darwin' && source.platform !== 'win32') {
    throw new Error(`build-info: unsupported platform ${describe(source.platform)}`)
  }
  if (source.arch !== 'arm64' && source.arch !== 'x64') {
    throw new Error(`build-info: unsupported arch ${describe(source.arch)}`)
  }
  if (!Number.isFinite(source.builtAt.getTime())) {
    throw new Error('build-info: builtAt is not a valid date')
  }
  return {
    schemaVersion: BUILD_INFO_SCHEMA_VERSION,
    commit: source.commit,
    tag: source.tag,
    dirty: source.dirty,
    version: source.version,
    // UTC 毫秒，与全库时间口径一致。
    builtAt: source.builtAt.toISOString(),
    platform: source.platform,
    arch: source.arch
  }
}

/**
 * 从产物里读回来。键集合必须**严格等于**白名单：多一个键就拒绝，
 * 否则「以后图方便塞一个路径进去」没有任何东西会拦。
 */
export function readBuildInfo(text: string): BuildInfo {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('build-info: not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('build-info: expected a JSON object')
  }
  const record = parsed as Record<string, unknown>
  const actual = Object.keys(record).sort()
  const expected: string[] = [...BUILD_INFO_KEYS].sort()
  const unexpected = actual.filter((key) => !expected.includes(key))
  if (unexpected.length > 0) {
    throw new Error(`build-info: field(s) outside the whitelist: ${unexpected.join(', ')}`)
  }
  const missing = expected.filter((key) => !actual.includes(key))
  if (missing.length > 0) {
    throw new Error(`build-info: missing field(s): ${missing.join(', ')}`)
  }
  if (record.schemaVersion !== BUILD_INFO_SCHEMA_VERSION) {
    throw new Error(`build-info: unsupported schemaVersion ${describe(record.schemaVersion)}`)
  }
  return record as unknown as BuildInfo
}
