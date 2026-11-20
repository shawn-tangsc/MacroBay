/**
 * 「指标 × 源」偏好键的拼法——**纯模块，不碰文件系统、不碰 electron**。
 *
 * 渲染层也要用它（视图要给每一行算 key），而渲染层不许传递性 import 到 `node:fs`：
 * 之前视图直接从 store 里 import 这个函数，把 `node:fs/promises` 带进了浏览器包，
 * 整页加载失败（2026-11-14 凌晨，应用开不了机）。所以拼法与存储分开两处：
 * 这里是纯的，store 也从这里取，别各写一份。
 */
export function coreIndicatorSourcePreferenceKey(metricKey: string, providerId: string): string {
  return `${metricKey}|${providerId}`
}
