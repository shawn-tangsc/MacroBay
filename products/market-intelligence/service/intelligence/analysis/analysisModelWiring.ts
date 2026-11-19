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
 * 没有真实设置服务（headless / 测试）时不建这份接线：没有读者可问，保留「跟平台默认模型」，
 * 这是文档写明的缺省而不是放行。产品装配一定传 SettingsService。
 */
export function createAnalysisModelWiring(
  settingsService: MarketAnalysisSettingsService,
  recordRunModel: (id: string, model: AnalysisModelRef) => boolean
): Readonly<{
  orchestrator: Readonly<{
    resolveAnalysisModel: () => Promise<AnalysisModelRef | null>
    recordRunModel: (id: string, model: AnalysisModelRef) => boolean
  }>
  housekeeping: Readonly<{ resolveModel: () => Promise<AnalysisModelRef | null> }>
  request: Readonly<{ hasModel: () => Promise<boolean> }>
}> {
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
