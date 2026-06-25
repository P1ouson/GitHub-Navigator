/**
 * 筛选面板子组件
 *
 * 从 SearchPage 内嵌组件迁出：
 *   - FilterPanel: 通用筛选面板（issue + repo 共用）
 *   - FilterSection: 单个筛选分区
 *
 * 纯 UI 组件，只依赖传入的 sections 配置，不依赖 orchestrator。
 */

/** 通用筛选面板（issue + repo 共用） */
export function FilterPanel({ type, onClearAll, sections }) {
  const hasActiveFilter = sections.some(s => s.selected.size > 0)
  return (
    <div className="filter-panel">
      <div className="filter-panel-header">
        <span className="filter-panel-title">🔍 筛选</span>
        {hasActiveFilter && (
          <button className="filter-panel-clear" onClick={onClearAll}>清除全部</button>
        )}
      </div>
      {sections.map(section => (
        <FilterSection key={section.title} section={section} />
      ))}
    </div>
  )
}

/** 单个筛选分区 */
export function FilterSection({ section }) {
  const { title, items, selected, onToggle, popularKeys, showAll, onToggleShowAll, lockedKeys } = section
  if (!items || items.length === 0) return null

  const hasPopular = popularKeys && popularKeys.size > 0
  const popularItems = hasPopular ? items.filter(it => popularKeys.has(it.key)) : items
  const otherItems = hasPopular ? items.filter(it => !popularKeys.has(it.key)) : []
  const displayOther = showAll ? otherItems : otherItems.slice(0, 5)

  const renderCheckbox = (it) => {
    const isSelected = selected.has(it.key)
    const isLocked = lockedKeys && lockedKeys.has(it.key)
    const color = it.color
    const bg = color ? `#${color}` : null
    return (
      <label key={it.key} className={`filter-checkbox-item${isLocked ? ' filter-checkbox-locked' : ''}`} title={isLocked ? `${it.name}（搜索词匹配，不可取消）` : it.name}>
        <input type="checkbox" checked={isSelected} disabled={isLocked} onChange={() => onToggle(it.key)} />
        {bg && <span className="filter-checkbox-box" style={{ background: bg }} />}
        <span className="filter-checkbox-label">{it.name}</span>
        {isLocked && <span className="filter-checkbox-lock">🔒</span>}
      </label>
    )
  }

  return (
    <div className="filter-section">
      <div className="filter-section-title">{title}</div>
      <div className="filter-checkbox-list">
        {popularItems.map(renderCheckbox)}
        {displayOther.map(renderCheckbox)}
        {hasPopular && otherItems.length > 5 && (
          <button className="filter-show-more" onClick={onToggleShowAll}>
            {showAll ? '收起' : `+${otherItems.length - 5} 个`}
          </button>
        )}
      </div>
    </div>
  )
}
