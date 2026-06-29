/**
 * 搜索结果展示子组件
 *
 * 从 SearchPage 内嵌组件迁出：
 *   - RankedSection: 结果分区容器
 *   - RankedItem: 单条结果卡片（repo/issue/code/web）
 *   - HoverCard: 悬浮评分卡
 *   - KnowledgeSection: 知识库分区
 *
 * 这些组件只依赖 item 数据 + beginnerScore 的纯函数，不依赖 orchestrator 内部态。
 */

import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { scoreIssue, scoreRepo, levelToStars, levelToClass } from '../../lib/beginnerScore.js'
import { labelTextColor, getLabelClass, livenessClass, livenessText } from './searchUi.js'

/** 悬浮卡片（评分 + 关键指标） */
export function HoverCard({ score, type, item }) {
  return (
    <div className="hover-card">
      <div className="hover-card-header">
        <span className={`hover-card-score ${levelToClass(score.level)}`}>
          {levelToStars(score.level)}
        </span>
        <span className="hover-card-score-num">{score.score}/100</span>
        <span className="hover-card-label">新手友好度</span>
      </div>
      {score.reasons.length > 0 && (
        <div className="hover-card-reasons">
          {score.reasons.map((r, i) => (
            <div key={i} className="hover-card-reason">• {r}</div>
          ))}
        </div>
      )}
      {type === 'issue' && (
        <div className="hover-card-meta">
          <div>评论数：{item.comments || 0}</div>
          <div>创建：{new Date(item.createdAt).toLocaleDateString()}</div>
          {item._repoHealth?.stars > 0 && <div>仓库 ★ {item._repoHealth.stars.toLocaleString()}</div>}
        </div>
      )}
      {type === 'repo' && (
        <div className="hover-card-meta">
          <div>★ {item.stars?.toLocaleString()} · ⑂ {item.forks?.toLocaleString()}</div>
          {item.openIssues > 0 && <div>Open Issues：{item.openIssues}</div>}
          {item.updatedAt && <div>更新：{new Date(item.updatedAt).toLocaleDateString()}</div>}
        </div>
      )}
    </div>
  )
}

/** 排名结果分区组件 */
export function RankedSection({ title, items }) {
  const safeItems = Array.isArray(items) ? items : []
  return (
    <div className="result-section">
      <div className="result-list">
        {safeItems.map((item, i) => <RankedItem key={item?.url || item?.id || i} item={item} />)}
      </div>
    </div>
  )
}

