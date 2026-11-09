import type { AssistantEntity } from '@platform/ai/assistant-platform/schemas/assistantSchemas'
import type { AssistantTopicEntity } from '@platform/ai/assistant-platform/schemas/topicSchemas'
import { useConfirm } from '@platform/ui/components/confirm'
import { LoadingState } from '@platform/ui/components/loading'
import { Tabs } from '@platform/ui/components/tabs'
import type { PlatformText } from '../../i18n/platformText'
import { Button, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type AssistantSidePanelTab = 'assistants' | 'topics'

/** 页签与整组的读屏名：句子在 `assistants` 文案表里，键只回答「哪一句」。 */
const TAB_ASSISTANTS_KEY = 'assistants.sidePanel.tabAssistants'
const TAB_TOPICS_KEY = 'assistants.sidePanel.tabTopics'
const TAB_GROUP_KEY = 'assistants.sidePanel.tabGroup'

type AssistantSidePanelProps = {
  labels: PlatformText['assistants']
  assistants: AssistantEntity[]
  topics: AssistantTopicEntity[]
  /** First read of each list; later refreshes keep the current rows on screen. */
  assistantsLoading?: boolean
  topicsLoading?: boolean
  /** Copy for those first reads, when they are still in flight. */
  loadingLabel?: string
  activeTab: AssistantSidePanelTab
  activeAssistantId: string | null
  activeTopicId: string | null
  onTabChange: (tab: AssistantSidePanelTab) => void
  onSelectAssistant: (assistantId: string) => void
  onSelectTopic: (topicId: string) => void
  onCreateAssistant: () => void
  onCreateTopic: () => void
  onDeleteTopic?: (topicId: string) => Promise<void>
  /** 每次自增都表示「把读者送到话题列表」：输入条点了需要先选话题的按钮时由页面层加一。 */
  focusTopicsTick?: number
}

export function AssistantSidePanel({
  labels,
  assistants,
  topics,
  assistantsLoading = false,
  topicsLoading = false,
  loadingLabel,
  activeTab,
  activeAssistantId,
  activeTopicId,
  onTabChange,
  onSelectAssistant,
  onSelectTopic,
  onCreateAssistant,
  onCreateTopic,
  onDeleteTopic,
  focusTopicsTick = 0
}: AssistantSidePanelProps): React.ReactElement {
  const showingAssistants = activeTab === 'assistants'
  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null)
  const confirm = useConfirm()
  const deletingTopicIds = useRef(new Set<string>())
  const panelRef = useRef<HTMLElement | null>(null)

  // 到达后第一件事是选话题：焦点落到列表里第一个可选话题上，不靠读屏去猜列表在哪。
  useEffect(() => {
    if (focusTopicsTick === 0) return
    panelRef.current?.querySelector<HTMLButtonElement>('.assistant-side-panel-topic-select')?.focus()
  }, [focusTopicsTick])

  function confirmDeleteTopic(topic: AssistantTopicEntity): void {
    confirm({
      title: labels.deleteConversation,
      description: labels.deleteConversationConfirm(topic.name || labels.newTopic),
      confirmLabel: labels.deleteConversation,
      cancelLabel: labels.cancel,
      tone: 'danger',
      onConfirm: async () => {
        if (!onDeleteTopic || deletingTopicIds.current.has(topic.id)) return
        deletingTopicIds.current.add(topic.id)
        setDeletingTopicId(topic.id)
        try {
          await onDeleteTopic(topic.id)
        } finally {
          deletingTopicIds.current.delete(topic.id)
          setDeletingTopicId(null)
        }
      }
    })
  }

  return (
    <aside ref={panelRef} className="agent-side-panel assistant-side-panel">
      <Tabs
        ariaLabelKey={TAB_GROUP_KEY}
        items={[
          { value: 'assistants', labelKey: TAB_ASSISTANTS_KEY },
          { value: 'topics', labelKey: TAB_TOPICS_KEY }
        ]}
        onChange={(value) => onTabChange(value === 'assistants' ? 'assistants' : 'topics')}
        panels={{
          // 动作条属于面板：每个面板第一行是它自己的动作，下面是可滚动内容（`ui-conventions.md`
          // 的「按页签变化的动作条」）。它不在 tablist 里，也不随内容滚走。
          assistants: (
            <div className="agent-side-panel-panel">
              <div className="agent-side-panel-action">
                <Button className="agent-side-panel-add-button" icon={<Plus size={14} />} onClick={onCreateAssistant}>
                  {labels.addAssistant}
                </Button>
              </div>
              <div className="agent-side-panel-content">
                        <div className="assistant-side-panel-list">
                          {assistantsLoading && loadingLabel ? <LoadingState label={loadingLabel} minHeight={120} /> : null}
                          {!assistantsLoading ? assistants.map((assistant) => (
                            <button
                              key={assistant.id}
                              type="button"
                              className={assistant.id === activeAssistantId ? 'assistant-side-panel-item active' : 'assistant-side-panel-item'}
                              // 整行只有一个结果：切到这个助手；行内没有独立按钮，所以整行可点。
                              aria-current={assistant.id === activeAssistantId ? 'true' : undefined}
                              onClick={() => onSelectAssistant(assistant.id)}>
                              <span className="assistant-side-panel-item-icon">{assistant.icon}</span>
                              <span className="assistant-side-panel-item-copy">
                                <strong>{assistant.name}</strong>
                                <small>{assistant.description || labels.defaultAssistant}</small>
                              </span>
                            </button>
                          )) : null}
                        </div>
              </div>
            </div>
          ),
          topics: (
            <div className="agent-side-panel-panel">
              <div className="agent-side-panel-action">
                <Button className="agent-side-panel-add-button" icon={<Plus size={14} />} onClick={onCreateTopic}>
                  {labels.newTopic}
                </Button>
              </div>
              <div className="agent-side-panel-content">
                        <div className="assistant-side-panel-list">
                          {topicsLoading && loadingLabel ? <LoadingState label={loadingLabel} minHeight={120} /> : null}
                          {!topicsLoading && topics.length === 0 ? <p className="empty-state">{labels.noTopics}</p> : null}
                          {!topicsLoading && topics.map((topic) => {
                            const menuItems: MenuProps['items'] = [
                              {
                                key: 'delete',
                                label: labels.deleteConversation,
                                icon: <Trash2 size={14} />,
                                danger: true,
                                disabled: deletingTopicId === topic.id
                              }
                            ]
                            const menu: MenuProps = {
                              items: menuItems,
                              onClick: ({ key }) => {
                                if (key === 'delete') confirmDeleteTopic(topic)
                              }
                            }
                            return (
                              <Dropdown key={topic.id} menu={menu} trigger={['contextMenu']}>
                                <div
                                  className={topic.id === activeTopicId ? 'assistant-side-panel-item active' : 'assistant-side-panel-item'}
                                  aria-label={labels.deleteConversation}>
                                  <button
                                    type="button"
                                    className="assistant-side-panel-topic-select"
                                    onClick={() => onSelectTopic(topic.id)}>
                                    <span className="assistant-side-panel-item-copy">
                                      <strong>{topic.name || labels.newTopic}</strong>
                                    </span>
                                  </button>
                                  <Dropdown menu={menu} trigger={['click']}>
                                    <Button
                                      className="assistant-side-panel-topic-more"
                                      type="text"
                                      size="small"
                                      icon={<MoreHorizontal size={14} />}
                                      aria-label={labels.moreConversationActions}
                                      title={labels.moreConversationActions}
                                      onClick={(event) => event.stopPropagation()}
                                    />
                                  </Dropdown>
                                </div>
                              </Dropdown>
                            )
                          })}
                        </div>
              </div>
            </div>
          )
        }}
        resolveText={(key) =>
          key === TAB_ASSISTANTS_KEY ? labels.assistants : key === TAB_TOPICS_KEY ? labels.topics : labels.title
        }
        value={showingAssistants ? 'assistants' : 'topics'}
      />

    </aside>
  )
}
