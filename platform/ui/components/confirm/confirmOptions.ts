import type { Modal } from 'antd'

import type { ConfirmProps } from './Confirm'

/** `Modal.useModal()` 交出的实例：确认框必须由它渲染，才能吃到当前 React 树里的 `ConfigProvider`。 */
export type ModalInstance = ReturnType<typeof Modal.useModal>[0]

/**
 * antd 的 `ModalFuncProps` 没有声明 `isSilent`，但运行时认它。
 *
 * 显式写出这个形状，而不是 `as any`——`as any` 会在下一次「清理类型」时被安静删掉，
 * 然后 `onOk` 的拒绝又变成未处理拒绝、测试开始偶发红，而没人知道为什么。
 */
export type ConfirmOptionsWithSilent = Parameters<ModalInstance['confirm']>[0] & { isSilent?: () => boolean }

/**
 * 确认框的选项**只有这一份构造**：`useConfirm()` 与遗留的 `confirmAction()` 都走这里。
 *
 * 两套实现各写一份选项，是这类组件最常见的漂移点——今天已经因为「静态方法 vs 树内实例」
 * 漂出过深浅色不一致，没必要再让文案与危险档分叉一次。
 */
export function confirmOptions(props: ConfirmProps): ConfirmOptionsWithSilent {
  return {
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
}
