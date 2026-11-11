import type { ReactNode } from 'react'
import { Button } from 'antd'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { AsyncState } from '@platform/ui/async/asyncState'
import { LoadingState } from '@platform/ui/components/loading'
import { resolveStateViewText, STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

import { platformText } from '../../i18n/platformText'

/**
 * 模型服务启动读数的三面：等 / 读不到 / 有数据。
 *
 * 判据来自台账 §25 与 `MI-11-R161`：
 *  - `loading`：只画加载，不画错误也不画空态——「还没读到」既不是「没有」也不是「失败」；
 *  - `error`：整页读不到才画错误 + 真的重试；
 *  - `ready + stale`：刷新失败时**保留已读到的列表**，只说清这是上一次的读数，并把重试留在原处。
 *
 * 读的生命周期只在 `useModelServiceProviders` 里转移，这里只负责照着状态渲染。
 */
export function ModelServiceLoadSurface(props: {
  language: AppLanguage
  state: AsyncState<SafeModelProvider[]>
  onRetry: () => void
  children: ReactNode
}): React.ReactElement {
  const t = platformText[props.language]
  if (props.state.status === 'loading') {
    return (
      <section className="settings-workspace model-service-page" aria-busy="true">
        <LoadingState label={t.status.loading} fill />
      </section>
    )
  }
  if (props.state.status === 'error') {
    return (
      <section className="settings-workspace model-service-page">
        {/* 区域级错误只有四档：`page-load-failed` 说的是「整页没起来」，落到这一块就按「这次没读到」显示。 */}
        <StateView
          state="error"
          reasonCode={props.state.reasonCode === 'page-load-failed' ? 'unreadable' : props.state.reasonCode}
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: props.onRetry }}
        />
      </section>
    )
  }
  return (
    <>
      {props.state.stale === true ? (
        // 「刷新失败、旧数据还在」不是「读不到」：页面级错误会把用户手里的列表换成空白。
        <p className="model-service-stale" role="status">
          <span>{t.models.providersStaleNotice}</span>
          {/* 句内动作 → antd 文本档 `Button` + `.text-action`。 */}
          <Button className="text-action" onClick={props.onRetry}>
            {resolveStateViewText(props.language, STATE_VIEW_ACTION_KEYS.refresh)}
          </Button>
        </p>
      ) : null}
      {props.children}
    </>
  )
}
