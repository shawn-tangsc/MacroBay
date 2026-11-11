/**
 * Discord 的**产品 User-Agent**：REST 与 WebSocket 握手都用它。
 *
 * 为什么必须有：Discord 边缘（Cloudflare）按 UA 拦截。浏览器 UA（Electron `net.fetch` 默认带的就是
 * 浏览器 UA）打 `GET /gateway/bot` 会被 403（`{"message":"internal network error","code":40333}`），
 * 而完全不带 UA 会被 1010 挡；同一个 Token、同一个代理，换成产品名 UA 就是 200。
 *
 * 现场实测（2026-11-11，真 Token + 系统代理）：
 * - 不带 UA → 403 `{"error code":1010}`；
 * - `Mozilla/5.0 (Macintosh; …)` → 403 `{"code":40333}`；
 * - `DiscordBot (…, 1.0)` / `node` / `MacroBay/0.4.3` → 200。
 *
 * 所以这不是「礼貌头」，是这一跳能不能通的必要条件；两端要同一个值，别只在一处加。
 */
export function discordUserAgent(appVersion: string): string {
  const version = appVersion.trim() === '' ? '0.0.0' : appVersion.trim()
  return `MacroBay/${version} (Discord adapter)`
}
