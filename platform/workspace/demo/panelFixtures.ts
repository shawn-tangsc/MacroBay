import type { WorkspacePanelRegistration } from '../contracts'
import { WorkspaceRegistrationPolicy } from '../policies'

export const demoPanelRegistrations: readonly WorkspacePanelRegistration[] = [{
  panelId: 'platform.inspector',
  title: { 'zh-CN': '检查器', 'en-US': 'Inspector' },
  icon: 'file-text',
  module: 'platform.inspector',
  pageIds: ['platform.workspace-demo'],
  supportedModes: WorkspaceRegistrationPolicy.modes,
  defaultMode: 'embedded',
  allowMultipleInstances: false,
  minSize: WorkspaceRegistrationPolicy.minSize,
  preferredSize: WorkspaceRegistrationPolicy.preferredSize,
  binding: { persistence: 'none', maxKeyBytes: WorkspaceRegistrationPolicy.maxBindingKeyBytes },
  lifecycleEvents: WorkspaceRegistrationPolicy.lifecycleEvents
}]
export const demoPanelAllowlist = { pageIds: ['platform.workspace-demo'], moduleIds: ['platform.inspector'] }
