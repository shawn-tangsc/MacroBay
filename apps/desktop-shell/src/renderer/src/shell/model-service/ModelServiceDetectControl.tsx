import { useState } from 'react'
import { Button } from 'antd'

import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'
import { LoadingSpinner } from '@platform/ui/components/loading'

import type { PlatformText } from '../../i18n/platformText'

import { protocolRunSummary } from './modelDetectionDisplay'
import { ModelServiceModelDetectionDialog } from './ModelServiceModelDetectionDialog'
import type { UseModelDetection } from './useModelDetection'

/**
 * PLAT-82：工具条「检测模型」按钮 + 受控对话框。
 *
 * 运行态来自模块级内存 store（`useModelDetection`）：切页 / 切供应商都不取消，
 * 回到该供应商能看到进度与结果，停止只走 `stopModelDetection()`。
 */
export function ModelServiceDetectControl({
  labels,
  models,
  configuredProtocolCount,
  detection
}: {
  labels: PlatformText['models']
  models: readonly ModelDefinition[]
  /** 该供应商已配置的协议通道数（弹窗用它说明"只有 1 条协议可测"）。 */
  configuredProtocolCount?: number
  detection: UseModelDetection
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const { done, total } = detection.progress

  return (
    <>
      {/* 普通动作按档位：antd `Button` 默认档（不再挂 `model-service-pill`）。 */}
      <Button
        data-models-detect
        data-models-detect-running={detection.running ? 'true' : 'false'}
        icon={detection.running ? <LoadingSpinner size="sm" /> : undefined}
        onClick={() => setOpen(true)}>
        {detection.running ? `${labels.detectModels} ${done}/${total}` : labels.detectModels}
      </Button>

      <ModelServiceModelDetectionDialog
        open={open}
        labels={labels}
        models={models}
        progress={detection.progress}
        running={detection.running}
        stoppable={detection.running || detection.runningRunIds.length > 0}
        stopped={detection.run?.stopped === true}
        protocolSummary={protocolRunSummary(detection.run)}
        {...(configuredProtocolCount === undefined ? {} : { configuredProtocolCount })}
        onStart={(modes) => void detection.start(modes)}
        onStop={() => (detection.run === undefined ? detection.stop() : detection.stop(detection.run.runId))}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
