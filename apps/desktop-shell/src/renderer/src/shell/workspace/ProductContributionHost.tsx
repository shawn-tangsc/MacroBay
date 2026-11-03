import { type ComponentType, useEffect, useState } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { redactDiagnosticText } from '@platform/secrets/redaction/redactDiagnostic'
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
 * - **原始报错只进折叠的「技术详情」，且调用方先脱敏**：正文/标题/原因句/动作位一律不许出现。
 *   脱敏走 `redactDiagnosticText`（与启动失败页同一份实现）；组件只负责把已脱敏的原文塞进折叠区。
 *
 * 失败态是**内容区里的一个状态视图**，不另起整页：页面骨架（侧栏/顶栏）还在，读者能换页离开。
 */
export function ProductContributionHost(props: ProductContributionHostProps): React.ReactElement {
  const [Component, setComponent] = useState<ComponentType | null>(null)
  const [failure, setFailure] = useState<{ detail: string } | null>(null)
  const t = platformText[props.language]

  useEffect(() => {
    let cancelled = false
    setComponent(null)
    setFailure(null)

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
        // 先脱敏再进 state：折叠区里的是「已脱敏的诊断原文」，不是 error.message 原样。
        const raw = error instanceof Error ? error.message : String(error)
        setFailure({ detail: redactDiagnosticText(raw) })
      })

    return () => {
      cancelled = true
    }
  }, [props.load])

  if (failure !== null) {
    return (
      <ShellLanguageProvider language={props.language}>
        <section className="contribution-error">
          <StateView
            state="error"
            reasonCode="page-load-failed"
            size="lg"
            details={{ bodyText: failure.detail }}
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