/** 单条结果卡片 */
export function RankedItem({ item }) {
  const [showHover, setShowHover] = useState(false)
  const navigate = useNavigate()
  const open = () => window.open(item.url, '_blank', 'noopener,noreferrer')
  const isGitHubAPI = item._source === 'github_api'

  const score = useMemo(() => {
    if (!isGitHubAPI) return null
    if (item._type === 'issue') return scoreIssue(item)
    if (item._type === 'repo') return scoreRepo(item)
    return null
  }, [item, isGitHubAPI])

  // 仓库卡片
  if (isGitHubAPI && item._type === 'repo') return (
    <div
      className="result-item"
      onClick={open}
      onMouseEnter={() => setShowHover(true)}
      onMouseLeave={() => setShowHover(false)}
      style={{ cursor: 'pointer', position: 'relative' }}
    >
      {score && (
        <div className={`score-badge ${levelToClass(score.level)}`} title={score.reasons.join('\n')}>
          {levelToStars(score.level)}
        </div>
      )}
      {showHover && score && <HoverCard score={score} type="repo" item={item} />}
      <div className="result-item-body">
        <div className="result-item-title">{item.name}</div>
        {item._matchHint && <div className="result-match-hint">匹配：{item._matchHint}</div>}
        {item.desc && <div className="result-item-desc">{item.desc}</div>}
        <div className="result-item-meta">
          {item.language && <span className="result-lang">{item.language}</span>}
          <span className="result-stat">★ {item.stars?.toLocaleString()}</span>
          <span className="result-stat">⑂ {item.forks?.toLocaleString()}</span>
          {item.openIssues > 0 && <span className="result-stat"># {item.openIssues}</span>}
        </div>
        <div className="result-item-actions">
          <button className="result-item-action" onClick={e => { e.stopPropagation(); navigate(`/analysis?url=${encodeURIComponent(item.name)}`) }}>分析此仓库</button>
          <button className="result-item-action" onClick={e => { e.stopPropagation(); navigate(`/contribute?url=${encodeURIComponent(item.name)}`) }}>开始贡献</button>
        </div>
      </div>
    </div>
  )

  // Issue 卡片
  if (isGitHubAPI && item._type === 'issue') {
    const health = item._repoHealth
    const liveness = health?.liveness
    return (
      <div
        className="result-item issue-result-item"
        onClick={open}
        onMouseEnter={() => setShowHover(true)}
        onMouseLeave={() => setShowHover(false)}
        style={{ cursor: 'pointer', position: 'relative' }}
      >
        {score && (
          <div className={`score-badge ${levelToClass(score.level)}`} title={score.reasons.join('\n')}>
            {levelToStars(score.level)}
          </div>
        )}
        {showHover && score && <HoverCard score={score} type="issue" item={item} />}
        <div className="result-item-body">
          <div className="result-item-title">{item.title}</div>
          {item.labels?.length > 0 && (
            <div className="issue-label-row">
              {item.labels.slice(0, 5).map(l => {
                const bg = `#${l.color}`
                const fg = labelTextColor(l.color)
                const cls = getLabelClass(l.name)
                return (
                  <span key={l.name} className={`issue-label-chip ${cls}`} style={{ background: bg, color: fg, borderColor: bg }}>{l.name}</span>
                )
              })}
            </div>
          )}
          <div className="result-item-meta">
            <span className="result-repo-name">{item.repo}</span>
            {liveness && (
              <span className={`liveness-badge ${livenessClass(liveness.level)}`}>{livenessText(liveness.level)}</span>
            )}
            {health?.language && <span className="result-stat">{health.language}</span>}
            {health?.stars > 0 && <span className="result-stat">★ {health.stars.toLocaleString()}</span>}
            {item.comments > 0 && <span className="result-stat">💬 {item.comments}</span>}
            <span className="result-stat">{new Date(item.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="result-item-actions">
            <button className="result-item-action" onClick={e => { e.stopPropagation(); navigate(`/analysis?url=${encodeURIComponent(item.repo)}`) }}>分析此仓库</button>
            <button className="result-item-action" onClick={e => { e.stopPropagation(); navigate(`/contribute?url=${encodeURIComponent(item.repo)}`) }}>开始贡献</button>
          </div>
        </div>
      </div>
    )
  }

  // 代码卡片
  if (isGitHubAPI && item._type === 'code') return (
    <div className="result-item" onClick={open} style={{ cursor: 'pointer' }}>
      <div className="result-item-body">
        <div className="result-item-title">{item.name}</div>
        <div className="result-item-meta">
          <span className="result-repo-name">{item.repo}</span>
          <span className="result-item-path">{item.path}</span>
        </div>
      </div>
    </div>
  )

  // SearXNG/网页卡片
  return (
    <div className="result-item searxng-result-item" onClick={open} style={{ cursor: 'pointer' }}>
      <div className="result-item-body">
        <div className="result-item-title">{item.title}</div>
        <div className="result-url">{item.url}</div>
        <div className="result-snippet">{item.desc}</div>
        <div className="result-item-meta">
          <span className="result-label">{item._label}</span>
          {item._engine && <span className="result-engine">{item._engine}</span>}
          {item._publishedDate && <span>{new Date(item._publishedDate).toLocaleDateString()}</span>}
        </div>
      </div>
    </div>
  )
}

/** 知识库分区 */
export function KnowledgeSection({ items }) {
  return (
    <div className="knowledge-section">
      <h3 className="result-section-title">
        📚 知识库 <span className="result-count">{items.length} 条相关结果</span>
      </h3>
      {items.map((item, i) => {
        const content = item.body || item.text || ''
        const source = item.source || item.category || ''
        return (
          <details key={item.id || `kb-${i}`} className="knowledge-card">
            <summary className="knowledge-title">
              <span>{item.title}</span>
              <span className="knowledge-category">{source}</span>
            </summary>
            <div className="knowledge-body">
              {content.split('\n').map((line, j) => (
                <p key={j} style={line.startsWith('•') ? { paddingLeft: '1em', textIndent: '-1em', marginBottom: 4 } : { marginBottom: 8 }}>{line}</p>
              ))}
            </div>
          </details>
        )
      })}
    </div>
  )
}
