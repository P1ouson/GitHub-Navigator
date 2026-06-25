import { useState, useEffect } from 'react'
import { getContributions, getContributionStats } from '../lib/db.js'
import { searchBeginnerIssues, batchGetRepoInfos } from '../lib/github.js'
import { matchAnyKeyword } from '../lib/keywordMatch.js'

/**
 * 技术领域定义：每个领域对应一组关键词，用于从贡献记录中识别技术栈。
 * 短关键词（≤3 字符）用单词边界匹配，避免误匹配（如 go 不匹配 google）。
 */
const TECH_DOMAINS = [
  { key: 'frontend', label: '前端能力', keywords: ['javascript', 'typescript', 'react', 'vue', 'angular', 'css', 'html', 'frontend', 'nextjs', 'next.js', 'svelte', 'tailwind', 'vite', 'webpack'] },
  { key: 'backend', label: '后端能力', keywords: ['python', 'java', 'golang', 'rust', 'nodejs', 'node.js', 'node', 'backend', 'spring', 'django', 'flask', 'express', 'fastapi', 'laravel', 'gin'] },
  { key: 'devops', label: 'DevOps', keywords: ['docker', 'kubernetes', 'k8s', 'jenkins', 'terraform', 'ansible', 'helm', 'devops', 'pipeline', 'deploy', 'github-actions'] },
  { key: 'database', label: '数据库', keywords: ['mysql', 'postgres', 'postgresql', 'redis', 'mongodb', 'mongo', 'sqlite', 'database', 'prisma', 'dynamodb', 'sql'] },
  { key: 'aiml', label: 'AI/ML', keywords: ['tensorflow', 'pytorch', 'machine-learning', 'deep-learning', 'neural', 'transformer', 'llm', 'gpt', 'embedding'] },
  { key: 'mobile', label: '移动开发', keywords: ['android', 'flutter', 'react-native', 'reactnative', 'swift', 'kotlin', 'mobile', 'xcode', 'ios'] },
  { key: 'docs', label: '文档贡献', keywords: ['documentation', 'markdown', 'readme', 'tutorial', 'handbook', 'docs', 'guide', 'wiki'] },
  { key: 'community', label: '社区参与', keywords: ['issue', 'comment', 'review', 'discussion', 'help', 'question', 'support'] },
]

/** 短关键词用单词边界匹配，长关键词用包含匹配（转发到公共模块） */
function matchDomain(text, keywords) {
  return matchAnyKeyword(text, keywords)
}

/**
 * 综合分计算（保留原有逻辑，用于头部等级展示）
 */
function calcProfileScore(stats) {
  const forkScore = Math.min(100, (stats.forks / 3) * 100)
  const prScore = Math.min(100, (stats.prs / 3) * 100)
  const exploreScore = Math.min(100, (stats.repos / 5) * 100)
  const activityScore = Math.min(100, (stats.total / 10) * 100)
  const total = Math.round((forkScore + prScore + exploreScore + activityScore) / 4)
  return { total, fork: Math.round(forkScore), pr: Math.round(prScore), explore: Math.round(exploreScore), activity: Math.round(activityScore) }
}

function getLevel(score) {
  if (score >= 80) return { label: '开源达人', icon: '🏆' }
  if (score >= 50) return { label: '活跃贡献者', icon: '⭐' }
  if (score >= 20) return { label: '初级贡献者', icon: '🌱' }
  return { label: '开源新手', icon: '🌱' }
}

/**
 * 技术雷达图得分：按领域统计贡献数（PR=3 / Fork=2 / Issue=1 权重），归一化到 0-100。
 * 匹配来源：repo 名 + language 字段 + detail 文本
 */
