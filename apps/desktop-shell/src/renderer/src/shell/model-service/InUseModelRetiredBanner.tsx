import { Button } from 'antd'
import { TriangleAlert } from 'lucide-react'

import { inUseModelRetiredStaleness, type InUseModelRetiredItem } from '@platform/ai/providers/inUseModelPatrol'

import type { PlatformText } from '../../i18n/platformText'

type InUseModelRetiredBannerProps = {
  labels: PlatformText['models']
  items: readonly InUseModelRetiredItem[]
  /** 「更换模型」只负责把用户带到模型服务页；**绝不自动切换**模型。 */
  onChangeModel: () => void
  /** 判定「结论有多旧」的时间点；测试可注入。 */
  now?: Date
}

/**
 * PLAT-75：顶部**持久**提示（不自动消失、不自动切模型）。
 * 同一模型重复巡检只保留一条；模型恢复后由巡检结果自愈移除。
 */
export function InUseModelRetiredBanner({
  labels,
  items,
  onChangeModel,
  now = new Date()
}: InUseModelRetiredBannerProps): React.ReactElement | null {
  if (items.length === 0) return null
  const names = items.map((item) => item.modelName).join(labels.modelNameListSeparator)

  // 旧结论不能当现在时说：超过阈值就降级措辞，并给出天数。
  const staleness = items.map((item) => inUseModelRetiredStaleness(item, now))
  const days = Math.max(...staleness.map((entry) => entry.days))
  const stale = staleness.some((entry) => entry.stale)

  return (
    <div className="in-use-model-retired-banner" data-in-use-model-retired role="alert">
      <TriangleAlert size={14} aria-hidden="true" />
      <span data-in-use-model-retired-text>
        {stale ? labels.inUseModelRetiredStale(names, days) : labels.inUseModelRetired(names)}
      </span>
      {stale ? null : (
        <span className="in-use-model-retired-age" data-in-use-model-retired-age>
          {labels.inUseModelRetiredCheckedAt(days)}
        </span>
      )}
      {/* 命令型动作 → antd `Button` 文本档 + `.text-action`（不再手写按钮）。 */}
      <Button type="text" size="small" className="text-action" data-in-use-model-retired-change onClick={onChangeModel}>
        {labels.changeModel}
      </Button>
    </div>
  )
}
