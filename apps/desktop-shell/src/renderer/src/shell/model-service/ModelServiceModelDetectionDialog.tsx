import { useState } from 'react'
import { AlertTriangle, Square } from 'lucide-react'
import { Button, Modal } from 'antd'

import type { ModelDetectionMode } from '@platform/ai/providers/modelDetection/types'
import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

import type { PlatformText } from '../../i18n/platformText'

import { ModelServiceDetectionModeCard } from './ModelServiceDetectionModeCard'
import type { ModelDetectionProgress } from './useModelDetection'

/**
 * PLAT-82：「检测模型」对话框 = **两个可多选检测项** + 进度 + 停止。
 *
 * 产品决定（设计 §1）：联通性覆盖全部文本模型；协议支持只测已配置端点、仅聊天模型。
 * 关闭对话框 **≠** 取消：run 在内存里继续跑（停止只走 `stopModelDetection()`）。
 *
 * 视觉（不改语义）：460px 宽（与「请求配置」抽屉同宽）、标题 + 一行「将检测 n 个模型」、
 * 两个等宽卡片检测项、一行次色提示、运行中才出现的细进度条、底部「关闭 / 停止 / 开始」。
 * 颜色全部走主题变量，文案全部走 `platformText`。
 */
export type ModelServiceModelDetectionDialogProps = {
  open: boolean
  labels: PlatformText['models']
  models: readonly ModelDefinition[]
  /** 该供应商最近一次 run 的进度（没有 run 时 done/total 都是 0）。 */
  progress: ModelDetectionProgress
  running: boolean
  /** 有**任意**供应商的 run 在跑（切到别的供应商后仍能停 A）。 */
  stoppable?: boolean
  /** run 被用户停止（进度停在当前位置）。 */
  stopped: boolean
  /**
   * 本次 run 的协议汇总（只数真有协议结论的模型）；没勾协议模式 ⇒ `undefined`。
   * 来自内存结果，不落库。
   */
  protocolSummary?: { models: number; failed: number }
  /** 该供应商**已配置**的协议通道数（`configuredModelChatProtocols().length`）。 */
  configuredProtocolCount?: number
  onStart: (modes: readonly ModelDetectionMode[]) => void
  onStop: () => void
  onClose: () => void
}

const ALL_MODES: readonly ModelDetectionMode[] = ['connectivity', 'protocol']

const WARNING = 'var(--warning, #c48a2a)'