function calcTechRadar(contributions) {
  const counts = {}
  TECH_DOMAINS.forEach(d => { counts[d.key] = 0 })
  contributions.forEach(c => {
    // 包含 language 字段，提高技术栈识别召回率
    const text = `${c.repo} ${c.language || ''} ${c.detail || ''}`.toLowerCase()
    const weight = c.type === 'pr' ? 3 : c.type === 'fork' ? 2 : 1
    TECH_DOMAINS.forEach(d => {
      if (matchDomain(text, d.keywords)) counts[d.key] += weight
    })
    // 社区参与：Issue 类型贡献直接计入
    if (c.type === 'issue') counts.community += 2
  })
  return TECH_DOMAINS.map(d => ({
    key: d.key,
    label: d.label,
    count: counts[d.key],
    score: Math.min(100, Math.round(counts[d.key] * 15)),
  }))
}

/**
 * 贡献质量评估：全部基于真实数据，不做估算。
 * - PR 被合并率：stats.mergeRate（真实）
 * - 代码贡献量：stats.totalLines（真实，additions+deletions）
 * - 活跃持续性：连续贡献月数 / 总活跃月数（真实计算）
 * - 影响力：参与仓库数 + Issue 参与数（真实数据归一化）
 * - 贡献类型分布：Fork/PR/Issue 占比（真实计算）
 *
 * 质量分加权：PR合并率 30% + 代码贡献量 20% + 活跃持续性 25% + 影响力 25%
 */
function calcQuality(stats, contributions) {
  // PR 合并率：真实数据
  const mergeRate = stats.mergeRate || 0
  const mergedPRs = stats.mergedPRs || 0
  const prs = stats.prs || 0

  // 代码贡献量：真实数据
  const totalLines = stats.totalLines || 0
  const additions = stats.totalAdditions || 0
  const deletions = stats.totalDeletions || 0

  // 活跃持续性：从 contributions 的 createdAt 真实计算连续月数
  const months = new Set(
    contributions.map(c => (c.createdAt || '').slice(0, 7)).filter(Boolean)
  )
  const monthList = [...months].sort()
  // 空数据时 maxConsec=0，避免与 activeMonths=0 矛盾
  let consecutive = 0
  let maxConsec = 0
  for (let i = 0; i < monthList.length; i++) {
    if (i === 0) { consecutive = 1; maxConsec = 1; continue }
    // 用年月直接比较，避免 30 天近似导致的跨月判定错误
    const [py, pm] = monthList[i - 1].split('-').map(Number)
    const [cy, cm] = monthList[i].split('-').map(Number)
    const diffMonths = (cy - py) * 12 + (cm - pm)
    if (diffMonths <= 1) { consecutive++; maxConsec = Math.max(maxConsec, consecutive) }
    else consecutive = 1
  }
  const activeMonths = stats.activeMonths || monthList.length
  const continuity = activeMonths === 0 ? 0 : Math.round((maxConsec / activeMonths) * 100)

  // 影响力：参与仓库数 + Issue 参与数（每仓库 5 分，每 Issue 3 分，上限 100）
  const repos = stats.repos || 0
  const issues = stats.issues || 0
  const influence = Math.min(100, repos * 5 + issues * 3)

  // 贡献类型分布：真实数据
  const total = stats.total || 1
  const distribution = [
    { label: 'Fork', value: stats.forks, percent: Math.round(stats.forks / total * 100), color: 'var(--accent)' },
    { label: 'PR', value: stats.prs, percent: Math.round(stats.prs / total * 100), color: 'var(--green)' },
    { label: 'Issue', value: stats.issues, percent: Math.round(stats.issues / total * 100), color: 'var(--amber)' },
  ]

  // 质量分计算（合理加权）：
  // - PR合并率 30%（反映代码质量，被合并说明代码被接受）
  // - 代码贡献量 20%（反映贡献深度，2000 行 = 100 分，区分度更好）
  // - 活跃持续性 25%（反映坚持程度，连续月数/总月数）
  // - 影响力 25%（反映社区参与度，仓库数+Issue数归一化）
  const codeScore = Math.min(100, Math.round(totalLines / 2000 * 100))
  const qualityScore = Math.round(
    mergeRate * 0.30 + codeScore * 0.20 + continuity * 0.25 + influence * 0.25
  )
  const grade = qualityScore >= 85 ? 'S'
    : qualityScore >= 70 ? 'A'
    : qualityScore >= 50 ? 'B'
    : qualityScore >= 30 ? 'C' : 'D'

  return {
    mergeRate, mergedPRs, prs,
    totalLines, additions, deletions, codeScore,
    continuity, maxConsec, activeMonths,
    influence, repos, issues,
    distribution, qualityScore, grade,
  }
}

