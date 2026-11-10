import { useEffect, useState } from 'react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import type { BriefingPeriod } from '../../../contracts/dailyBriefingPeriod'
import { productText } from '../../shared/i18n/productText'
import type { DrawerRowView, DrawerScreenView } from './drawerScreenView'

/**
 * 配置抽屉「日报」那一屏的**只读视图**：读者要判断的三件事。
 *
 * - 生成时刻（这一期几点跑）；
 * - 生成语言（这几期各写哪种语言）；
 * - 自动生成开没开（排期有没有真的注册上）。
 *
 * 不搬整份生成设置：那是给实现者调的数，不是读者要判断的东西。
 *
 * **谁读数据**：这个 hook 只拿到一个 `read`——宿主页面把现成的期存储（`listPeriods`）与排期
 * 投影读好、拼成 `DrawerBriefingFacts` 再传进来。抽屉目录里没有 IPC 客户端（那条守卫还在），
 * 数值也不在这里重算：时刻就是期上那个 `generationTime`，语言就是期上那个 `language`。
 *
 * 三态与抽屉其它屏一致：`loading` / `error`（+重试）/ `ready`；`ready` 且 `rows` 为空才是
 * **确实没有配期**。**读不到永远不是空态**——那会让读者以为自动生成被关掉了。
 */
export type DrawerBriefingFacts = Readonly<{
  /** 期存储读出来的同一份期（`listPeriods` 的返回值），不在这里第二次推导。 */
  periods: readonly BriefingPeriod[]
  /**
   * 排期是否已注册：`on` 就是自动生成在跑（宿主的排期投影给这一档）。
   *
   * **不给或读不到就整屏算读不到**（宿主让 `read` 抛），不留一格空值——抽屉会把空值画成
   * 「—」，那和「没开」看起来一样。
   */
  autoGeneration: 'on' | 'off'
}>

export type DrawerBriefingView = DrawerScreenView<DrawerRowView>

/** 这一屏要用到的文案片段；结构足够窄，测试可以直接喂两份语言。 */
type BriefingDrawerCopy = Readonly<{
  configDrawer: Readonly<{ values: Readonly<{ autoOn: string; autoOff: string }> }>
  dailyBriefing: Readonly<{ history: Readonly<{ languages: Readonly<Record<'zh-CN' | 'en-US', string>> }> }>
}>

/**
 * 这一屏的行：三行固定事实，值**全部来自传进来的那一份期**。
 *
 * 一行一期不做：抽屉的行标签是 i18n 键（`resolveText(row.key)`），一期一个键就会把「这一期的
 * 名字」变成文案键；那是宿主渲染层的决定，不在这份只读视图里发明。
 */
export function drawerBriefingRows(facts: DrawerBriefingFacts, copy: BriefingDrawerCopy): readonly DrawerRowView[] {
  // 确实没有配期：空态由抽屉画，这里不给占位行、也不编一个"默认 07:00"。
  if (facts.periods.length === 0) return []
  const languages = [...new Set(facts.periods.map((period) => period.language))]
  return [
    {
      key: 'configDrawer.rows.publishAt',
      value: facts.periods.map((period) => period.generationTime).join(' · ')
    },
    {
      key: 'configDrawer.rows.briefingLanguages',
      value: languages.map((language) => copy.dailyBriefing.history.languages[language]).join(' · ')
    },
    {
      key: 'configDrawer.rows.autoGeneration',
      value: facts.autoGeneration === 'on' ? copy.configDrawer.values.autoOn : copy.configDrawer.values.autoOff
    }
  ]
}

/**
 * 读这一屏：`read` 由宿主给（它读现成的期存储与排期投影）。
 *
 * 只在抽屉打开（`active`）时读；重试就是再读一次。读失败 → `error` + 重试，**不退化成空态**。
 */
export function useDrawerBriefingView(
  active: boolean,
  read: () => Promise<DrawerBriefingFacts>
): DrawerBriefingView | undefined {
  const language = useShellLanguage()
  const [view, setView] = useState<DrawerBriefingView>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!active) return
    let alive = true
    setView({ state: 'loading' })
    void read()
      .then((facts) => {
        if (!alive) return
        setView({ state: 'ready', rows: drawerBriefingRows(facts, productText[language].pages.intelligence.portal.dashboard) })
      })
      .catch(() => {
        if (!alive) return
        // 读不到就是错误态：这一屏没有"部分可用"的中间态。
        setView({ state: 'error', onRetry: () => setAttempt((value) => value + 1) })
      })
    return () => { alive = false }
  }, [active, read, attempt, language])

  return view
}
