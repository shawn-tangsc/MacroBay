import { readFile } from 'node:fs/promises'

import { writeJsonFileAtomically } from '@platform/storage/jsonFileStorage'

/**
 * 「某个指标用不用某个源」——**第二层配置**，与源自己的启停（总闸）完全分开。
 *
 * 两层管两件事（Chief 2026-11-14）：源 profile 那颗是「这个源采不采」，这里这颗是「这个指标用不用它」；
 * 源照采、只是这个指标不再从它取数。两处写同一处就等于把两层合并成一层，这页就没有存在意义了。
 *
 * 三条口径（架构师 2026-11-14）：
 * - **不进注册表**：这是读者偏好，不是源的事实；`readiness` / `visibility` 不许受它影响；
 * - **只记「关」，缺行即开**：文档里只存被读者关掉的那些键。这样新增指标或新增源时，缺行按开处理，
 *   读者不会一觉醒来发现新指标全是空的——默认全开就是这么落地的，不靠初始化脚本填满一张表；
 * - **退休源的配置要忽略，不是保留生效**：读取时按当前注册表过滤，死配置不影响「这个指标还有没有腿」。
 *
 * 文档形状：`{ version, disabled: { "<metricKey>|<providerId>": true } }`。读不懂的字段原样保留。
 */
export type CoreIndicatorSourcePrefs = Readonly<{
  /** 只返回**被显式关掉**的键；缺键由调用方按「开」解释。 */
  readDisabled: () => Promise<Record<string, boolean>>
  /** 写一个键的开/关；`enabled: true` 就是把键删掉（缺键即开），不写 `false` 进去。 */
  setSourceEnabled: (preferenceKey: string, enabled: boolean) => Promise<void>
}>

/* 键的拼法在纯模块里（渲染层也要用，不许经这里把 node:fs 带进浏览器包）。 */
export { coreIndicatorSourcePreferenceKey } from '../macro-calendar/coreIndicatorSourcePreferenceKey'

type RawDocument = Record<string, unknown>

function isPlainObject(value: unknown): value is RawDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readRaw(filePath: string): Promise<RawDocument> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    // 没写过 / 读不懂都按「没有显式设置」处理；**不在这里回写**，读路径永远只读。
    return {}
  }
}

function explicitDisabled(raw: RawDocument): Record<string, boolean> {
  const disabled = raw.disabled
  if (!isPlainObject(disabled)) return {}
  const result: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(disabled)) {
    // 只有 `true` 表示关；其它形状是「读不懂」，留在文档里、不进读结果（缺键按开）。
    if (value === true) result[key] = true
  }
  return result
}

function nextVersion(raw: RawDocument): number {
  const current = raw.version
  return (typeof current === 'number' && Number.isInteger(current) && current >= 0 ? current : 0) + 1
}

export function createCoreIndicatorSourcePrefsStore(filePath: string): CoreIndicatorSourcePrefs {
  /** 串行化写入：同一次点击里的并发写不能互相覆盖（都是「读整份 → 改一键 → 写回」）。 */
  let queue: Promise<unknown> = Promise.resolve()

  const write = async (preferenceKey: string, enabled: boolean): Promise<void> => {
    const raw = await readRaw(filePath)
    const disabled = isPlainObject(raw.disabled) ? { ...raw.disabled } : {}
    const isDisabled = disabled[preferenceKey] === true
    // 同值重复写：不产生新版本、不动文件。
    if (enabled ? !isDisabled : isDisabled) return
    if (enabled) delete disabled[preferenceKey]
    else disabled[preferenceKey] = true
    await writeJsonFileAtomically(filePath, { ...raw, version: nextVersion(raw), disabled })
  }

  return {
    async readDisabled() {
      return explicitDisabled(await readRaw(filePath))
    },
    setSourceEnabled(preferenceKey, enabled) {
      const run = queue.then(() => write(preferenceKey, enabled))
      // 队列本身不能吞掉这次失败：调用方要拿到；只是后续写不被它卡住。
      queue = run.catch(() => undefined)
      return run
    }
  }
}

/**
 * 读侧那把尺子：**按当前注册表过滤**后再回答「这个指标还有没有可用的腿」。
 *
 * 退休源（例如已删掉的旧源）留在文档里的记录一律忽略——它读不到，留着也不该让
 * 「这个指标还有腿」这句话变成假话。`availableKeys` 由调用方从派生表 + 注册表给出。
 */
export function enabledValueSources(
  availableKeys: readonly string[],
  disabled: Readonly<Record<string, boolean>>
): readonly string[] {
  return availableKeys.filter((key) => disabled[key] !== true)
}