export default function ProfilePage() {
  const [stats, setStats] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [radarScores, setRadarScores] = useState([])
  const [quality, setQuality] = useState(null)
  const [issues, setIssues] = useState([])
  const [loadingIssues, setLoadingIssues] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [s, t] = await Promise.all([getContributionStats(), getContributions()])
    setStats(s); setTimeline(t)
    const radar = calcTechRadar(t)
    setRadarScores(radar)
    setQuality(calcQuality(s, t))
    loadPersonalizedIssues(radar)
  }

  /** 基于雷达图得分最高的 2-3 个领域，推荐中型仓库（50-5000星）的 good first issue */
  async function loadPersonalizedIssues(radar) {
    setLoadingIssues(true)
    const top = radar
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
    // 无得分领域时，默认推荐前端 + 后端
    const domains = top.length > 0 ? top : [radar[0], radar[1]]

    // 领域 → 语言映射
    const DOMAIN_LANGUAGE = {
      frontend: 'JavaScript',
      backend: 'Python',
      devops: 'Shell',
      database: 'SQL',
      aiml: 'Python',
      mobile: 'Swift',
      docs: 'Markdown',
      community: '', // 无语言过滤
    }

    const results = []
    for (const domain of domains) {
      const language = DOMAIN_LANGUAGE[domain.key]
      try {
        const items = await searchBeginnerIssues(language, 3)
        items.forEach(item => {
          results.push({
            ...item,
            domain: domain.label,
          })
        })
      } catch { /* 静默：Token 未配置或网络错误 */ }
    }

    // 批量获取仓库星数（用于排序和展示）
    if (results.length) {
      const repoNames = [...new Set(results.map(r => r.repo))]
      try {
        const { map } = await batchGetRepoInfos(repoNames)
        results.forEach(r => { r.stars = map.get(r.repo)?.stars || 0 })
      } catch { /* 静默 */ }
    }

    // 按仓库星数升序排（小仓库优先，对新手更友好）
    results.sort((a, b) => (a.stars || 0) - (b.stars || 0))

    // 构建具体推荐理由（含星数）
    results.forEach(r => {
      const starsText = r.stars ? `${r.stars} 星的` : ''
      r.reason = `基于你的 ${r.domain} 贡献记录，推荐这个 ${starsText}中型仓库`
    })

    setIssues(results.slice(0, 9))
    setLoadingIssues(false)
  }

  const score = stats ? calcProfileScore(stats) : null
  const level = score ? getLevel(score.total) : null
  const uniqueRepos = [...new Set(timeline.map(t => t.repo))]

  return (
    <section className="section">
      <div className="section-inner">
        <div className="section-header">
          <div className="section-label">模块五</div>
          <h2>能力画像</h2>
          <p>技术雷达图 + 贡献质量评估 + 个性化 Issue 推荐</p>
        </div>

        {/* 空状态：引导用户开始贡献 */}
        {!stats?.total && (
          <div className="empty-cta-card">
            <div className="empty-cta-icon">🚀</div>
            <div className="empty-cta-title">还没有贡献记录</div>
            <div className="empty-cta-desc">
              去贡献助手完成第一次开源贡献，这里会展示你的技术雷达图、贡献质量评估和个性化 Issue 推荐
            </div>
            <a className="empty-cta-btn" href="/contribute">前往贡献助手 →</a>
          </div>
        )}

        {/* 概览栏：等级 + 综合分 + 质量评级 + 关键数字（一行紧凑展示） */}
        {score && level && quality && (
          <div className="profile-overview">
            <div className="profile-overview-level">
              <span className="profile-level-icon">{level.icon}</span>
              <div className="profile-level-text">
                <span className="profile-level-label">{level.label}</span>
                <span className="profile-total-label">综合分</span>
              </div>
              <div className="profile-total-score" style={{ color: scoreColor(score.total) }}>{score.total}</div>
            </div>
            <div className="profile-overview-divider" />
            <div className="profile-overview-grade">
              <span className="profile-grade-label">质量评级</span>
              <span className="profile-grade-value" style={{ color: scoreColor(quality.qualityScore) }}>{quality.grade}</span>
            </div>
            <div className="profile-overview-divider" />
            <div className="profile-overview-stats">
              <div className="overview-stat">
                <span className="overview-stat-num">{stats.total}</span>
                <span className="overview-stat-label">总贡献</span>
              </div>
              <div className="overview-stat">
                <span className="overview-stat-num">{stats.repos}</span>
                <span className="overview-stat-label">参与仓库</span>
              </div>
              <div className="overview-stat">
                <span className="overview-stat-num">{stats.activeMonths}</span>
                <span className="overview-stat-label">活跃月数</span>
              </div>
            </div>
          </div>
        )}

        {/* 雷达图（左）+ 质量卡片（右）并排展示 */}
        {radarScores.length > 0 && quality && (
          <div className="profile-radar-quality-row">
            <div className="profile-radar-col">
              <div className="growth-section-title">技术雷达图</div>
              <TechRadar scores={radarScores} />
            </div>
            <div className="profile-quality-col">
              <div className="growth-section-title">贡献质量评估</div>
              <QualityAssessment quality={quality} />
            </div>
          </div>
        )}

        {/* 参与仓库（独立滚动） */}
        {uniqueRepos.length > 0 && (
          <div>
            <div className="growth-section-title">参与仓库 <span className="result-count">{uniqueRepos.length}</span></div>
            <div className="scroll-panel">
              <div className="profile-repo-list">
                {uniqueRepos.map(repo => (
                  <div key={repo} className="profile-repo-item">
                    <span className="profile-repo-name">{repo}</span>
                    <span className="data-source">{timeline.filter(t => t.repo === repo).length} 次贡献</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 模块3：个性化 Issue 推荐 */}
        <div>
          <div className="growth-section-title">个性化 Issue 推荐 <span className="data-source">← GitHub API</span></div>
          <PersonalizedIssues issues={issues} loading={loadingIssues} hasProfile={radarScores.some(s => s.score > 0)} />
        </div>
      </div>
    </section>
  )
}

/* ===== 模块1：技术雷达图（纯 SVG） ===== */
function TechRadar({ scores }) {
  const size = 360
  const cx = size / 2
  const cy = size / 2
  const R = 115
  const n = scores.length
  const angle = i => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const point = (i, ratio) => [cx + R * ratio * Math.cos(angle(i)), cy + R * ratio * Math.sin(angle(i))]
  const levels = [0.25, 0.5, 0.75, 1]

  return (
    <div className="tech-radar">
      <svg className="radar-svg" viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        {/* 网格多边形 */}
        {levels.map(lv => (
          <polygon key={lv} className="radar-grid"
            points={scores.map((_, i) => point(i, lv).join(',')).join(' ')} />
        ))}
        {/* 轴线 */}
        {scores.map((_, i) => {
          const [x, y] = point(i, 1)
          return <line key={i} className="radar-axis" x1={cx} y1={cy} x2={x} y2={y} />
        })}
        {/* 数据多边形 */}
        <polygon className="radar-data"
          points={scores.map((s, i) => point(i, s.score / 100).join(',')).join(' ')} />
        {/* 数据点 */}
        {scores.map((s, i) => {
          const [x, y] = point(i, s.score / 100)
          return <circle key={i} className="radar-data-point" cx={x} cy={y} r={3.5} />
        })}
        {/* 轴标签 */}
        {scores.map((s, i) => {
          const [lx, ly] = point(i, 1.2)
          return (
            <text key={i} className="radar-labels" x={lx} y={ly} textAnchor="middle" dominantBaseline="middle">
              {s.label}
            </text>
          )
        })}
      </svg>
      <div className="radar-legend">
        {scores.map(s => (
          <div key={s.key} className="radar-legend-item">
            <span className="radar-legend-label">{s.label}</span>
            <span className="radar-legend-score" style={{ color: scoreColor(s.score) }}>{s.score}</span>
            <span className="radar-legend-count">{s.count} 次贡献</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ===== 模块2：贡献质量评估 ===== */
function QualityAssessment({ quality }) {
  const cards = [
    {
      label: 'PR 被合并率',
      value: `${quality.mergeRate}%`,
      score: quality.mergeRate,
      desc: quality.prs > 0 ? `${quality.mergedPRs}/${quality.prs} 已合并` : '暂无 PR 记录',
    },
    {
      label: '代码贡献量',
      value: `${quality.totalLines} 行`,
      score: quality.codeScore,
      desc: quality.totalLines > 0 ? `+${quality.additions} -${quality.deletions}` : '暂无代码贡献',
    },
    {
      label: '活跃持续性',
      value: `${quality.continuity}%`,
      score: quality.continuity,
      desc: `连续 ${quality.maxConsec} 月 / 共 ${quality.activeMonths} 月`,
    },
    {
      label: '社区影响力',
      value: `${quality.influence}`,
      score: quality.influence,
      desc: `${quality.repos} 仓库 + ${quality.issues} Issue`,
    },
  ]

  return (
    <div className="quality-grid">
      {cards.map(c => (
        <div key={c.label} className="quality-card">
          <div className="quality-card-header">
            <span className="quality-card-label">{c.label}</span>
            <span className="quality-card-value" style={{ color: scoreColor(c.score) }}>{c.value}</span>
          </div>
          <div className="quality-bar">
            <div className="quality-bar-fill" style={{ width: `${c.score}%`, background: scoreColor(c.score) }} />
          </div>
          <div className="quality-card-desc">{c.desc}</div>
        </div>
      ))}

      {/* 贡献类型分布 */}
      <div className="quality-card quality-card-wide">
        <div className="quality-card-header">
          <span className="quality-card-label">贡献类型分布</span>
        </div>
        <div className="quality-distribution">
          {quality.distribution.map(d => (
            <div key={d.label} className="dist-row">
              <span className="dist-label">{d.label}</span>
              <div className="dist-bar-track">
                <div className="dist-bar-fill" style={{ width: `${d.percent}%`, background: d.color }} />
              </div>
              <span className="dist-value">{d.value} · {d.percent}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ===== 模块3：个性化 Issue 推荐 ===== */
function PersonalizedIssues({ issues, loading, hasProfile }) {
  if (loading) {
    return <div className="search-status">正在根据你的技术画像匹配 Issue...</div>
  }
  if (issues.length === 0) {
    return (
      <div className="search-status">
        {hasProfile ? '暂未匹配到合适的 Issue，请稍后再试' : '配置 GitHub Token 并完成贡献后，获取个性化 Issue 推荐'}
      </div>
    )
  }
  return (
    <div className="scroll-panel">
      <div className="personalized-issues">
        {issues.map(issue => {
          const isEasy = issue.labels?.some(l => l.name === 'good first issue')
          return (
            <a key={issue.id} className="issue-recommend-card" href={issue.url}
              onClick={e => { e.preventDefault(); window.open(issue.url, '_blank') }}>
              <div className="issue-recommend-title">{issue.title}</div>
              <div className="issue-recommend-meta">
                <span className="issue-recommend-repo">{issue.repo}</span>
                {issue.stars != null && <span className="issue-recommend-stars">⭐ {issue.stars.toLocaleString()}</span>}
                <span className={`issue-difficulty${isEasy ? ' easy' : ''}`}>
                  {isEasy ? 'good first issue' : 'help wanted'}
                </span>
              </div>
              <div className="recommend-reason">💡 {issue.reason}</div>
            </a>
          )
        })}
      </div>
    </div>
  )
}

function scoreColor(s) {
  if (s >= 70) return 'var(--green)'
  if (s >= 40) return 'var(--amber)'
  return 'var(--rose)'
}
