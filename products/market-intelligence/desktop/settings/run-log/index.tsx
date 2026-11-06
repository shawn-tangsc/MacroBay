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
export default function IntelligenceRunLogSettingsSection(): React.ReactElement {
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

  return (
    <section className="settings-workspace intelligence-run-log-workspace">
      <div className="intelligence-run-log-workspace__body">
        <SyncRunSection
          knownSources={knownSources}
          text={{ ...t.syncRun, sourceNames: t.sourceNames }}
        />
      </div>
    </section>
  )
}
