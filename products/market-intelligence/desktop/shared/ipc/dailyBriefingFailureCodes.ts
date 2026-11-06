/**
 * 日报读取失败的两个原因码。**必须分开**：一个是"这次没读到"，一个是"读到了、本机读不懂"。
 *
 * 合成一个码的后果已经有了实测：服务端多写三个字段，渲染层把整份文档判成不可信，页面只能报
 * "失败"，右列写不出原因（`02` v2.129 G5）。所以这两个码单独放一处，客户端与页面同源引用。
 */
export const DAILY_BRIEFING_REQUEST_FAILED = 'daily-briefing-request-failed'
export const DAILY_BRIEFING_DOCUMENT_INVALID = 'daily-briefing-document-invalid'
