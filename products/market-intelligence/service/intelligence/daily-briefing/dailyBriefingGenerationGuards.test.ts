import { describe, expect, it } from 'vitest'

import { turnFailureCode, withDeadline } from './dailyBriefingGenerationGuards'

/**
 * 一次抛出来的错误怎么归类：**只认类型化的名字，不读报文**（架构师保留项，2026-11-07）。
 *
 * 这条纪律有前科：上一版拿 `/disposed|stopped|interrupted/i` 在报文里找词，于是上游一个
 * `stream stopped` 的网络错误会被写成「应用在这之前被关闭了」。原因要自己带名字，不靠猜。
 */
describe('a thrown error is classified by its name', () => {
  it('calls the platform turn timeout a timeout — and it stays worth one retry', () => {
    const error = new Error('The model call timed out after 120000 ms')
    error.name = 'AgentTurnTimeoutError'
    expect(turnFailureCode(error)).toBe('editorial-timeout')
  })

  it('calls our own deadline a timeout too, by name rather than by its sentence', async () => {
    // 自己的截止错误以前只能靠 `Error('daily-briefing-generation-timeout')` 这句文本认出来。
    await expect(withDeadline(new Promise(() => undefined), 1)).rejects.toMatchObject({ name: 'DailyBriefTimeoutError' })
  })

  it('keeps a cancellation a cancellation', () => {
    const error = new Error('aborted')
    error.name = 'AbortError'
    expect(turnFailureCode(error)).toBe('cancelled')
  })

  it('never turns a message that merely talks about stopping into an app close', () => {
    // 这就是那条禁令的夹具：报文里有 stopped / interrupted，但它不是关闭，也不许被说成关闭。
    for (const message of ['upstream stream stopped', 'connection interrupted', 'socket closed by peer']) {
      expect(turnFailureCode(new Error(message)), message).toBe('provider-error')
    }
  })
})
