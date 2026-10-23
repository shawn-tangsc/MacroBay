import { useState } from 'react'
import { Button, Input } from 'antd'
import { Check } from 'lucide-react'

import { platformText } from '../../../i18n/platformText'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

export function InspectorPanel(): React.ReactElement {
  const language = useShellLanguage()
  const labels = platformText[language].workspace
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState(false)
  return (
    <section className="workspace-inspector-panel" aria-label={labels.inspectorTitle}>
      <label>
        <span>{labels.inspectorDraft}</span>
        <Input aria-label={labels.inspectorDraft} value={draft} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <Button aria-label={labels.inspectorSelection} icon={selected ? <Check size={14} /> : undefined} onClick={() => setSelected((value) => !value)}>
        {selected ? labels.inspectorSelected : labels.inspectorSelect}
      </Button>
    </section>
  )
}
