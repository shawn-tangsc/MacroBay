import { StateView, STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state'

/**
 * 「读不到」有两种，不能写成同一种：
 *
 * - **手里没有读数** → 那是错误，给重试；
 * - **手里有旧读数** → 那是「屏上是上一次的结果」，保留数据、只挂一句说明。
 *
 * 把后者换成错误视图，等于用一次刷新失败惩罚用户已经读到的东西。两者共用 `loadFailed` 一个标志，
 * 靠 `hasItems` 分流——**分流靠手上的数据，不靠读失败时的时机**。
 *
 * 单独成文件是因为抽屉本身按行数上限切分过：这一段是「读的三态」的收口，和保存/运行无关。
 */
export default function AgentTaskCenterLoadStatus(props: {
  loadFailed: boolean
  hasItems: boolean
  staleDataNotice: string
  onRetry: () => void
}): React.ReactElement | null {
  if (!props.loadFailed) return null
  if (props.hasItems) {
    return (
      <p className="agent-task-error" role="status">
        {props.staleDataNotice}
      </p>
    )
  }
  return (
    <StateView
      state="error"
      reasonCode="unavailable"
      size="md"
      action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: props.onRetry }}
    />
  )
}
