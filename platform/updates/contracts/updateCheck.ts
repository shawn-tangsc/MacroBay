/**
 * 更新检查的契约与纯函数：**这里不碰网络、不碰时钟、不碰文件系统**。
 *
 * 分成两半，别混：
 *
 * - **一次检查的结论**（`UpdateCheckResult`）只由「查询」产生。打开下载页成功还是失败，
 *   绝不写进这里——写进去等于用一次打开失败换掉一条已知的版本信息，读者下次打开设置会看到
 *   「暂时查不到」，而我们明明查到了。
 * - **界面读到的投影**（`UpdateCheckProjection`）多出两个值：`development`（能力不存在）与
 *   `idle`（能查但还没查）。两者与 `unavailable`（查了没查到）**不许互相冒充**：拿「没查过」
 *   冒充开发态是「拿不到 ≠ 没有」的老毛病，反过来把开发态画成「还没检查」会让读者以为等会儿就好。
 */

/** 解析后的版本号：数字段 + 可选的预发布标识段。 */
export type ParsedVersion = {
  numbers: readonly number[]
  /** `null` 表示正式版；否则是 `-alpha.1` 这种后缀拆出来的标识段。 */
  prerelease: readonly string[] | null
}

const versionPattern = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u

/**
 * 解析版本号。**解析不出来就是解析不出来**，不猜：调用方一律按「查不到」处理。
 *
 * 细节选择（有意的，不是漏写）：
 * - 允许 `v` 前缀与 `+build` 元数据（发布工具会这么写），比较时都丢掉；
 * - 允许 1~4 段数字（本仓版本是 `0.3.1` 三段式，但历史版本可能两段）；
 * - **前导零按数字比较**（`0.09.9` 等于 `0.9.9`）：这里只做「谁更新」的判断，不需要严格规范版式。
 */
export function parseVersion(raw: string): ParsedVersion | null {
  const match = versionPattern.exec(raw.trim())
  if (!match) return null
  const numbers = match[1].split('.').map((part) => Number(part))
  if (numbers.some((value) => !Number.isSafeInteger(value))) return null
  const prerelease = match[2] ? match[2].split('.') : null
  if (prerelease?.some((part) => part.length === 0)) return null
  return { numbers, prerelease }
}

/** 逐段比数字：`0.10.0 > 0.9.9`（按字符串比会得出反的结论，这条是单测守着的边界）。 */
export function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  const length = Math.max(left.numbers.length, right.numbers.length)
  for (let index = 0; index < length; index += 1) {
    const a = left.numbers[index] ?? 0
    const b = right.numbers[index] ?? 0
    if (a !== b) return a < b ? -1 : 1
  }
  if (left.prerelease === null && right.prerelease === null) return 0
  // 同一 base 时正式版更新：`0.4.0-alpha < 0.4.0`。
  if (left.prerelease === null) return 1
  if (right.prerelease === null) return -1
  return comparePrereleaseIdentifiers(left.prerelease, right.prerelease)
}

function comparePrereleaseIdentifiers(left: readonly string[], right: readonly string[]): number {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index]
    const b = right[index]
    // 短的那个更小：`alpha < alpha.1`
    if (a === undefined) return -1
    if (b === undefined) return 1
    const aNumeric = /^\d+$/u.test(a)
    const bNumeric = /^\d+$/u.test(b)
    if (aNumeric && bNumeric) {
      const diff = Number(a) - Number(b)
      if (diff !== 0) return diff < 0 ? -1 : 1
      continue
    }
    // 数字标识低于字母标识（语义化版本规则）。
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

export function isPrereleaseVersion(version: ParsedVersion): boolean {
  return version.prerelease !== null
}

/**
 * 预发布可见规则：**当前版本没有预发布后缀时，远端带后缀的版本一律忽略**。
 *
 * 为什么：发布流水线每个版本都是正式 release（`gh release create` 没带 `--prerelease`），发布页的固定
 * 下载地址就指向它——所以正在用正式版的人会看到 alpha，而他不该被提示去装 alpha。
 * 反过来，正在用 alpha 的人应当能看到新的 alpha。
 */
