/**
 * 通道结果那几行字的**唯一一份**（分析结论「发送到频道」与日报「发布频道」共用）。
 *
 * 两处都在回答同一个问题：「这条通道收到没有、发的是什么」。各写一套就会一边说「收到了」、
 * 一边说「已送达」，而多通道方案里这两句是完全不同的断言（收到 ≠ 送达）。
 *
 * `reasons` 的键跟平台 `ChannelPushReason` 走；认不出的码走 `reasonUnknown`，不编一个理由。
 */
export const channelResultWords = Object.freeze({
  'zh-CN': Object.freeze({
    image: '发了海报',
    text: '只发了文字（没有海报）',
    received: '收到了',
    notReceived: '没收到',
    unconfirmed: '已送出去，还没收到回执',
    unknownChannel: '推送通道',
    reasonUnknown: '这次没成功，原因还不认识',
    reasons: Object.freeze({
      'channel-rejected': '通道没接这次请求',
      'push-backoff': '这条通道刚失败过几次，暂时没有重试',
      'unknown-after-send': '送到一半失去响应，不知道到没到',
      'delivery-no-target-bound': '这条通道没有绑定投递目标',
      'delivery-ambiguous-target': '有多个同名通道，不确定发给哪一条',
      'push-unavailable': '这条通道现在不可用'
    })
  }),
  'en-US': Object.freeze({
    image: 'sent the poster',
    text: 'sent text only (no poster)',
    received: 'received',
    notReceived: 'did not receive',
    unconfirmed: 'sent, no receipt yet',
    unknownChannel: 'push channel',
    reasonUnknown: 'it failed for a reason this build does not recognize',
    reasons: Object.freeze({
      'channel-rejected': 'the channel did not take this request',
      'push-backoff': 'this channel failed recently, so it was not retried',
      'unknown-after-send': 'the connection dropped mid-send, so delivery is unknown',
      'delivery-no-target-bound': 'this channel has no delivery target bound',
      'delivery-ambiguous-target': 'several channels share this name, so the target was ambiguous',
      'push-unavailable': 'this channel is not available right now'
    })
  })
} as const)
