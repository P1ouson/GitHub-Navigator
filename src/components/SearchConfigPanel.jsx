import { useState } from 'react'
import { LANGUAGE_OPTIONS, DATE_OPTIONS, LABEL_OPTIONS } from '../lib/searchConfig.js'

export default function SearchConfigPanel({ config, onChange, onApply }) {
  const [open, setOpen] = useState(false)

  function toggleSource(key) {
    onChange({
      ...config,
      sources: { ...config.sources, [key]: { ...config.sources[key], enabled: !config.sources[key].enabled } },
    })
  }

  function setSourcePerPage(key, value) {
    onChange({
      ...config,
      sources: { ...config.sources, [key]: { ...config.sources[key], perPage: Number(value) } },
    })
  }

  function setFilter(key, value) {
    onChange({ ...config, filters: { ...config.filters, [key]: value } })
  }

  const enabledCount = Object.values(config.sources).filter(s => s.enabled).length

  return (
    <div className="config-panel">
      <button className="config-toggle" onClick={() => setOpen(!open)}>
        {open ? '收起配置' : '展开配置'}
        <span className="config-toggle-hint">
          {enabledCount} 个搜索源 · {config.filters.language || '全部语言'}
          {config.filters.minStars > 0 ? ` · ≥${config.filters.minStars}星` : ''}
        </span>
      </button>

      {open && (
        <div className="config-body">
          {/* 搜索源 */}
          <div className="config-section">
            <div className="config-section-title">搜索源</div>
            <div className="config-source-grid">
              {['repo', 'issue', 'code', 'qa'].map(key => (
                <div key={key} className="config-source-row">
                  <label className="config-checkbox">
                    <input
                      type="checkbox"
                      checked={config.sources[key].enabled}
                      onChange={() => toggleSource(key)}
                    />
                    <span className="config-source-label">
                      {key === 'repo' ? '📦 仓库' : key === 'issue' ? '📌 Issue' : key === 'code' ? '📝 代码' : '💡 问答'}
                    </span>
                  </label>
                  {key !== 'qa' && config.sources[key].enabled && (
                    <select
                      className="config-select-sm"
                      value={config.sources[key].perPage}
                      onChange={e => setSourcePerPage(key, e.target.value)}
                    >
                      <option value={5}>5条</option>
                      <option value={10}>10条</option>
                      <option value={20}>20条</option>
                      <option value={50}>50条</option>
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 过滤器 */}
          <div className="config-section">
            <div className="config-section-title">默认过滤器</div>
            <div className="config-filter-grid">
              <div className="config-field">
                <label className="config-label">语言</label>
                <select className="config-select" value={config.filters.language} onChange={e => setFilter('language', e.target.value)}>
                  {LANGUAGE_OPTIONS.map(l => <option key={l} value={l}>{l || '全部'}</option>)}
                </select>
              </div>
              <div className="config-field">
                <label className="config-label">最低星数</label>
                <select className="config-select" value={config.filters.minStars} onChange={e => setFilter('minStars', Number(e.target.value))}>
                  <option value={0}>不限</option>
                  <option value={10}>10+</option>
                  <option value={20}>20+</option>
                  <option value={50}>50+</option>
                  <option value={100}>100+</option>
                  <option value={500}>500+</option>
                </select>
              </div>
              <div className="config-field">
                <label className="config-label">标签</label>
                <select className="config-select" value={config.filters.labels} onChange={e => setFilter('labels', e.target.value)}>
                  {LABEL_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <div className="config-field">
                <label className="config-label">时间</label>
                <select className="config-select" value={config.filters.dateRange} onChange={e => setFilter('dateRange', e.target.value)}>
                  {DATE_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
            </div>
            <div className="config-filter-grid" style={{ marginTop: 12 }}>
              <div className="config-field">
                <label className="config-label">优先语言</label>
                <select className="config-select" value={config.filters.preferredLanguage || 'en'} onChange={e => setFilter('preferredLanguage', e.target.value)}>
                  <option value="">不限</option>
                  <option value="en">英文</option>
                  <option value="zh">中文</option>
                </select>
              </div>
            </div>
          </div>

          {/* LLM 提示 */}
          <div className="config-hint">
            提示：搜索时可用 <code>!language:python</code> <code>!stars:100</code> <code>!labels:bug</code> <code>!since:week</code> 临时覆盖过滤器。LLM 智能改写可在搜索框旁的「智能模式」开关控制。
          </div>

          {/* 操作按钮 */}
          <div className="config-actions">
            <button className="config-btn config-btn-apply" onClick={() => { onApply?.(); setOpen(false) }}>
              应用配置
            </button>
            <button className="config-btn config-btn-cancel" onClick={() => setOpen(false)}>
              收起
            </button>
          </div>
        </div>
      )}
    </div>
  )
}