export function shouldIgnoreRemoteVersion(current: ParsedVersion, remote: ParsedVersion): boolean {
  return !isPrereleaseVersion(current) && isPrereleaseVersion(remote)
}

/** 元数据只取一个字段；解析不出 `version` 就是坏内容，按「查不到」处理。 */
export type UpdateMetadata = { version: string }

/**
 * 解析发布元数据（`latest*.yml`）。
 *
 * 只认**顶层**的 `version`：文件里还有 `files:`、`path:` 等字段，其中嵌套的同名键不算数；
 * 忽略空行、注释、文档分隔符与缩进行。这不是通用 YAML 解析器，也**不该**长成通用解析器——
 * 我们只需要一个字段。
 */
export function parseUpdateMetadata(text: string): UpdateMetadata | null {
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/^\uFEFF/u, '')
    if (line.trim().length === 0) continue
    if (line.trimStart().startsWith('#')) continue
    if (/^\s/u.test(line)) continue // 嵌套字段：不属于顶层
    if (line.trim() === '---') continue
    const separator = line.indexOf(':')
    if (separator < 0) continue
    const key = line.slice(0, separator).trim()
    if (key !== 'version') continue
    const value = unquote(line.slice(separator + 1).trim())
    return value.length > 0 ? { version: value } : null
  }
  return null
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1)
  }
  return value
}

/**
 * 手动连点冷却：1 分钟内再点**不发请求**，直接返回上次结果。
 *
 * 放在契约里而不是服务里，是因为界面也要用它决定「刚查过」显示多久——两边必须是同一个数，
 * 各写一份就会出现「按钮已经说刚查过，主进程又发了请求」这种对不上的情况。
 */
export const manualCooldownMs = 60_000

/** 内部原因码：**只进日志**。读者看到的只有「暂时查不到」，原因对读者没有动作价值。 */
export const updateCheckFailureReasons = [
  'offline',
  'proxy-failed',
  'not-found',
  'invalid-metadata',
  'unsupported-platform'
] as const

export type UpdateCheckFailureReason = (typeof updateCheckFailureReasons)[number]

/** 一次检查的结论。`checkedAt` 是这次尝试发生的时刻（ISO UTC）。 */
export type UpdateCheckResult =
  | { status: 'up-to-date'; latestVersion: string; checkedAt: string }
  | { status: 'available'; latestVersion: string; checkedAt: string }
  | { status: 'unavailable'; reason: UpdateCheckFailureReason; checkedAt: string; lastSuccessAt: string | null }

export function unavailableUpdateCheck(
  reason: UpdateCheckFailureReason,
  checkedAt: string,
  lastSuccessAt: string | null
): UpdateCheckResult {
  return { status: 'unavailable', reason, checkedAt, lastSuccessAt }
}

export type UpdateCheckEvaluationInput = Readonly<{
  /** 当前应用版本；由组合根从宿主取来传入，服务内部不许直接问系统。 */
  currentVersion: string
  /** 平台没有对应元数据文件时传 `null`（不是「下载失败」）。 */
  metadataText: string | null
  checkedAt: string
  lastSuccessAt: string | null
}>

/**
 * 把「远端文本 + 当前版本」判成一个结论。纯函数：同样的输入永远同样的输出，单测不需要网络和时钟。
 */
export function evaluateUpdateCheck(input: UpdateCheckEvaluationInput): UpdateCheckResult {
  const { currentVersion, metadataText, checkedAt, lastSuccessAt } = input
  if (metadataText === null) return unavailableUpdateCheck('unsupported-platform', checkedAt, lastSuccessAt)

  const current = parseVersion(currentVersion)
  if (current === null) return unavailableUpdateCheck('invalid-metadata', checkedAt, lastSuccessAt)

  const metadata = parseUpdateMetadata(metadataText)
  if (metadata === null) return unavailableUpdateCheck('invalid-metadata', checkedAt, lastSuccessAt)

  const remote = parseVersion(metadata.version)
  if (remote === null) return unavailableUpdateCheck('invalid-metadata', checkedAt, lastSuccessAt)

  // 不可见的版本按「忽略」处理：忽略之后能装的还是当前这版，所以说「已是最新」是诚实的。
  if (shouldIgnoreRemoteVersion(current, remote)) {
    return { status: 'up-to-date', latestVersion: currentVersion, checkedAt }
  }
  return compareVersions(remote, current) > 0
    ? { status: 'available', latestVersion: trimVersion(metadata.version), checkedAt }
    : { status: 'up-to-date', latestVersion: currentVersion, checkedAt }
}

