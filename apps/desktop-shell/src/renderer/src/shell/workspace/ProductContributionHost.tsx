import { type ComponentType, useEffect, useState } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { platformText } from '../../i18n/platformText'

type ContributionModule = {
  default?: ComponentType
}

interface ProductContributionHostProps {
  language: AppLanguage
  load: () => Promise<unknown>
  title: string
}

export function ProductContributionHost(props: ProductContributionHostProps): React.ReactElement {
  const [Component, setComponent] = useState<ComponentType | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const t = platformText[props.language]

  useEffect(() => {
    let cancelled = false
    setComponent(null)
    setErrorMessage(null)

    void props
      .load()
      .then((module) => {
        if (cancelled) return
        const contributionModule = module as ContributionModule
        if (!contributionModule.default) {
          throw new Error('Contribution module must export a default component')
        }
        setComponent(() => contributionModule.default!)
      })
      .catch((error) => {
        if (cancelled) return
        setErrorMessage(error instanceof Error ? error.message : t.status.failed)
      })

    return () => {
      cancelled = true
    }
  }, [props.load, t.status.failed])

  if (errorMessage) {
    return (
      <section className="contribution-error">
        <p className="eyebrow">{props.title}</p>
        <h1>{t.workspace.contributionLoadFailed}</h1>
        <p className="hero-copy">{errorMessage}</p>
      </section>
    )
  }

  if (!Component) {
    return <section className="contribution-loading">{t.status.loading}</section>
  }

  const LoadedComponent = Component
  return (
    <ShellLanguageProvider language={props.language}>
      <div className="settings-contribution-host">
        <LoadedComponent />
      </div>
    </ShellLanguageProvider>
  )
}
