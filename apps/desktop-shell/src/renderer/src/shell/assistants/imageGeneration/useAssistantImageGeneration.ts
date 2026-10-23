import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import type { PlatformText } from '../../../i18n/platformText'
import {
  describeImageEditValidationError,
  describeImageGenerationFailure,
  resolveImageEditTarget,
  resolveImageGenerationTarget,
  validateImageEditDraft,
  validateImageGenerationDraft,
  type ImageGenerationDraft,
  type ImageGenerationFailureLabels,
  type ImageEditDraft,
  type PendingImageEntry
} from './imageGenerationModel'

/** 主进程 `modelProviders.generateImage` 的窄返回形状（只取渲染层需要的字段）。 */
type ImageWireResult =
  | { ok: true; messageId?: unknown; imageCount?: unknown }
  | { ok: false; reasonCode?: unknown; messageId?: unknown }

type UseAssistantImageGenerationInput = {
  providers: readonly SafeModelProvider[]
  labels: PlatformText['assistants']
  failureLabels: ImageGenerationFailureLabels
  /** 当前话题：切换即清掉本地占位与错误（消息本身由主进程持久化）。 */
  topicId: string | null
  /** 派发前确保有一个话题（没有就建一个）；返回 null ⇒ 本次不派发。 */
  resolveTopicId: () => Promise<string | null>
  /** 主进程 settle 之后刷新消息列表（成功/失败都是真消息）。 */
  onMessagesChanged: (topicId: string) => Promise<void> | void
}

export type AssistantImageGenerationState = {
  target: ReturnType<typeof resolveImageGenerationTarget>
  editTarget: ReturnType<typeof resolveImageEditTarget>
  /** 生成中显示在消息列表末尾的本地占位（同一时刻最多一条）。 */
  pending: PendingImageEntry | null
  isGenerating: boolean
  /** 本地校验/派发前失败的人话错误（面板内显示）。 */
  errorText: string | null
  generate: (draft: ImageGenerationDraft) => Promise<boolean>
  edit: (draft: ImageEditDraft) => Promise<boolean>
}

/**
 * T2/T3：图像生成 / 编辑状态。
 *
 * 这里**不再保存 base64**：主进程先把 pending 消息落库、再把同一 id 的消息替换成图片 part；
 * 本 hook 只负责「派发前确保有话题 + 显示本地占位 + settle 后刷新消息」。
 */
export function useAssistantImageGeneration({
  providers,
  labels,
  failureLabels,
  topicId,
  resolveTopicId,
  onMessagesChanged
}: UseAssistantImageGenerationInput): AssistantImageGenerationState {
  const target = useMemo(() => resolveImageGenerationTarget(providers), [providers])
  const editTarget = useMemo(() => resolveImageEditTarget(providers), [providers])
  const [pending, setPending] = useState<PendingImageEntry | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  /** 本次请求归属的话题：为 null 的首次生成会顺手建话题，不能把刚建的当成「切走」。 */
  const requestTopicRef = useRef<string | null>(null)
  const previousTopicRef = useRef(topicId)

  useEffect(() => {
    if (previousTopicRef.current === topicId) return
    previousTopicRef.current = topicId
    if (requestTopicRef.current !== null && requestTopicRef.current === topicId) return
    setPending(null)
    setErrorText(null)
    setIsGenerating(false)
  }, [topicId])

  const run = useCallback(
    async (input: {
      kind: PendingImageEntry['kind']
      prompt: string
      target: { providerId: string; modelId: string } | null
      call: (topicId: string) => Promise<ImageWireResult>
    }): Promise<boolean> => {
      if (!input.target) {
        setErrorText(
          input.kind === 'edit' ? labels.imageEditTooltipDisabled : labels.imageFailureNoEndpoint
        )
        return false
      }
      const createdAt = Date.now()
      setErrorText(null)
      setIsGenerating(true)
      setPending({ id: `${input.kind}-${createdAt}`, createdAt, kind: input.kind, prompt: input.prompt })
      try {
        const resolvedTopicId = await resolveTopicId()
        if (!resolvedTopicId) {
          setErrorText(labels.imageFailureTopicMissing)
          return false
        }
        requestTopicRef.current = resolvedTopicId
        const result = await input.call(resolvedTopicId)
        await onMessagesChanged(resolvedTopicId)
        if (result.ok === true) return true
        // 已经落成错误消息 ⇒ 面板可以关（错误在消息里显示）；否则把原因留在面板里。
        if (result.messageId === undefined) {
          setErrorText(
            describeImageGenerationFailure(
              typeof result.reasonCode === 'string' ? result.reasonCode : null,
              failureLabels
            )
          )
          return false
        }
        return true
      } catch {
        setErrorText(describeImageGenerationFailure('unknown', failureLabels))
        return false
      } finally {
        requestTopicRef.current = null
        setPending(null)
        setIsGenerating(false)
      }
    },
    [failureLabels, labels, onMessagesChanged, resolveTopicId]
  )

  const generate = useCallback(
    async (draft: ImageGenerationDraft): Promise<boolean> => {
      const validation = validateImageGenerationDraft(draft)
      if (validation) {
        setErrorText(
          validation === 'prompt_required'
            ? labels.imagePromptRequired
            : validation === 'count_invalid'
              ? labels.imageFailureInvalidCount
              : labels.imageFailureInvalidSize
        )
        return false
      }
      if (!target) {
        setErrorText(labels.imageFailureNoEndpoint)
        return false
      }
      return run({
        kind: 'generate',
        prompt: draft.prompt,
        target,
        call: (resolvedTopicId) =>
          window.platform.modelProviders.generateImage({
            providerId: target.providerId,
            modelId: target.modelId,
            prompt: draft.prompt,
            size: draft.size,
            count: draft.count,
            topicId: resolvedTopicId,
            operation: 'generate'
          }) as Promise<ImageWireResult>
      })
    },
    [labels, run, target]
  )

  const edit = useCallback(
    async (draft: ImageEditDraft): Promise<boolean> => {
      const validation = validateImageEditDraft(draft)
      if (validation) {
        setErrorText(describeImageEditValidationError(validation, labels))
        return false
      }
      if (!editTarget) {
        setErrorText(labels.imageEditTooltipDisabled)
        return false
      }
      return run({
        kind: 'edit',
        prompt: draft.prompt,
        target: editTarget,
        call: (resolvedTopicId) =>
          window.platform.modelProviders.generateImage({
            providerId: editTarget.providerId,
            modelId: editTarget.modelId,
            prompt: draft.prompt,
            size: draft.size,
            count: 1,
            topicId: resolvedTopicId,
            operation: 'edit',
            sourceImage: draft.source
          }) as Promise<ImageWireResult>
      })
    },
    [editTarget, labels, run]
  )

  return { target, editTarget, pending, isGenerating, errorText, generate, edit }
}
