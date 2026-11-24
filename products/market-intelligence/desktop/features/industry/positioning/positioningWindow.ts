import type { OpenInterestWindow } from '../../../../contracts/openInterestHistory'

/**
 * 持仓卡默认打开哪个窗口（用户 2026-11-24）：这张卡日常读的是最近一天的持仓变化与爆仓，
 * 7 天是偶尔才翻的视图。
 *
 * 查询按窗口读——折叠与爆仓回看都在查询里——所以它只是页面的初始状态，默认变短不额外多发一轮读；
 * 读者自己切到 7 天的行为不变。
 */
export const positioningDefaultWindow: OpenInterestWindow = '24h'
