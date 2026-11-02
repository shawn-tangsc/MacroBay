import { Modal } from 'antd'

/**
 * 破坏性操作的确认对话框（B0 契约 §8）。
 *
 * 用途单一：用户即将做一件不可撤销的事，先让他确认。它不是消息框、不是回执。
 * 底层用 `Modal.confirm`，不用 `window.confirm`——后者不受主题与 i18n 控制。
 *
 * 组件内**零文案**：四个字符串字段全部必填、没有一处内部兜底。
 * 有兜底的地方就会长出七种「确定」，之后再也没人统一。
 */
export type ConfirmTone = 'default' | 'danger'

export type ConfirmProps = {
  title: string
  /** 说清后果（「删掉之后不能恢复」），不写「确定吗」。 */
  description?: string
  /** 无默认值：缺了编译不过。 */
  confirmLabel: string
  /** 无默认值：组件内不 import i18n，兜底文案无处可取。 */
  cancelLabel: string
  /** 无默认值：迫使每次调用回答一次「这操作可撤销吗」。 */
  tone: ConfirmTone
  /** 抛错时对话框保持打开，错误由调用方展示；组件内不弹 toast。 */
  onConfirm: () => void | Promise<void>
  onCancel?: () => void
}

/**
 * 平台缺口的一行补丁：antd 的 `ModalFuncProps` 没有声明 `isSilent`，但运行时认它。
 *
 * 显式写出这个形状，而不是 `as any`——`as any` 会在下一次「清理类型」时被安静删掉，
 * 然后 `onOk` 的拒绝又变成未处理拒绝、测试开始偶发红，而没人知道为什么。
 */
type ConfirmOptionsWithSilent = Parameters<typeof Modal.confirm>[0] & { isSilent?: () => boolean }

export function confirmAction(props: ConfirmProps): void {
  const options: ConfirmOptionsWithSilent = {
    isSilent: () => true,
    title: props.title,
    content: props.description,
    okText: props.confirmLabel,
    cancelText: props.cancelLabel,
    okButtonProps: props.tone === 'danger' ? { danger: true } : undefined,
    // 危险档焦点落在取消上：按住回车连击时，落在确认上就是连续执行破坏性操作。
    autoFocusButton: props.tone === 'danger' ? 'cancel' : 'ok',
    centered: true,
    // 失败时对话框要留在屏幕上（读者得能改完再提交）。antd 的 ActionButton 在 `onOk` 拒绝后
    // 会再抛一次，于是出现未处理拒绝；`isSilent` 让 antd 吞掉那一次重抛，**关闭时机仍由我们自己
    // 的 `onOk` 决定**——这是一处平台缺口的一行补丁，不是「让测试变绿」的开关。
    onOk: () => props.onConfirm(),
    onCancel: () => props.onCancel?.()
  }
  Modal.confirm(options)
}
