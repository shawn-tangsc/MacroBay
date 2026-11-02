import type { JsonFileStorage } from '../../storage/jsonFileStorage'
import {
  evaluateUpdateCheck,
  manualCooldownMs,
  projectUpdateCheckState,
  unavailableUpdateCheck,
  updateCheckFailureReasons,
  utcDayKeyOf,
  type UpdateCheckFailureReason,
  type UpdateCheckProjection,
  type UpdateCheckResult
} from '../contracts/updateCheck'
import { updateMetadataUrl } from '../updateSource'
import {
  createEmptyUpdateCheckState,
  normalizeUpdateCheckState,
  type StoredUpdateCheckState
} from './updateCheckState'

/** 启动后先让首屏和网络高峰过去，再查一次（§4）。 */
export const autoCheckDelayMs = 15_000
/** 单次请求的上限；超时就按「暂时查不到」处理，不许把界面挂住。 */
export const updateCheckTimeoutMs = 10_000

export type UpdateCheckMode = 'packaged' | 'development'
export type UpdateCheckTrigger = 'auto' | 'manual'

/**
 * 服务只通过这个口子拿外界事实。**三样必须来自组合根**：当前版本、出网、时钟。
 * 为什么是硬要求：只要一样从系统直接问来，单测就只能测出「已是最新」，
 * 「有新版本」那条主路径永远没人走过（改一版也测不出来）。
 *
 * 这个模块**不 import electron**：模式由组合根判一次传进来，判据只有 `app.isPackaged`。
 */
export type UpdateCheckServicePorts = Readonly<{
  mode: UpdateCheckMode
  /** 当前应用版本（`app.getVersion()` 由组合根取来传入）。 */
  currentVersion: string
  /** `process.platform`；决定读哪一份元数据文件，这是本功能唯一的平台分支。 */
  platform: string
  storage: JsonFileStorage<StoredUpdateCheckState>
  /** 平台出网适配器（`getPlatformFetch()`），必须走代理；禁止裸 fetch。 */
  fetch: typeof fetch
  now: () => Date
  /** 自动检查开关（`updates.checkEnabled`）。关掉时**一次请求都不发**。 */
  isCheckEnabled: () => Promise<boolean>
  log: (level: 'info' | 'warn', event: string, fields?: Record<string, unknown>) => void
}>

export type UpdateCheckService = {
  /** 当前投影；只读内存，不触网、不读盘。开发态永远返回 `development`。 */
  getProjection: () => UpdateCheckProjection
  /** 自动（`auto`）或手动（`manual`）查一次。闸门都在这里，调用方不需要先判。 */
  checkNow: (trigger?: UpdateCheckTrigger) => Promise<UpdateCheckProjection>
}

