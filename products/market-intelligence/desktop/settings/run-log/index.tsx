import { useEffect, useState } from 'react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import { SyncRunSection } from '../intelligence-sources/SyncRunSection'

import './run-log.css'

/**
 * Run log: what this module actually did, one page of its own.
 *
 * It used to be a tab inside the sources page, which put two unrelated jobs on one screen —
 * configuring what to collect, and reading what collection did. The reader who comes here has a
 * question about the past, not a switch to flip, so the tab and the page have now converged into
 * this section and the sources page keeps only the configuration.
 */
export default function IntelligenceRunLogSettingsSection({ focusEntityId, variant = 'page' }: Readonly<{
  /**
   * Set when a notification asked for one record (the shell carries the entity id across). The page
   * locates that analysis run and says so when it cannot — see `SyncRunSection`.
   */
  focusEntityId?: string | null
  /**
   * `page`（默认）= 设置页那一版：外框 `settings-workspace` + 页边距，行为与今天一字不差。
   * `embed` = 产品内「配置」抽屉里那一屏：**不套页外框、不画页边距**（抽屉自己有标题与内边距），
   * 表格吃满可用宽度。用 DOM 分支而不是 CSS 隐藏——隐藏掉的标题读屏还会念。
   */
  variant?: 'page' | 'embed'
}> = {}): React.ReactElement {
  const language = useShellLanguage()
  const t = productText[language].settings.intelligenceSources
  const [knownSources, setKnownSources] = useState<readonly Readonly<{ sourceId: string; label: string }>[]>()

  // The source filter lists every registered source: a source that has not run lately is exactly
  // the one a reader opens this page to look for. Failing to read the registry only narrows that
  // filter — the rows below still come from the run records themselves.
  useEffect(() => {
    let cancelled = false
    void intelligenceSourcesClient.getSettingsView()
      .then((view) => {
        if (cancelled) return
        const byId = new Map<string, string>()
        for (const group of view.groups) {
          for (const provider of group.providers) {
            for (const source of provider.sources) {
              const named = (t.sourceNames as Readonly<Record<string, string>>)[source.sourceId]
              byId.set(source.sourceId, named ?? source.displayName)
            }
          }
        }
        setKnownSources([...byId.entries()].map(([sourceId, label]) => ({ sourceId, label })))
      })
      .catch(() => { if (!cancelled) setKnownSources([]) })
    return () => { cancelled = true }
  }, [t.sourceNames])

  const body = (
    <div className="intelligence-run-log-workspace__body">
        <SyncRunSection
          analysisFailureReasons={productText[language].pages.intelligence.portal.analysisTimeline.failureReasons}
          focusAnalysisRunId={focusEntityId}
          knownSources={knownSources}
          text={{ ...t.syncRun, sourceNames: t.sourceNames }}
        />
    </div>
  )

  // 内嵌（抽屉）：没有页外框、没有页边距；外框那层的类名留给页面那一版。
  if (variant === 'embed') {
    return <section className="intelligence-run-log-embed" data-run-log-embed="true">{body}</section>
  }

  return (
    <section className="settings-workspace intelligence-run-log-workspace">
      {body}
    </section>
  )
}
