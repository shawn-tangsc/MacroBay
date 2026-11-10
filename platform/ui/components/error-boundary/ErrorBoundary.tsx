import { Component, type ReactNode } from 'react'

import { STATE_VIEW_ACTION_KEYS, StateView, type ErrorReasonCode } from '../state'

/**
 * 面板级错误边界：**一块崩了只换这一块**，不要整页白。
 *
 * 事故背景（2026-11-10）：读者点开来源详情，整块白屏，控制台是
 * `Cannot read properties of undefined (reading 'unknown')`——他的实例里跑的是旧文案，`labels` 是空的。
 * 代码本身没错，**错在仓库里一个兜底都没有**：任何一处渲染抛异常，整页就白。
 *
 * 三条写死的决定：
 * 1. **崩溃界面就是 `StateView` 的 error 态**，不另画一套；「再试一次」用平台动作键，
 *    重试＝重置本边界状态、让子树重新渲染（不重载页面，也不重启应用）。
 * 2. **挂在面板级**，不是只在最外层挂一次：最外层挂等于「一小块坏了整窗白」，那正是要解决的。
 * 3. **`scope` 必填**：崩溃时它进 console 与错误态详情，少了它没人知道是哪一块崩的。
 *
 * 不做的：不吞异常、不自动重试、不隐藏。日志只打 `scope` + 错误本身 +
 * `componentStack`（React 给的组件栈，不含业务数据，不会把凭据带进日志）。
 */
export type ErrorBoundaryProps = {
  /** 这一块叫什么（面板名/区域名）。进日志与错误态详情，必填。 */
  scope: string
  /**
   * 错误面的原因码与产品句，**透传给 `StateView`**。
   *
   * 默认 `render-failed`：这一块是**画的时候崩的**——读者没点任何东西，也没有任何读取失败，
   * 说「读取失败」或「你这步操作没成功」都是把错按在读者身上。
   *
   * 调用点只在「这一块的崩法另有说法」时才覆盖（例如需要重启才恢复的本地接口缺失），
   * 所以类型直接收 `ErrorReasonCode`：码表是闭集，新码在 `platform/contracts/queryOutcome.ts` 一处加，
   * 文案、动作白名单与两份公开文档同笔跟。
   */
  reasonCode?: ErrorReasonCode
  children: ReactNode
}

type ErrorBoundaryState = { failed: boolean }

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }): void {
    // 只记定位信息：范围 + 错误 + 组件栈。不记 props/state，凭据不会从这里出去。
    console.error(`[ui] ${this.props.scope} crashed`, error, info.componentStack ?? '')
  }

  /** 重试＝重置边界，子树重新渲染；不重载页面，也不改任何外部状态。 */
  private readonly retry = (): void => {
    this.setState({ failed: false })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return <StateView
      action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: this.retry }}
      // 详情里只给范围名：这是读者唯一能报给我们、又不含业务数据的定位信息。
      details={{ bodyText: this.props.scope }}
      reasonCode={this.props.reasonCode ?? 'render-failed'}
      state="error"
    />
  }
}