export async function createUpdateCheckService(ports: UpdateCheckServicePorts): Promise<UpdateCheckService> {
  let state = normalizeUpdateCheckState(await readState(ports))
  let inFlight: Promise<UpdateCheckProjection> | null = null

  if (ports.mode === 'development') {
    // 这是一句设计说明，不是故障：源码启动没有更新能力，所以不记 error。
    ports.log('info', 'update.check.disabled', { reason: 'development' })
  }

  function projection(): UpdateCheckProjection {
    return projectUpdateCheckState({ mode: ports.mode, currentVersion: ports.currentVersion, result: state.lastResult })
  }

  async function persist(): Promise<void> {
    try {
      await ports.storage.write(state)
    } catch (error) {
      // 记账写不进去不该让一次检查崩掉；代价是当天可能多查一次，这比让读者看到崩溃好。
      ports.log('warn', 'update.check.state-write-failed', { message: errorMessage(error) })
    }
  }

  async function fetchAndEvaluate(nowIso: string): Promise<UpdateCheckResult> {
    const url = updateMetadataUrl(ports.platform)
    if (url === null) {
      return unavailableUpdateCheck('unsupported-platform', nowIso, state.lastSuccessAt)
    }

    let response: Response
    try {
      response = await ports.fetch(url, {
        signal: AbortSignal.timeout(updateCheckTimeoutMs),
        headers: { accept: 'text/yaml, text/plain, */*' }
      })
    } catch (error) {
      return unavailableUpdateCheck(failureReasonForError(error), nowIso, state.lastSuccessAt)
    }

    if (!response.ok) {
      const reason: UpdateCheckFailureReason = response.status === 404 || response.status === 410 ? 'not-found' : 'offline'
      return unavailableUpdateCheck(reason, nowIso, state.lastSuccessAt)
    }

    let text: string
    try {
      text = await response.text()
    } catch (error) {
      return unavailableUpdateCheck(failureReasonForError(error), nowIso, state.lastSuccessAt)
    }

    return evaluateUpdateCheck({
      currentVersion: ports.currentVersion,
      metadataText: text,
      checkedAt: nowIso,
      lastSuccessAt: state.lastSuccessAt
    })
  }

  async function perform(trigger: UpdateCheckTrigger): Promise<UpdateCheckProjection> {
    if (ports.mode !== 'packaged') {
      // 开发态这条通道根本不注册；真被调用是程序错，不装成「查不到」。
      throw new Error('update check is not available in development mode')
    }

    const now = ports.now()
    const nowIso = now.toISOString()

    if (trigger === 'manual') {
      const lastManual = state.lastManualCheckedAt === null ? null : new Date(state.lastManualCheckedAt).getTime()
      const waited = lastManual === null ? Number.POSITIVE_INFINITY : now.getTime() - lastManual
      // 冷却中直接给上次结果：**不发请求、也不延长冷却**。时钟回拨（负数）不算冷却。
      if (waited >= 0 && waited < manualCooldownMs) return projection()
    } else {
      if (!(await ports.isCheckEnabled())) return projection()
      const today = utcDayKeyOf(nowIso)
      // 同一个 UTC 自然日只自动查一次：这一天已经记过账就跳过，一个请求都不发。
      if (today !== null && state.autoCheckedOnUtcDay === today) return projection()
    }

    // **先记账再发请求**：请求卡住、超时或进程被杀，当天都不会反复出网。
    if (trigger === 'manual') {
      state.lastManualCheckedAt = nowIso
    } else {
      const today = utcDayKeyOf(nowIso)
      if (today !== null) state.autoCheckedOnUtcDay = today
    }
    state.lastCheckedAt = nowIso
    await persist()

    const result = await fetchAndEvaluate(nowIso)
    state.lastCheckedAt = nowIso
    state.lastResult = result
    if (result.status !== 'unavailable') state.lastSuccessAt = result.checkedAt
    await persist()

    ports.log('info', 'update.check.finished', {
      trigger,
      status: result.status,
      // 原因码只进日志，不进界面：读者对「为什么没查到」没有动作可做。
      ...(result.status === 'unavailable' ? { reason: result.reason } : { latestVersion: result.latestVersion })
    })
    return projection()
  }

  return {
    getProjection: projection,
    checkNow(trigger: UpdateCheckTrigger = 'manual') {
      if (inFlight !== null) return inFlight
      const started = perform(trigger).finally(() => {
        inFlight = null
      })
      inFlight = started
      return started
    }
  }
}

async function readState(ports: UpdateCheckServicePorts): Promise<StoredUpdateCheckState> {
  try {
    return await ports.storage.read()
  } catch (error) {
    // 文件坏了不能把功能变成「永远查不到」：退回空记账，下一次照常查。
    ports.log('warn', 'update.check.state-read-failed', { message: errorMessage(error) })
    return createEmptyUpdateCheckState()
  }
}

function failureReasonForError(error: unknown): UpdateCheckFailureReason {
  const message = errorMessage(error)
  // 代理不通在 Chromium 网络栈里只能靠错误文本区分，区分不出来就算离线——两者在界面上是同一句话。
  return /proxy/iu.test(message) ? 'proxy-failed' : 'offline'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 供日志与测试引用：原因码集合只有这一份。 */
export const updateCheckReasons = updateCheckFailureReasons
