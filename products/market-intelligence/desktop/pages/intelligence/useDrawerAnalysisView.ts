import { useEffect, useRef, useState } from 'react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import type { DrawerRowView, DrawerScreenView } from '../../settings/config-drawer/drawerScreenView'
import { productText } from '../../shared/i18n/productText'

/**
 * 配置抽屉「AI 分析」屏的**只读视图**（用户 2026-11-10：这一轮只读，不画能拨的开关）。
 *
 * 两行事实，值全部由宿主读好传进来：
 * - 是否分析：设置里那个开关现在的事实值，只写「开」/「关」两个字，**不是控件**——
 *   写路径还没从宿主接过来，画个能拨的开关就是骗人；
 * - 分析用哪个模型：没选就说「跟随默认助手模型」；选了就给模型名（`provider / model`）；
 *   **说不清就不给值**——不许拿一个默认模型名把这一格填满。
 *
 * 每行行尾一颗「去设置改」：**只把目标 `'analysis'` 交出去**，打哪个弹框、跳哪一面由宿主决定。
 * 抽屉和这里都不拼路由、不调写命令。
 *
 * 抽屉不自己取数：这里只认宿主给的 `read`。宿主用现成的两样东西拼事实——
 * `marketAnalysisTimelineClient.getSettings()`（开没开、选了哪个模型）与
 * `window.platform.modelProviders.list()`（把 `providerId:modelId` 翻成人话），
 * 拼法见 `drawerAnalysisFactsFrom`。`getSettings()` 读失败是 `undefined`，**宿主必须抛**，
 * 让这一屏走错误态；别把它当成「没配置」。
 */

/**
 * 抽屉能交出去的设置目标——**闭集**，不是 `string`：宿主拿到它再决定往哪走。
 *
 * 现在只有三个。加一屏就在这里加一个，**别给每屏再加一个回调**：六屏六个 prop，最后还是要收成
 * 一个枚举。传别的值在调用点就是编译错误。
 */
export const DRAWER_SETTINGS_TARGETS = ['preferences', 'models', 'analysis'] as const
export type DrawerSettingsTarget = (typeof DRAWER_SETTINGS_TARGETS)[number]

/** 「用哪个模型」的三种真话。第三种是「说不出来」，由渲染层留空，**不许替读者挑一个**。 */
export type DrawerModelFact =
  | Readonly<{ state: 'follows-default' }>
  | Readonly<{ state: 'named'; name: string }>
  | Readonly<{ state: 'unknown' }>

export type DrawerAnalysisFacts = Readonly<{
  /** 设置里那个开关的事实值。 */
  enabled: boolean
  /** 分析用哪个模型；没选时是 `follows-default`，不是空。 */
  model: DrawerModelFact
}>

/**
 * 这一屏用到的三句文案；结构足够窄，测试可以直接喂一份自己的。
 *
 * `followDefault` 用的是 AI 分析设置弹框里那句「跟随默认助手模型」：同一件事不写第二份。
 */
export type DrawerAnalysisCopy = Readonly<{
  on: string
  off: string
  followDefault: string
}>

/**
 * 行键按抽屉现有惯例是 `configDrawer.*`（相对 `pages.intelligence.portal.dashboard`），
 * 和 `drawerPreviewRows.ts` 里那批行同一个前缀——宿主的 `resolveText` 据此解析。
 */
const ROW_KEYS = {
  analysisSwitch: 'configDrawer.rows.analysisSwitch',
  analysisModel: 'configDrawer.rows.analysisModel',
  changeInSettings: 'configDrawer.actions.changeInSettings'
} as const

/**
 * 两行事实 + 行尾那颗「去设置改」。
 *
 * 行集是**定死**的两行（版面那两行）：开关、模型。不要在这里加第三行，也不要把「没配置」
 * 变成空态——默认配置本身就是一个值（关 / 跟随默认），不是「什么都没有」。
 */
