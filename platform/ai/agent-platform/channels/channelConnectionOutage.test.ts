import { describe, expect, it } from 'vitest'

import {
  CHANNEL_RECONNECT_FAILURES_BEFORE_REPORT,
  ChannelConnectionOutage,
  connectionCauseOfCode
} from './channelConnectionOutage'

/**
 * P8 判定（需求 v2.17 §11.1–§11.2）：**自动重连失败之后只提交一次**，重试过程一次都不提交；
 * 同一次断开只留一条。这里判的是「报几次」，不是「报得好不好看」。
 */
describe('channel connection outage', () => {
  it('stays silent for a single blip and reports exactly once on the third failure', () => {
    const outage = new ChannelConnectionOutage()
    expect(outage.recordFailure(1_000)).toBeNull()
    expect(outage.recordFailure(2_000)).toBeNull()
    // 第三次：退避已经 1s→2s→4s，约 7 秒没接上，才算「这条频道真的收不到消息了」。
    expect(CHANNEL_RECONNECT_FAILURES_BEFORE_REPORT).toBe(3)
    expect(outage.recordFailure(4_000)).toEqual({ disconnectedAt: 1_000 })
  })

  it('keeps quiet while the same outage keeps retrying: one outage, one record', () => {
    const outage = new ChannelConnectionOutage()
    outage.recordFailure(1_000)
    outage.recordFailure(2_000)
    expect(outage.recordFailure(4_000)).not.toBeNull()
    // 断网十分钟就是几十次失败——报过之后一次都不能再报。
    for (let attempt = 0; attempt < 40; attempt += 1) {
      expect(outage.recordFailure(8_000 + attempt * 60_000)).toBeNull()
    }
  })

  it('never reports a blip that recovers before the threshold', () => {
    const outage = new ChannelConnectionOutage()
    expect(outage.recordFailure(1_000)).toBeNull()
    expect(outage.recordFailure(2_000)).toBeNull()
    outage.recordSuccess()
    expect(outage.recordFailure(3_000)).toBeNull()
    expect(outage.recordFailure(4_000)).toBeNull()
  })

  it('counts a reconnect after recovery as a new outage with its own start', () => {
    const outage = new ChannelConnectionOutage()
    outage.recordFailure(1_000)
    outage.recordFailure(2_000)
    expect(outage.recordFailure(3_000)).toEqual({ disconnectedAt: 1_000 })
    outage.recordSuccess()
    outage.recordFailure(90_000)
    outage.recordFailure(91_000)
    // 新的一次断开带新的起始时刻：去重键不同，所以是另一条记录（契约要「一次断开一条」）。
    expect(outage.recordFailure(92_000)).toEqual({ disconnectedAt: 90_000 })
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
