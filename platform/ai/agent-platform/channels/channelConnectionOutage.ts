/**
 * 「频道连不上」的判定（契约 §4.1 第 16 行 P8）：**自动重连失败之后**才算断线，重试过程不算。
 *
 * 轮询循环本身就是自动重连——每次失败都会排下一次尝试，所以「重连失败」在代码里唯一的含义是
 * **连着失败了一段时间**。第 1 次失败就报，断网一分钟能刷几十条（产品口径原话：那就又变成噪声）。
 *
 * **阈值是时长，不是次数**（需求 v2.17 §11 第 8 条，2026-11-04 复审定的）：合盖唤醒、切 Wi-Fi、
 * 代理重连抖一下，几秒内就能凑够两三次失败，按次数判就会为一次假断线弹桌面 + 记一条中心——
 * 用户原话是「没打开应用还被轰炸，很烦」。所以从断开那一刻起**持续 30 秒**还没接上才算断线；
 * 失败次数只留作诊断，不参与判定。
 *
 * 同一次断开**只报一次**：报过之后继续失败也不再报，靠 `reported` 挡住。任何一次成功拉取都算恢复，
 * 清空重来；下一次断开从 1 重新数、带新的断开时刻——去重键里含断开起始时刻，所以那是新的一条记录，
 * 这是契约要的粒度（一次断开一条，不是一条频道一条）。
 *
 * 这里只数次数、不认平台、不碰文案：判定与提交分开，才测得动，也才不用为了测它起一个轮询循环。
 */
/** 从断开那一刻起持续这么久还没接上才算「这条频道真的收不到消息了」。 */
export const CHANNEL_OFFLINE_REPORT_AFTER_MS = 30_000

/** 原因只有两档（产品口径 §11.3）：网络连不上 / 代理这一跳没连上。没有第三档。 */
export type ChannelConnectionCause = 'network' | 'proxy'

/** 该提交一条「频道连不上」了；`disconnectedAt` 是这次断开的第一刻（毫秒）。 */
export type ChannelConnectionOutageReport = { disconnectedAt: number }

export class ChannelConnectionOutage {
  private disconnectedAt: number | null = null
  private failures = 0
  private reported = false

  /** 连续失败了几次：**只作诊断**（进失败日志），不参与判定——判定按断开时长。 */
  get attempts(): number {
    return this.failures
  }

  /** 记一次「连不上」的失败；断开满 30 秒时返回要提交的那一份，同一次断开只返回一次。 */
  recordFailure(nowMs: number): ChannelConnectionOutageReport | null {
    if (this.disconnectedAt === null) {
      this.disconnectedAt = nowMs
      this.failures = 1
      this.reported = false
      return null
    }
    this.failures += 1
    if (this.reported) return null
    if (nowMs - this.disconnectedAt < CHANNEL_OFFLINE_REPORT_AFTER_MS) return null
    this.reported = true
    return { disconnectedAt: this.disconnectedAt }
  }

  /** 任何一次成功拉取都算恢复（哪怕没有新消息）：下一次断开是另一件事。 */
  recordSuccess(): void {
    this.disconnectedAt = null
    this.failures = 0
    this.reported = false
  }
}

/**
 * 这个失败码算不算「连不上」。只有两档传输层失败算：网络不可达、代理这一跳不通。
 *
 * 其余（`telegram-rate-limited` 让我们慢一点、`telegram-conflict` 有另一个进程在收、
 * `telegram-provider-rejected` token 被拒）都**不是连不上**：把它们算进来，用户会收到一句
 * 「网络连不上」而去查网络，真正要修的是别处——凭据那条另有 P4a 负责。
 */
export function connectionCauseOfCode(code: string | undefined): ChannelConnectionCause | null {
  if (code === 'telegram-proxy-unavailable') return 'proxy'
  if (code === 'telegram-network-unavailable') return 'network'
  return null
}

/** 同一个码翻成人话分类，写进审计摘要用（不进通知正文）。 */
export function connectionCauseCode(cause: ChannelConnectionCause): string {
  return cause === 'proxy' ? 'telegram-proxy-unavailable' : 'telegram-network-unavailable'
}
