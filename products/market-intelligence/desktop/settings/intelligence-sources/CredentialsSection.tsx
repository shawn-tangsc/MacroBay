import { useState } from 'react'
import { Button, Input } from 'antd'

export function CredentialsSection(props: {
  sourceId: string
  visible: boolean
  maskedPreview?: string
  labels: {
    title: string
    credentialRef: string
    testCredentials: string
    placeholder: string
    requestBudget?: string
  }
  requestBudget?: { maxRequests: number; windowSeconds: number }
  testing: boolean
  onTest: (credentialDraft: string) => Promise<boolean>
}): React.ReactElement | null {
  const [draft, setDraft] = useState('')
  if (!props.visible) return null

  return (
    <section className="intelligence-section">
      <div className="intelligence-section-title">{props.labels.title}</div>
      <div className="intelligence-setting-row intelligence-secret-row">
        <span className="intelligence-setting-label">{props.labels.credentialRef}</span>
        <div className="intelligence-setting-control">
          <Input.Password
            className="intelligence-secret-input"
            value={draft}
            placeholder={props.maskedPreview ?? props.labels.placeholder}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
      </div>
      <div className="intelligence-section-actions">
        <Button
          className="ant-secondary-button"
          size="small"
          loading={props.testing}
          onClick={() => {
            void props.onTest(draft).then((saved) => {
              if (saved) setDraft('')
            })
          }}
        >
          {resolveCredentialActionLabel(props.sourceId, props.labels)}
        </Button>
      </div>
      {props.requestBudget && props.labels.requestBudget ? <div className="intelligence-setting-hint">{props.labels.requestBudget.replace('{maxRequests}', String(props.requestBudget.maxRequests)).replace('{windowSeconds}', String(props.requestBudget.windowSeconds))}</div> : null}
    </section>
  )
}

export function resolveCredentialActionLabel(sourceId: string, labels: { testCredentials: string; saveApiKey?: string }): string {
  return sourceId === '0xrouter-aggregate-provider' ? (labels.saveApiKey ?? labels.testCredentials) : labels.testCredentials
}
