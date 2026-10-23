import { useEffect, useState } from 'react'
import { Button, Drawer } from 'antd'

import type {
  ProviderChatEndpoint,
  ProviderImageEndpoints,
  SafeModelProvider
} from '@platform/ai/providers/modelProviderTypes'

import type { PlatformText } from '../../i18n/platformText'

import { ModelServiceRequestConfigEndpointFields } from './ModelServiceRequestConfigEndpointFields'

/**
 * PLAT-81 / R3 + T4/T5：请求配置抽屉 —— **端点的唯一编辑入口**。
 *
 * 页面上的「API 地址」只有只读摘要（地址框 / 齿轮 /「添加端点」三个入口都开这一个抽屉）：
 * 两个区块自上而下 —— **聊天端点**（清单顺序即优先级，`[0]` = 默认端点）/ **图像**
 * （两个独立 Base URL），底部只有「关闭」。
 *
 * 端点清单是唯一事实源：编辑地址 / 添加 / 删除 / 设为默认都直接改写这份数组并立即落库，
 * 不再有"默认端点协议"这类需要单独同步的第二份字段。
 *
 * 「自定义请求头」暂时不暴露 UI（用户还没想好怎么用）：`ModelProvider.customHeaders`、
 * 存储列、请求头合并/校验等数据层保持原样，已有配置继续生效。
 */
type ImageEndpointKind = 'generation' | 'edit'

type Props = {
  open: boolean
  labels: PlatformText['models']
  provider: SafeModelProvider
  onClose: () => void
  /** 整份端点清单（顺序即优先级，`[0]` = 默认端点）。 */
  onSaveEndpoints: (endpoints: readonly ProviderChatEndpoint[]) => Promise<void>
  onSaveImageEndpoint: (kind: ImageEndpointKind, value: string | undefined) => Promise<void>
  /** 端点保存中（只锁「设为默认」按钮）。 */
  savingDefaultEndpoint?: boolean
}

export function ModelServiceRequestConfigDrawer({
  open,
  labels,
  provider,
  onClose,
  onSaveEndpoints,
  onSaveImageEndpoint,
  savingDefaultEndpoint = false
}: Props): React.ReactElement {
  const [endpoints, setEndpoints] = useState<ProviderChatEndpoint[]>([])
  const [imageEndpoints, setImageEndpoints] = useState<ProviderImageEndpoints>({})

  useEffect(() => {
    if (!open) return
    setEndpoints([...provider.endpoints])
    setImageEndpoints({ ...provider.imageEndpoints })
  }, [open, provider])

  return (
    <Drawer
      title={labels.requestConfig}
      placement="right"
      // 窄抽屉：440px，小屏时最多占 92vw（内容在抽屉内部滚动）。
      width={440}
      styles={{ wrapper: { maxWidth: '92vw' } }}
      open={open}
      onClose={onClose}
      className="model-drawer request-config-drawer"
      // 「关闭」放在 Drawer footer：内容滚动时仍常驻右下角。
      footer={(
        <div className="request-config-footer">
          <Button onClick={onClose} data-request-config-close>{labels.close}</Button>
        </div>
      )}>
      {/* 区块自己排版（两列行 + 区块标题），这里不用外层 grid。 */}
      <div className="request-config-grid" style={{ display: 'block' }}>
        <ModelServiceRequestConfigEndpointFields
          /* 换供应商/重新打开即重置逐行状态（子组件自带「添加端点」浮层状态）。 */
          key={`${provider.id}-${open ? 'open' : 'closed'}`}
          labels={labels}
          provider={provider}
          endpoints={endpoints}
          imageEndpoints={imageEndpoints}
          onChangeEndpoints={(next) => setEndpoints([...next])}
          onSaveEndpoints={onSaveEndpoints}
          onChangeImageEndpoint={(kind, value) => setImageEndpoints((current) => ({ ...current, [kind]: value }))}
          onSaveImageEndpoint={onSaveImageEndpoint}
          savingDefaultEndpoint={savingDefaultEndpoint}
        />
      </div>
    </Drawer>
  )
}
