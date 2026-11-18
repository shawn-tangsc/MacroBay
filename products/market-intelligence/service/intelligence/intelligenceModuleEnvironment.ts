import { join } from 'node:path'

import { app } from 'electron'

import { resolveBriefingTimeZone } from './daily-briefing/readerTimeZone'
import { INTELLIGENCE_PRODUCT_ID as PRODUCT_ID, type IntelligenceModulePlatformHooks } from './intelligenceModuleContracts'

/**
 * 模块级的环境读取：读者时区与产品数据目录。
 *
 * 从 `intelligenceModule.ts` 抽出来（2026-11-18，`check:file-size` 那条基线只能变小）：
 * 这两件事只依赖「宿主给的 hooks」与 `app.getPath`，与组合装配无关，留在工厂文件里是纯噪声。
 *
 * 状态仍只有一份：hooks 由 `getIntelligenceModule()` 在装配时 `setModulePlatformHooks` 写进来，
 * 其它地方只读——两个函数背后是**同一个提供者**，不另起第二份时区来源。
 */
let modulePlatformHooks: IntelligenceModulePlatformHooks | undefined

export function setModulePlatformHooks(hooks: IntelligenceModulePlatformHooks | undefined): void {
  modulePlatformHooks = hooks
}

/** 装配期需要的 hooks（订阅设置变更等）：与 `shellTimeZone` 读的是同一份。 */
export function getModulePlatformHooks(): IntelligenceModulePlatformHooks | undefined {
  return modulePlatformHooks
}

export function shellTimeZone(): string {
  return resolveBriefingTimeZone(modulePlatformHooks)
}

/** 供产品内其它装配点读取「读者时区」（同一提供者，不另起来源）。 */
export function currentReaderTimeZone(): string {
  return shellTimeZone()
}

function getProductDataDir(): string {
  return join(app.getPath('userData'), 'products', PRODUCT_ID)
}

export function getIntelligenceProductDataDir(): string {
  return getProductDataDir()
}