/** 界面上显示的版本号保留远端写法（只去掉 `v` 前缀），不在这里重排格式。 */
function trimVersion(raw: string): string {
  return raw.trim().replace(/^v+/iu, '')
}

/**
 * 「同一个 UTC 自然日」的日桶键。读者看不见的记账一律按 UTC（改时区不能刷额度）。
 * 传进来的必须是能解析的时刻；解析不出来回 `null`，调用方按「没有日桶」处理（宁可多查一次，
 * 也不要因为坏值把检查永久卡住）。
 */
export function utcDayKeyOf(instant: string): string | null {
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return null
  const iso = date.toISOString()
  return iso.slice(0, 10)
}

/**
 * 界面读到的投影：三种查询结论 + 「不是结论」的 `idle`。
 *
 * **没有 `development` 这一态**（11-03 用户改的口径）：开发态也能真查、真出结论，所以「开发态」
 * 不是一种查询结果，`mode` 只决定**自动检查跑不跑**。界面因此只有一种画法，不再按「装没装」分叉——
 * 分叉最容易变成「开发版里看不到、装好的包里第一次见」。
 */
export type UpdateCheckProjection =
  | { state: 'idle'; currentVersion: string }
  | { state: 'up-to-date'; currentVersion: string; latestVersion: string; checkedAt: string }
  | { state: 'available'; currentVersion: string; latestVersion: string; checkedAt: string }
  /**
   * 「暂时查不到」。带的是**这一次**尝试的时刻（`checkedAt`），不是上一次成功的时刻：
   * 这一行要说的是「它到底试过没有」，读者问的也是这个。显示上次成功会让人以为刚才那次成功了。
   * `lastSuccessAt` 仍留在结论里供排查，**不进界面**。
   */
  | { state: 'unavailable'; currentVersion: string; checkedAt: string }

/**
 * 投影只有一个入口：拿「当前版本 + 上次结论」判出一个读者能看到的状态。
 * 原因码在这一步被丢掉——它只属于日志。
 *
 * **「有新版本 / 已是最新」这个结论每次现算，不许信存下来的那个词。**
 * 为什么（2026-11-03 撞出来的真问题）：结论会连同「上次取到的最新版本」写进文件，**下次启动直接读**，
 * 而「当前版本」是每次现算的。两者一旦错位，界面就说假话——两个方向都撞到过：
 * 「当前 0.3.0 / 最新 0.3.1，药丸却说已是最新」、「当前 0.3.1 / 最新 0.3.1，药丸却说有新版本」。
 * 所以这里用**同一个比较函数**把两边的版本再判一次：存下来的只是一份「远端是什么版本」的记忆，
 * 不是一句判决。
 */
export function projectUpdateCheckState(input: Readonly<{
  currentVersion: string
  result: UpdateCheckResult | null
}>): UpdateCheckProjection {
  const { result, currentVersion } = input
  if (result === null) return { state: 'idle', currentVersion }
  switch (result.status) {
    case 'unavailable':
      return { state: 'unavailable', currentVersion, checkedAt: result.checkedAt }
    case 'up-to-date':
    case 'available': {
      const current = parseVersion(currentVersion)
      const known = parseVersion(result.latestVersion)
      // 版本号解析不出来时退回存下来的结论：宁可沿用上次的判断，也不要因为坏值把这一行做没。
      if (current === null || known === null) {
        return { state: result.status, currentVersion, latestVersion: result.latestVersion, checkedAt: result.checkedAt }
      }
      return compareVersions(known, current) > 0
        ? { state: 'available', currentVersion, latestVersion: result.latestVersion, checkedAt: result.checkedAt }
        // 已是最新时「最新版本」就是当前版本：两格写同一个数，读者才对得上。
        : { state: 'up-to-date', currentVersion, latestVersion: currentVersion, checkedAt: result.checkedAt }
    }
  }
}
