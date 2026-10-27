import { message } from 'antd'
import { useState } from 'react'
import type { AssistantTemplateDetail } from '@platform/ai/assistant-platform/library/assistantTemplateSchemas'
import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { platformText } from '../../../i18n/platformText'
import { AssistantLibraryCategoryRail } from '../../assistants/library/AssistantLibraryCategoryRail'
import { AssistantTemplateDetailDialog } from '../../assistants/library/AssistantTemplateDetailDialog'
import { AssistantLibraryToolbar } from '../../assistants/library/AssistantLibraryToolbar'
import { AssistantTemplateGrid } from '../../assistants/library/AssistantTemplateGrid'
import { CreateAssistantDialog } from '../../assistants/library/CreateAssistantDialog'
import { ImportAssistantDialog } from '../../assistants/library/ImportAssistantDialog'
import { useAssistantLibrary } from '../../assistants/library/useAssistantLibrary'

type AssistantLibrarySettingsPageProps = {
  language: AppLanguage
  onManageAssistants: () => void
}

export function AssistantLibrarySettingsPage({
  language,
  onManageAssistants
}: AssistantLibrarySettingsPageProps): React.ReactElement {
  const labels = platformText[language].assistants.library
  const library = useAssistantLibrary(language)
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailTemplate, setDetailTemplate] = useState<AssistantTemplateDetail | null>(null)
  const [detailInstalling, setDetailInstalling] = useState(false)
  const activeProductGroup = library.selectedProductId
    ? library.productGroups.find((group) => group.id === library.selectedProductId)
    : null
  const activeGroup = library.groups.find((group) => group.id === library.selectedGroup)
  const activeTitle = activeProductGroup?.name ?? labels.groups[library.selectedGroup]
  const activeCount = activeProductGroup?.count ?? activeGroup?.count ?? library.items.length

  async function installTemplate(templateId: string): Promise<void> {
    await library.installTemplate(templateId)
    message.success(labels.installedMessage)
  }

  async function openTemplateDetail(templateId: string): Promise<void> {
    const detail = await library.getTemplateDetail(templateId)
    setDetailTemplate(detail)
    setDetailOpen(Boolean(detail))
  }

  async function installTemplateFromDetail(templateId: string): Promise<void> {
    setDetailInstalling(true)
    try {
      await installTemplate(templateId)
      setDetailOpen(false)
      setDetailTemplate(null)
    } finally {
      setDetailInstalling(false)
    }
  }

  async function createAssistant(input: Parameters<typeof library.createAssistant>[0]): Promise<void> {
    await library.createAssistant(input)
    message.success(labels.created)
  }

  return (
    <section className="settings-workspace assistant-library-settings">
      <div className="assistant-library-shell">
        <AssistantLibraryCategoryRail
          labels={labels}
          groups={library.groups}
          selectedGroup={library.selectedGroup}
          productGroups={library.productGroups}
          selectedProductId={library.selectedProductId}
          onSelectGroup={library.setSelectedGroup}
          onSelectProduct={library.setSelectedProductId}
        />
        <main className="assistant-library-main">
          <AssistantLibraryToolbar
            labels={labels}
            title={activeTitle}
            count={activeCount}
            search={library.search}
            onSearchChange={library.setSearch}
            onImport={() => setImportOpen(true)}
            onManage={onManageAssistants}
            onCreate={() => setCreateOpen(true)}
          />
          {library.error ? <p className="assistant-library-error">{library.error}</p> : null}
          <AssistantTemplateGrid
            labels={labels}
            items={library.items}
            loading={library.loading}
            loadingLabel={platformText[language].status.loading}
            onInstall={(templateId) => void installTemplate(templateId)}
            onOpen={(templateId) => void openTemplateDetail(templateId)}
          />
        </main>
      </div>
      <AssistantTemplateDetailDialog
        labels={labels}
        template={detailTemplate}
        open={detailOpen}
        installing={detailInstalling}
        onClose={() => setDetailOpen(false)}
        onInstall={(templateId) => void installTemplateFromDetail(templateId)}
      />
      <CreateAssistantDialog
        labels={labels}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createAssistant}
      />
      <ImportAssistantDialog
        labels={labels}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={createAssistant}
      />
    </section>
  )
}
