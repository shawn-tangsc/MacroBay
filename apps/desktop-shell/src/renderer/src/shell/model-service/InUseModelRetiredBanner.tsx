import { TriangleAlert } from 'lucide-react'

import type { InUseModelRetiredItem } from '@platform/ai/providers/inUseModelPatrol'

import type { PlatformText } from '../../i18n/platformText'

type InUseModelRetiredBannerProps = {
  labels: PlatformText['models']
  items: readonly InUseModelRetiredItem[]
  /** 「更换模型」只负责把用户带到模型服务页；**绝不自动切换**模型。 */
  onChangeModel: () => void
}

/**
 * PLAT-75：顶部**持久**提示（不自动消失、不自动切模型）。
 * 同一模型重复巡检只保留一条；模型恢复后由巡检结果自愈移除。
 */
export function InUseModelRetiredBanner({
  labels,
  items,
  onChangeModel
}: InUseModelRetiredBannerProps): React.ReactElement | null {
  if (items.length === 0) return null
  const names = items.map((item) => item.modelName).join('、')

  return (
    <div className="in-use-model-retired-banner" data-in-use-model-retired role="alert">
      <TriangleAlert size={14} aria-hidden="true" />
      <span data-in-use-model-retired-text>{labels.inUseModelRetired(names)}</span>
      <button type="button" className="model-service-link" data-in-use-model-retired-change onClick={onChangeModel}>
        {labels.changeModel}
      </button>
    </div>
  )
}
