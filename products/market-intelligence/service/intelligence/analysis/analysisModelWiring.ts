import { isMarketAnalysisModelSet } from '../application/marketAnalysisSettings'
import type { MarketAnalysisSettingsService } from '../application/marketAnalysisSettingsService'

/** 一次运行要调的模型：入队、调用前解析、写回运行行共用这一个形状。 */
export type AnalysisModelRef = Readonly<{ providerId: string; modelId: string }>

/**
 * 把「读者选的模型」接到三个入口，不在这里做选择：
 * - 编排器在**每次调用前**解析（启动恢复补排的旧运行没有模型）；
 * - 重启对账在补排运行**入队时**就带上它；
 * - 手动请求在**排冻结之前**问一次有没有模型，没有就当场拒绝（不再排一次注定失败的运行）。
 *
 * 没有真实设置服务（headless / 测试）时这份接线整块不存在。**但缺席必须看得见**：三道门
 * （编排器解析、补排入队、手动请求）会一起消失，分析退回「猜平台默认供应商」的旧行为。
 * 所以这里不是静默返回 undefined，而是留一条 `MI_ANALYSIS_MODEL_WIRING_MISSING`。
 */
export function createAnalysisModelWiring(
  settingsService: MarketAnalysisSettingsService | undefined,
  recordRunModel: (id: string, model: AnalysisModelRef) => boolean
): Readonly<{
  orchestrator: Readonly<{
    resolveAnalysisModel: () => Promise<AnalysisModelRef | null>
    recordRunModel: (id: string, model: AnalysisModelRef) => boolean
  }>
  housekeeping: Readonly<{ resolveModel: () => Promise<AnalysisModelRef | null> }>
  request: Readonly<{ hasModel: () => Promise<boolean> }>
}> | undefined {
  if (!settingsService) {
    console.warn(JSON.stringify({ marker: 'MI_ANALYSIS_MODEL_WIRING_MISSING', reason: 'settings-service-absent' }))
    return undefined
  }
  const resolveModel = async (): Promise<AnalysisModelRef | null> => {
    const settings = await settingsService.getSettings()
    return isMarketAnalysisModelSet(settings)
      ? { providerId: settings.providerId, modelId: settings.modelId }
      : null
  }
  return {
    orchestrator: { resolveAnalysisModel: resolveModel, recordRunModel },
    housekeeping: { resolveModel },
    request: { hasModel: async () => (await resolveModel()) !== null }
  }
}