export function drawerAnalysisRows(
  facts: DrawerAnalysisFacts,
  copy: DrawerAnalysisCopy,
  onOpenSettings: (target: DrawerSettingsTarget) => void
): readonly DrawerRowView[] {
  // 这一屏只知道一件事：要改的是分析设置。至于打开的是弹框还是页面，宿主去决定。
  const action = { labelKey: ROW_KEYS.changeInSettings, onSelect: () => onOpenSettings('analysis') }
  const modelValue = modelFactValue(facts.model, copy)
  return [
    {
      key: ROW_KEYS.analysisSwitch,
      value: facts.enabled ? copy.on : copy.off,
      action
    },
    {
      key: ROW_KEYS.analysisModel,
      // 没有值就不传 `value`：抽屉画「—」，不是画一个编出来的默认模型名。
      ...(modelValue === undefined ? {} : { value: modelValue }),
      action
    }
  ]
}

function modelFactValue(model: DrawerModelFact, copy: DrawerAnalysisCopy): string | undefined {
  if (model.state === 'follows-default') return copy.followDefault
  if (model.state === 'named') return model.name.trim() === '' ? undefined : model.name
  return undefined
}

/**
 * 把宿主已经读到的两样东西拼成事实。
 *
 * 一处判据：**只有「设置里没选模型」才算跟随默认**。选了却查不到它（供应商被停用、模型下架、
 * 模型清单这次没读到）就是 `unknown`——**不回落成默认模型名**，那会把「你选的模型不见了」
 * 画成「你在用默认」，是两件不同的事。
 */
export function drawerAnalysisFactsFrom(input: Readonly<{
  settings: Readonly<{ enabled: boolean; providerId: string; modelId: string }>
  providers: readonly Readonly<{
    id: string
    name: string
    models: readonly Readonly<{ id: string; name: string }>[]
  }>[]
}>): DrawerAnalysisFacts {
  const { settings, providers } = input
  if (settings.providerId === '' || settings.modelId === '') {
    return { enabled: settings.enabled, model: { state: 'follows-default' } }
  }
  const provider = providers.find((candidate) => candidate.id === settings.providerId)
  const model = provider?.models.find((candidate) => candidate.id === settings.modelId)
  if (provider === undefined || model === undefined) return { enabled: settings.enabled, model: { state: 'unknown' } }
  return { enabled: settings.enabled, model: { state: 'named', name: `${provider.name} / ${model.name}` } }
}

/**
 * 读这一屏：`read` 与 `onOpenSettings` 都由宿主给。
 *
 * 两者都放进 ref：effect 只在「打开 / 重试 / 换语言」时跑一次，宿主传内联函数也不会反复重读
 * （换语言时重读，是因为值里的「开 / 关 / 跟随默认」是文案）。读失败 → `error` + 重试，
 * **不退化成空态**。
 */
export function useDrawerAnalysisView(
  active: boolean,
  read: () => Promise<DrawerAnalysisFacts>,
  onOpenSettings: (target: DrawerSettingsTarget) => void
): DrawerScreenView<DrawerRowView> | undefined {
  const language = useShellLanguage()
  const latest = useRef({ read, onOpenSettings })
  useEffect(() => { latest.current = { read, onOpenSettings } })
  const [view, setView] = useState<DrawerScreenView<DrawerRowView>>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!active) return
    let alive = true
    setView({ state: 'loading' })
    void latest.current.read()
      .then((facts) => {
        if (!alive) return
        const copy: DrawerAnalysisCopy = {
          on: productText[language].pages.intelligence.portal.dashboard.configDrawer.values.autoOn,
          off: productText[language].pages.intelligence.portal.dashboard.configDrawer.values.autoOff,
          // AI 分析设置弹框里那句「跟随默认助手模型」——抽屉不复制第二份。
          followDefault: productText[language].pages.intelligence.portal.analysisTimeline.modelFollowDefault
        }
        setView({
          state: 'ready',
          rows: drawerAnalysisRows(facts, copy, (target) => latest.current.onOpenSettings(target))
        })
      })
      .catch(() => {
        if (!alive) return
        // 读不到就是错误态：这一屏没有"部分可用"的中间态。
        setView({ state: 'error', onRetry: () => setAttempt((value) => value + 1) })
      })
    return () => { alive = false }
  }, [active, attempt, language])

  return view
}
