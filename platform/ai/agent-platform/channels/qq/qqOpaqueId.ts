/**
 * 对方给的不透明 id：**只要求「能安全存、能当去重键」**，不要求它像标识符。
 *
 * 以前这里是一张字符白名单 `/^[A-Za-z0-9_-]{1,256}$/`。QQ 的消息 id 形如
 * `ROBOT1.0_4L5m…`（带点），于是真消息被我们自己的校验判成坏帧——`qq-event-invalid`，
 * 用户看到的就是「发了消息、机器人不回」。
 *
 * 判据按**有界字符串**写，与 `LarkEventEnvelope` 的 `bounded()` 同形：非空、长度 ≤ 256、
 * 不含控制字符。不枚举字符集——这些值的内容由对方决定，白名单只会越写越漏。
 */
export function boundedOpaqueId(value: unknown, maxLength = 256): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) return null
  // 控制字符（含 \u0000-\u001f 与 DEL）会让日志/终端/审计行断行或伪造字段。
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) return null
  return trimmed
}
