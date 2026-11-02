import { Trash2 } from 'lucide-react'

import { confirmAction } from '@platform/ui/components/confirm'

import type { PlatformText } from '../../i18n/platformText'

type ModelServiceClearModelsControlProps = {
  labels: PlatformText['models']
  /** 该供应商当前模型总数（含归档的旧预设模型）；0 ⇒ 按钮 disabled。 */
  modelCount: number
  /** 保存中（同步/其它模型操作）时禁用，避免并发改同一份模型列表。 */
  disabled?: boolean
  /** 返回 true 表示清空成功（关闭确认框）；false 保持打开，错误由调用方行内展示。 */
  onConfirm: () => Promise<boolean>
}

/**
 * PLAT-72：「清空模型」按钮 + 二次确认。
 *
 * 危险操作所以走平台 `confirmAction`（确认框归 `confirm`，不是带表单的 Modal）：
 * 一句话 + 危险钮，初始焦点由组件落在「取消」上。确认后由调用方按**一次** `applyModelSync`
 * （`toRemove` = 全部 id）提交 —— 复用既有通道与单事务写入，不新增 IPC，也不会出现"删了一半"。
 */
export function ModelServiceClearModelsControl({
  labels,
  modelCount,
  disabled = false,
  onConfirm
}: ModelServiceClearModelsControlProps): React.ReactElement {
  const isEmpty = modelCount === 0

  /**
   * `onConfirm` 返回 `false` 表示这次没清成（调用方会在行内报错）——`confirmAction` 的约定是
   * 「抛错保持打开」，所以这里把 `false` 翻成一次明确的拒绝，而不是自己造一个关闭回调。
   */
  function confirm(): void {
    confirmAction({
      title: labels.clearModelsConfirmTitle,
      description: labels.clearModelsConfirmBody(modelCount),
      confirmLabel: labels.clearModels,
      cancelLabel: labels.cancel,
      tone: 'danger',
      onConfirm: async () => {
        if (!(await onConfirm())) throw new Error('clear-models-not-applied')
      }
    })
  }

  return (
    <button
      type="button"
      className="model-service-pill model-service-pill-danger"
      data-models-clear
      disabled={isEmpty || disabled}
      title={labels.clearModels}
      aria-label={labels.clearModels}
      onClick={confirm}>
      <Trash2 size={13} aria-hidden="true" />
      {labels.clearModels}
    </button>
  )
}
