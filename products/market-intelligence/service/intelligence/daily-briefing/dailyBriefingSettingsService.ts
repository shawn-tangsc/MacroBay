import type { DailyBriefingAiSettingsPatch } from '../schema/dailyBriefingAiSettings'
import type { DailyBriefingAiSettingsService } from './dailyBriefingAiSettingsService'
import type { EditionLanguageSettingsPatch } from './dailyBriefingLanguageSettings'
import type { EditionLanguageSettingsService, EditionLanguageSettingsView } from './dailyBriefingLanguageSettingsService'

/**
 * 日报的 **AI 编辑与语言设置**（早期口径把它连同期列表一起叫「旧设置」；期列表已搬走，这里只剩这组）：
 *
 * - `settings` 是 AI 编辑偏好（模型、WebSearch、编辑开关）；
 * - `language` 是那一个全局语言偏好，以及由它推出来的语言计划。
 *
 * 期列表（每一期什么时候跑、回看多久）**不在这里**：它有自己的一份存储和自己的 IPC 方法，
 * 在这一面再放一份只会与排期各说一套。两种形状故意分开：保存其中一个永远不改另一个。
 *
 * **这是抽屉日报屏这组设置唯一的读写口**（`intelligence.dailyBriefing.getSettings` /
 * `saveSettings`）。它不是可以「顺手清掉」的旧账——删掉等于让读者少一组设置；真要删，必须先给它
 * 一条新路径（新增专属 IPC 并切调用点，或等 C7 把那屏换新面）。台账 C15c 记的就是这句话。
 */
export type DailyBriefingSettingsPatch = DailyBriefingAiSettingsPatch & Readonly<{
  language?: EditionLanguageSettingsPatch
}>

export type DailyBriefingSettingsView = Readonly<{
  settings: Readonly<{
    editorialEnabled: boolean
    providerId: string
    modelId: string
    webSearchEnabled: boolean
    webSearchAuthorizedAt?: string
  }>
  /** The global language preference and the plan the page renders; the page never re-derives it. */
  language: EditionLanguageSettingsView
  /** 日报 agent 实际模型能否使用 Anthropic server-side WebSearch/WebFetch。 */
  webSearchSupported: boolean
  resolved:
    | Readonly<{ state: 'disabled' }>
    | Readonly<{ state: 'agent'; providerId: string; modelId: string; source: 'default' | 'custom'; fallback?: 'custom-unavailable' }>
    | Readonly<{ state: 'unavailable'; reason: 'default-unavailable' }>
}>

export type DailyBriefingSettingsService = Readonly<{
  getView: () => Promise<DailyBriefingSettingsView>
  save: (patch: DailyBriefingSettingsPatch) => Promise<DailyBriefingSettingsView>
}>

const AI_PATCH_KEYS = ['editorialEnabled', 'providerId', 'modelId', 'webSearchEnabled', 'webSearchAuthorizedAt'] as const

export function createDailyBriefingSettingsService(deps: Readonly<{
  ai: Pick<DailyBriefingAiSettingsService, 'getView' | 'save'>
  language: Pick<EditionLanguageSettingsService, 'getView' | 'save'>
}>): DailyBriefingSettingsService {
  async function view(): Promise<DailyBriefingSettingsView> {
    const [ai, language] = await Promise.all([deps.ai.getView(), deps.language.getView()])
    return Object.freeze({
      settings: ai.settings,
      language,
      resolved: ai.resolved,
      webSearchSupported: ai.webSearchSupported
    })
  }

  return {
    getView: view,
    async save(patch) {
      const aiPatch = Object.fromEntries(
        AI_PATCH_KEYS
          .filter((key) => patch[key] !== undefined)
          .map((key) => [key, patch[key]])
      ) as DailyBriefingAiSettingsPatch
      if (Object.keys(aiPatch).length > 0) await deps.ai.save(aiPatch)
      if (patch.language) await deps.language.save(patch.language)
      return view()
    }
  }
}
