import { describe, expect, it } from 'vitest'

import {
  CHANNEL_OFFLINE_REPORT_AFTER_MS,
  ChannelConnectionOutage,
  connectionCauseOfCode
} from './channelConnectionOutage'

/**
 * P8 判定（需求 v2.17 §11.1–§11.2、第 8 条）：**断开满 30 秒才算断线**，重试过程一次都不提交，
 * 同一次断开只留一条。阈值按**时长**不按次数——几秒内的两三次失败只是抖动（合盖唤醒、切 Wi-Fi、
 * 代理重连），按次数判就会为一次假断线弹桌面 + 记一条中心。
 */
describe('channel connection outage', () => {
  it('waits 30 seconds of downtime, not three failed attempts', () => {
    const outage = new ChannelConnectionOutage()
    expect(CHANNEL_OFFLINE_REPORT_AFTER_MS).toBe(30_000)
    expect(outage.recordFailure(1_000)).toBeNull()
    expect(outage.recordFailure(2_000)).toBeNull()
    // 7 秒内连失败 3 次——旧口径会在这里报一条，那是假断线。
    expect(outage.recordFailure(8_000)).toBeNull()
    expect(outage.attempts).toBe(3)
    // 差 1 毫秒都不算；断开起始时刻始终是第一次那一刻。
    expect(outage.recordFailure(30_999)).toBeNull()
    expect(outage.recordFailure(31_000)).toEqual({ disconnectedAt: 1_000 })
  })

  it('never reports a short flutter that recovers inside the 30 seconds', () => {
    const outage = new ChannelConnectionOutage()
    outage.recordFailure(1_000)
    outage.recordFailure(2_000)
    outage.recordFailure(8_000)
    outage.recordSuccess()
    expect(outage.attempts).toBe(0)
    // 恢复之后重新数，24 秒的抖动同样不报。
    outage.recordFailure(100_000)
    outage.recordFailure(124_000)
    expect(outage.attempts).toBe(2)
  })

  it('keeps quiet while the same outage keeps retrying: one outage, one record', () => {
    const outage = new ChannelConnectionOutage()
    outage.recordFailure(1_000)
    expect(outage.recordFailure(31_000)).not.toBeNull()
    // 断网十分钟就是几十次失败——报过之后一次都不能再报。
    for (let attempt = 0; attempt < 40; attempt += 1) {
      expect(outage.recordFailure(31_000 + attempt * 60_000)).toBeNull()
    }
  })

  it('counts a reconnect after recovery as a new outage with its own start', () => {
    const outage = new ChannelConnectionOutage()
    outage.recordFailure(1_000)
    expect(outage.recordFailure(31_000)).toEqual({ disconnectedAt: 1_000 })
    outage.recordSuccess()
    outage.recordFailure(900_000)
    // 新的一次断开带新的起始时刻：去重键不同，所以是另一条记录（契约要「一次断开一条」）。
    expect(outage.recordFailure(930_000)).toEqual({ disconnectedAt: 900_000 })
  })

  it('treats only the two transport codes as a lost connection', () => {
    expect(connectionCauseOfCode('telegram-network-unavailable')).toBe('network')
    expect(connectionCauseOfCode('telegram-proxy-unavailable')).toBe('proxy')
    // 限流 / 另一个进程在收 / token 被拒都不是「连不上」：报成网络问题，读者会去查错地方。
    expect(connectionCauseOfCode('telegram-rate-limited')).toBeNull()
    expect(connectionCauseOfCode('telegram-conflict')).toBeNull()
    expect(connectionCauseOfCode('telegram-provider-rejected')).toBeNull()
    expect(connectionCauseOfCode(undefined)).toBeNull()
  })
})
