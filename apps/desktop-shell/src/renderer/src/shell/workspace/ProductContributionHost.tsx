import { type ComponentType, useEffect, useState } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { platformText } from '../../i18n/platformText'

type ContributionModule = {
  default?: ComponentType
}

interface ProductContributionHostProps {
  language: AppLanguage
  load: () => Promise<unknown>
}

/**
 * 产品页/产品设置页的加载宿主。
 *
 * 加载失败时只给一个状态视图（`error · page-load-failed`）和唯一动作「重新载入界面」：
 *
 * - **不做 retry**：求值失败的模块记录被 ESM 缓存成 errored，同一个说明符再 `import()` 拿到的是
 *   那一次拒绝；重试等于点一个必然失败的按钮。
 * - **不重启应用**：平台没有可重启的接缝；`location.reload()` 是唯一能重建模块图的动作。
 * - **原始报错不显示**：这一版只做「不许出现」，可折叠的技术细节属第二批。
 *
 * 失败态是**内容区里的一个状态视图**，不另起整页：页面骨架（侧栏/顶栏）还在，读者能换页离开。
 */
export function ProductContributionHost(props: ProductContributionHostProps): React.ReactElement {
  const [Component, setComponent] = useState<ComponentType | null>(null)
  const [failed, setFailed] = useState(false)
  const t = platformText[props.language]

  useEffect(() => {
    let cancelled = false
    setComponent(null)
    setFailed(false)

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
      .catch(() => {
        // 原始报错只留在 catch 里，不进 state、不进界面（第二批才进折叠的技术细节）。
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [props.load])

  if (failed) {
    return (
      <ShellLanguageProvider language={props.language}>
        <section className="contribution-error">
          <StateView
            state="error"
            reasonCode="page-load-failed"
            size="lg"
            action={{
              labelKey: STATE_VIEW_ACTION_KEYS.reload_page,
              onSelect: () => window.location.reload()
            }}
          />
        </section>
      </ShellLanguageProvider>
    )
  }

  if (!Component) {
    return (
      <section className="contribution-loading">
        <LoadingState label={t.status.loading} fill />
      </section>
    )
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
