import { Input } from 'antd'
import { Filter, Search, X } from 'lucide-react'

import { resolveProviderVisual } from '@platform/ui/icons/modelProviderVisuals'

import type { PlatformText } from '../../../i18n/platformText'
import { ModelAvailabilityIcon } from '../../model-service/ModelAvailabilityIcon'
import { modelProtocolLabel, type ModelProtocolTab } from '../../model-service/modelProtocolFilter'
import { getProviderIconUrl } from '../../visualIconAssets'
import {
  resolveModelPickerEmptyState,
  type ModelPickerCategory,
  type ModelPickerGroup,
  type ModelPickerOption,
  type ModelPickerOptions
} from './modelPickerOptions'

const CATEGORY_LABEL_KEYS: Record<ModelPickerCategory, keyof PlatformText['models']> = {
  vision: 'pickerCategoryVision',
  audio: 'pickerCategoryAudio',
  video: 'pickerCategoryVideo',
  reasoning: 'pickerCategoryReasoning',
  tools: 'pickerCategoryTools',
  deal: 'pickerCategoryDeal'
}

type ModelPickerPanelProps = {
  labels: PlatformText['models']
  built: ModelPickerOptions
  groups: readonly ModelPickerGroup[]
  value: string | null
  query: string
  categories: readonly ModelPickerCategory[]
  protocols: readonly ModelProtocolTab[]
  filtersOpen: boolean
  notice: string | null
  visibleCount: number
  onQueryChange: (query: string) => void
  onToggleCategory: (key: ModelPickerCategory) => void
  onToggleProtocol: (key: ModelProtocolTab) => void
  onToggleFilters: () => void
  onClearFilters: () => void
  onChoose: (option: ModelPickerOption) => void
  onSubmitQuery: () => void
  onClose: () => void
  onOpenModelService: () => void
}

/**
 * 选择器浮层：搜索 + 可收起的分类/协议筛选 + 按厂商分组的列表 + 底部跳转。
 * 纯渲染 + 回调，状态全部在 `ModelPicker`（关闭重开时保留筛选区展开状态与已选条件）。
 */
export function ModelPickerPanel({
  labels,
  built,
  groups,
  value,
  query,
  categories,
  protocols,
  filtersOpen,
  notice,
  visibleCount,
  onQueryChange,
  onToggleCategory,
  onToggleProtocol,
  onToggleFilters,
  onClearFilters,
  onChoose,
  onSubmitQuery,
  onClose,
  onOpenModelService
}: ModelPickerPanelProps): React.ReactElement {
  const hasActiveFilters = categories.length + protocols.length > 0
  // 空态原因由数据层按 constraints 推导（这里只渲染 title/hint，不写 if 堆）。
  const empty = resolveModelPickerEmptyState(built, visibleCount, labels)

  return (
    <div className="model-picker-panel" data-model-picker-panel>
      <label className="model-picker-search" data-model-picker-search>
        <Search size={13} aria-hidden="true" />
        <Input
          variant="borderless"
          size="small"
          value={query}
          placeholder={labels.pickerSearchPlaceholder}
          autoFocus
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
            if (event.key === 'Enter') onSubmitQuery()
          }}
        />
        {hasActiveFilters ? (
          <button
            type="button"
            className="model-picker-filter-action"
            data-model-picker-clear-filters
            aria-label={labels.pickerClearFilters}
            title={labels.pickerClearFilters}
            onClick={onClearFilters}>
            <X size={12} aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          className="model-picker-filter-action"
          data-model-picker-filter-toggle
          data-active={hasActiveFilters}
          aria-expanded={filtersOpen}
          aria-label={labels.pickerFilters}
          title={labels.pickerFilters}
          onClick={onToggleFilters}>
          <Filter size={14} aria-hidden="true" />
          {hasActiveFilters ? <i className="model-picker-filter-dot" data-model-picker-filter-dot /> : null}
        </button>
      </label>

      {notice ? (
        <p className="model-picker-notice" data-model-picker-notice>
          {notice}
        </p>
      ) : null}

      {hasActiveFilters && !filtersOpen ? (
        <p className="model-picker-filter-summary" data-model-picker-filter-summary>
          {labels.pickerFilteredCount(visibleCount)}
        </p>
      ) : null}

      <div
        className="model-picker-filters"
        data-model-picker-filters
        data-open={filtersOpen}
        hidden={!filtersOpen}
        style={{ display: filtersOpen ? 'flex' : 'none' }}>
        <div className="model-picker-chips" data-model-picker-categories>
          {built.categories.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="model-picker-chip"
              data-model-picker-category={chip.key}
              data-active={categories.includes(chip.key)}
              aria-pressed={categories.includes(chip.key)}
              onClick={() => onToggleCategory(chip.key)}>
              {String(labels[CATEGORY_LABEL_KEYS[chip.key]])}
              <small>{chip.count}</small>
            </button>
          ))}
        </div>

        {built.showProtocolFilter ? (
          <div className="model-picker-chips" data-model-picker-protocols>
            {built.protocols.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="model-picker-chip"
                data-model-picker-protocol={chip.key}
                data-active={protocols.includes(chip.key)}
                aria-pressed={protocols.includes(chip.key)}
                onClick={() => onToggleProtocol(chip.key)}>
                {modelProtocolLabel(labels, chip.key)}
                <small>{chip.count}</small>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="model-picker-list" role="listbox" aria-label={labels.pickerSelectModel}>
        {empty ? (
          <div className="model-picker-empty" data-model-picker-empty data-reason={empty.reason}>
            <p>{empty.title}</p>
            {empty.hint ? <small>{empty.hint}</small> : null}
            {empty.reason === 'no-match' && hasActiveFilters ? (
              <button
                type="button"
                className="model-picker-empty-clear"
                data-model-picker-empty-clear
                onClick={onClearFilters}>
                {labels.pickerClearFilters}
              </button>
            ) : null}
          </div>
        ) : (
          groups.map((group) => (
            <section className="model-picker-group" data-model-picker-group={group.providerId} key={group.providerId}>
              <header>{group.providerName}</header>
              {group.options.map((option) => {
                const optionLogo = getProviderIconUrl(providerIconKey(option.providerId))
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    className="model-picker-option"
                    data-model-picker-option={option.value}
                    aria-selected={option.value === value}
                    title={option.modelId}
                    onClick={() => onChoose(option)}>
                    {optionLogo ? <img src={optionLogo} alt="" aria-hidden="true" /> : null}
                    {option.priceTag !== null ? (
                      <span
                        className={`model-picker-option-tag is-${option.priceTag}`}
                        data-model-picker-price-tag={option.priceTag}>
                        {option.priceTag === 'free' ? labels.modelFreeTag : labels.pickerTagDiscount}
                      </span>
                    ) : null}
                    <span className="model-picker-option-name">{option.modelName}</span>
                    <ModelAvailabilityIcon labels={labels} view={option.availability} />
                    <small>{option.providerName}</small>
                  </button>
                )
              })}
            </section>
          ))
        )}
      </div>

      {built.footer ? (
        <button
          type="button"
          className="model-picker-footer"
          data-model-picker-footer
          onClick={onOpenModelService}>
          {built.footer.label ?? labels.pickerConfigureCustomModel}
        </button>
      ) : null}
    </div>
  )
}

function providerIconKey(providerId: string): string | undefined {
  const visual = resolveProviderVisual(providerId)
  return visual.iconKey ?? visual.key
}