export function ModelServiceModelDetectionDialog({
  open,
  labels,
  models,
  progress,
  running,
  stoppable = false,
  stopped,
  protocolSummary,
  configuredProtocolCount,
  onStart,
  onStop,
  onClose
}: ModelServiceModelDetectionDialogProps): React.ReactElement {
  const [modes, setModes] = useState<readonly ModelDetectionMode[]>(ALL_MODES)

  const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)
  const startDisabled = running || modes.length === 0 || models.length === 0
  const canStop = running || stoppable
  // 未开始（没有任何 run）时整块隐藏：0/0 + 0% 只是噪音，开始之后保留最后一帧。
  const showProgress = progress.total > 0
  // 运行中的主按钮是禁用的，但 antd 默认禁用字色在深色底下几乎读不出「检测中 x/y」
  // （那是进度，不是灰掉的次操作）⇒ 只把字色提到正文色，底色仍用 antd 的中性禁用面。
  const runningPrimaryStyle: React.CSSProperties | undefined = running
    ? { color: 'var(--text)' }
    : undefined
  // 协议模式既没勾也没跑过 ⇒ 不出现任何协议文案（联通性模式的弹窗保持原样）。
  const protocolSelected = modes.includes('protocol')
  const showProtocolSummary = protocolSelected && protocolSummary !== undefined
  // 供应商只配了一条协议通道：必须让用户看出"只有 1 条可测"，而不是以为测了 4 条。
  const showSingleProtocolHint = protocolSelected && configuredProtocolCount === 1

  function toggle(mode: ModelDetectionMode): void {
    setModes((current) => {
      if (!current.includes(mode)) return [...current, mode]
      // 至少保留一个检测项：取消最后一个选中项是无操作（该 input 也直接 disabled）。
      if (current.length === 1) return current
      return current.filter((entry) => entry !== mode)
    })
  }

  const modeCards = [
    {
      mode: 'connectivity' as const,
      title: labels.detectModeConnectivity,
      hint: labels.detectModeConnectivityHint,
      scope: labels.detectModeConnectivityScope
    },
    {
      mode: 'protocol' as const,
      title: labels.detectModeProtocol,
      hint: labels.detectModeProtocolHint,
      scope: labels.detectModeProtocolScope
    }
  ]

  return (
    <Modal
      open={open}
      width={460}
      centered
      className="model-detect-modal"
      title={(
        <div style={{ display: 'flex', flexDirection: 'column', rowGap: 2, paddingRight: 24 }}>
          <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, lineHeight: '20px' }}>
            {labels.detectModels}
          </span>
          <span
            data-detect-count
            style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 400, lineHeight: '15px' }}>
            {labels.detectModelsCount(models.length)}
          </span>
        </div>
      )}
      onCancel={onClose}
      footer={null}
      destroyOnHidden>
      <div
        data-model-detect-dialog
        style={{ display: 'flex', flexDirection: 'column', rowGap: 14, paddingTop: 6 }}>
        <div data-detect-grid style={{ display: 'flex', flexDirection: 'column', rowGap: 8 }}>
          {modeCards.map((card) => {
            const selected = modes.includes(card.mode)
            return (
              <ModelServiceDetectionModeCard
                key={card.mode}
                mode={card.mode}
                title={card.title}
                hint={card.hint}
                scope={card.scope}
                checked={selected}
                /* 最后一项不能取消（至少选一个）；run 在跑时模式已被 run 快照固定。 */
                disabled={running || (selected && modes.length === 1)}
                onToggle={() => toggle(card.mode)}
              />
            )
          })}
          {showSingleProtocolHint ? (
            <span
              data-detect-protocol-single-channel
              style={{ paddingLeft: 10, color: 'var(--muted)', fontSize: 11, lineHeight: '15px' }}>
              {labels.detectProtocolSingleChannel}
            </span>
          ) : null}
          {/* 防御性提示：正常路径（至少一项、且最后一项不可取消）永远到不了这里。 */}
          {modes.length === 0 ? (
            <span data-detect-mode-required="true" style={{ color: WARNING, fontSize: 11, lineHeight: '15px' }}>
              {labels.detectModeRequired}
            </span>
          ) : null}
        </div>

        <div data-detect-warning style={{ display: 'flex', flexDirection: 'column', rowGap: 3 }}>
          <span style={{ display: 'flex', alignItems: 'flex-start', columnGap: 6 }}>
            <AlertTriangle
              size={12}
              aria-hidden="true"
              style={{ flex: '0 0 auto', marginTop: 2, color: 'color-mix(in srgb, var(--muted) 85%, transparent)' }}
            />
            <span style={{ color: 'var(--muted-strong)', fontSize: 11, lineHeight: '16px' }}>
              {labels.detectModelsWarning}
            </span>
          </span>
          <span style={{ paddingLeft: 18, color: 'var(--muted)', fontSize: 11, lineHeight: '15px' }}>
            {labels.detectSessionOnly}
          </span>
        </div>

        {showProgress ? (
          <div style={{ display: 'flex', flexDirection: 'column', rowGap: 6 }}>
            <div
              data-detect-progress
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                color: 'var(--muted)',
                fontSize: 11,
                lineHeight: '15px'
              }}>
              <span>
                {labels.detectProgress(progress.done, progress.total)}
                {stopped ? ` · ${labels.detectStopped}` : ''}
              </span>
              <span
                data-detect-percent
                style={{ color: 'var(--muted-strong)', fontVariantNumeric: 'tabular-nums' }}>
                {percent}%
              </span>
            </div>
            <div
              data-detect-progress-track
              role="progressbar"
              aria-label={labels.detectProgressTitle}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              style={{
                height: 4,
                borderRadius: 999,
                background: 'color-mix(in srgb, var(--border) 80%, transparent)',
                overflow: 'hidden'
              }}>
              <div
                data-detect-progress-fill
                style={{
                  width: `${percent}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: 'var(--accent)',
                  transition: 'width 200ms ease'
                }}
              />
            </div>
          </div>
        ) : null}

        {showProtocolSummary ? (
          <p
            data-model-detect-protocol-summary
            data-model-detect-protocol-summary-state={protocolSummary.failed === 0 ? 'passed' : 'failed'}
            style={{
              margin: 0,
              color: protocolSummary.failed === 0 ? 'var(--muted-strong)' : 'var(--danger)',
              fontSize: 11,
              lineHeight: '15px'
            }}>
            {protocolSummary.failed === 0
              ? labels.detectProtocolSummaryPassed(protocolSummary.models)
              : labels.detectProtocolSummaryFailed(protocolSummary.models, protocolSummary.failed)}
          </p>
        ) : null}

        <div
          data-detect-footer
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            columnGap: 8,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopStyle: 'solid',
            borderTopColor: 'var(--border)'
          }}>
          <Button data-detect-close type="text" onClick={onClose}>
            {labels.detectClose}
          </Button>
          {canStop ? (
            <Button
              data-detect-stop
              icon={<Square size={10} aria-hidden="true" />}
              onClick={onStop}>
              {labels.detectStop}
            </Button>
          ) : null}
          <Button
            data-detect-start
            data-detect-primary
            type="primary"
            disabled={startDisabled}
            style={runningPrimaryStyle}
            onClick={() => onStart(modes)}>
            {running ? labels.detectStartRunning(progress.done, progress.total) : labels.detectStart}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
