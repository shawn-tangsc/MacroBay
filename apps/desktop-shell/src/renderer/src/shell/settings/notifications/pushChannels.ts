/**
 * 「发送到通道」那一行要读的通道投影。
 *
 * 为什么需要一个解码函数：主进程给的 `getDeliverySettings().channels` 现在类型是 `unknown[]`
 * （`NotificationRuntimeSettings` 的 `getPushTargets` 还没人提供实现），渲染层不能假定形状。
 * 硬转成某个类型会在第一个真实现上炸，而那时离今天很远、没人记得这里假设过什么。
 *
 * 所以：**只认能确认的字段，其余按「没有」处理**，并把不认识的条目丢掉——一行里显示
 * 一个 `[object Object]` 比不显示更糟。
 *
 * 哪天平台把 `getPushTargets` 接上并给了类型，这个函数就该换成直接引用那份类型：
 * 它是一次有意的临时边界，不是长期设计。
 */
export type PushChannelOption = {
  id: string
  name: string
  /** 绑定的会话名；未绑定为 `null`。 */
  target: string | null
  /** 绑定的会话数：>1 时按规范「不发、不猜」。 */
  targetCount: number
}

export function decodePushChannels(raw: readonly unknown[]): PushChannelOption[] {
  const options: PushChannelOption[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : typeof record.channelId === 'string' ? record.channelId : null
    if (id === null) continue
    const name = typeof record.name === 'string' ? record.name : typeof record.label === 'string' ? record.label : id

    const targets = Array.isArray(record.targets) ? record.targets.filter((entry): entry is string => typeof entry === 'string') : null
    const single = typeof record.target === 'string' ? record.target : null
    const targetList = targets ?? (single === null ? [] : [single])

    options.push({
      id,
      name,
      target: targetList.length === 1 ? targetList[0]! : null,
      targetCount: targetList.length
    })
  }
  return options
}
