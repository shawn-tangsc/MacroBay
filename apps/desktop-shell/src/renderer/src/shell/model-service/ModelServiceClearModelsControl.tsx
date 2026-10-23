import { useState } from 'react'
import { Modal } from 'antd'
import { Trash2 } from 'lucide-react'

import type { PlatformText } from '../../i18n/platformText'

type ModelServiceClearModelsControlProps = {
  labels: PlatformText['models']
  /** 该供应商当前模型总数（含归档的旧预设模型）；0 ⇒ 按钮 disabled。 */
  modelCount: number
  /** 保存中（同步/其它模型操作）时禁用，避免并发改同一份模型列表。 */
  disabled?: boolean
  /** 返回 true 表示清空成功（关闭弹窗）；false 保留弹窗，错误由调用方行内展示。 */
  onConfirm: () => Promise<boolean>
}

/**
 * PLAT-72：「清空模型」按钮 + 二次确认。
 *
 * 危险操作所以走 Modal 二次确认；确认后由调用方按**一次** `applyModelSync`（`toRemove` = 全部 id）
 * 提交 —— 复用既有通道与单事务写入，不新增 IPC，也不会出现"删了一半"。
 */
export function ModelServiceClearModelsControl({
  labels,
  modelCount,
  disabled = false,
  onConfirm
}: ModelServiceClearModelsControlProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const isEmpty = modelCount === 0

  async function confirm(): Promise<void> {
    setBusy(true)
    try {
      if (await onConfirm()) setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="model-service-pill model-service-pill-danger"
        data-models-clear
        data-models-clear-open={open ? 'true' : 'false'}
        disabled={isEmpty || disabled || busy}
        title={labels.clearModels}
        aria-label={labels.clearModels}
        onClick={() => setOpen(true)}>
        <Trash2 size={13} aria-hidden="true" />
        {labels.clearModels}
      </button>
      <Modal
        centered
        width={420}
        open={open}
        title={labels.clearModelsConfirmTitle}
        okText={labels.clearModels}
        cancelText={labels.cancel}
        confirmLoading={busy}
        okButtonProps={{ danger: true, 'data-models-clear-confirm-button': true } as never}
        cancelButtonProps={{ 'data-models-clear-cancel': true } as never}
        onOk={() => void confirm()}
        onCancel={() => setOpen(false)}>
        <p data-models-clear-confirm>{labels.clearModelsConfirmBody(modelCount)}</p>
      </Modal>
    </>
  )
}
