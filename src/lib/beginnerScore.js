/**
 * 新手友好度评分（搜索结果页用，避免与仓库分析页深度分析重合）
 *
 * 数据来源：仅用搜索结果已加载的字段，不额外请求 API
 *   - Issue: labels, comments, createdAt, _repoHealth (stars/pushedAt/archived/language)
 *   - Repo: stars, forks, openIssues, updatedAt, language, topics
 *
 * 评分维度：
 *   - Issue: 新手 label / 评论数（没人抢）/ 创建时间 / 仓库 star 量级 / 文档类
 *   - Repo: star 量级适中 / 活跃度 / open issues 适中 / 有 topics
 *
 * 输出：{ score (0-100), level (1-5), reasons (string[]) }
 */

import { BEGINNER_LABEL_KEYWORDS, DOC_LABEL_KEYWORDS } from './issueLabels.js'

// ===== Issue 评分 =====

/**
 * Issue 新手友好度评分
 * @param {object} issue - 来自 GitHub 搜索 API 的 issue 对象
 * @returns {{ score: number, level: number, reasons: string[] }}
 */
export function scoreIssue(issue) {
  let score = 0
  const reasons = []
  const labels = (issue.labels || []).map(l => (l.name || '').toLowerCase())

  // 1. 新手 label（+30）
  const hasBeginnerLabel = labels.some(l => BEGINNER_LABEL_KEYWORDS.some(b => l.includes(b)))
  if (hasBeginnerLabel) {
    score += 30
    reasons.push('有新手友好标签')
  }

  // 2. 评论数（没人抢 +25，少量评论 +15）
  const comments = issue.comments || 0
  if (comments === 0) {
    score += 25
    reasons.push('0 评论（无人竞争）')
  } else if (comments < 5) {
    score += 15
    reasons.push(`${comments} 条评论（竞争小）`)
  }

  // 3. 创建时间（30 天内 +15，90 天内 +8）
  const created = new Date(issue.createdAt)
  const daysAgo = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24)
  if (daysAgo < 30) {
    score += 15
    reasons.push('近期创建')
  } else if (daysAgo < 90) {
    score += 8
  }

  // 4. 仓库 star 量级（1K-50K 最佳 +20，50K+ +10，<1K +5）
  const health = issue._repoHealth
  const stars = health?.stars ?? null
  if (stars != null && stars >= 1000 && stars <= 50000) {
    score += 20
    reasons.push(`仓库 ${formatStars(stars)}（规模适中）`)
  } else if (stars != null && stars > 50000) {
    score += 10
    reasons.push(`仓库 ${formatStars(stars)}（大型项目）`)
  } else if (stars != null && stars > 0) {
    score += 5
  }

  // 5. 文档类 label（+10）
  const isDoc = labels.some(l => DOC_LABEL_KEYWORDS.some(k => l.includes(k)))
  if (isDoc) {
    score += 10
    reasons.push('文档类（改动简单）')
  }

  // 6. 仓库活跃度（health.liveness）
  const liveness = health?.liveness?.level
  if (liveness === 'active') {
    score += 10
    reasons.push('仓库活跃')
  } else if (liveness === 'maintained') {
    score += 5
  }

  return {
    score: Math.min(100, score),
    level: scoreToLevel(score),
    reasons,
  }
}

// ===== Repo 评分 =====

/**
 * Repo 新手友好度评分
 * @param {object} repo - 来自 GitHub 搜索 API 的 repo 对象
 * @returns {{ score: number, level: number, reasons: string[] }}
 */
export function scoreRepo(repo) {
  let score = 0
  const reasons = []
  const stars = repo.stars ?? null
  const openIssues = repo.openIssues ?? null

  // 1. Star 量级适中（1K-50K 最佳 +30，50K+ +15，100-1K +20，<100 +5）
  if (stars != null && stars >= 1000 && stars <= 50000) {
    score += 30
    reasons.push(`${formatStars(stars)} star（规模适中）`)
  } else if (stars != null && stars >= 100 && stars < 1000) {
    score += 20
    reasons.push(`${formatStars(stars)} star（小项目易参与）`)
  } else if (stars != null && stars > 50000) {
    score += 15
    reasons.push(`${formatStars(stars)} star（大型项目）`)
  } else if (stars != null && stars > 0) {
    score += 5
  }

  // 2. 活跃度（最近 push 时间）
  const updated = repo.updatedAt ? new Date(repo.updatedAt) : null
  if (updated) {
    const daysAgo = (Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24)
    if (daysAgo < 30) {
      score += 25
      reasons.push('近 30 天有更新')
    } else if (daysAgo < 90) {
      score += 15
      reasons.push('近 90 天有更新')
    } else if (daysAgo < 365) {
      score += 5
    }
  }

  // 3. Open issues 适中（<100 +20，100-500 +10，>500 +0）
  if (openIssues != null && openIssues > 0 && openIssues < 100) {
    score += 20
    reasons.push(`${openIssues} 个 open issue（可参与）`)
  } else if (openIssues != null && openIssues >= 100 && openIssues < 500) {
    score += 10
  }

  // 4. 有 topics（+15，说明维护认真）
  const topics = repo.topics || []
  if (topics.length > 0) {
    score += 15
    reasons.push(`有 ${topics.length} 个主题标签`)
  }

  // 5. Fork 数（>100 +10，说明有人参与）
  const forks = repo.forks ?? null
  if (forks != null && forks > 100) {
    score += 10
    reasons.push(`${forks} fork（有人参与）`)
  }

  return {
    score: Math.min(100, score),
    level: scoreToLevel(score),
    reasons,
  }
}

// ===== Issue 难度等级（用于筛选栏）=====

/**
 * Issue 难度等级（用于左侧筛选栏）
 * @returns {'easy'|'medium'|'hard'|'unknown'}
 */
export function issueDifficulty(issue) {
  const labels = (issue.labels || []).map(l => (l.name || '').toLowerCase())
  const comments = issue.comments || 0
  const stars = issue._repoHealth?.stars ?? null
  const hasBeginnerLabel = labels.some(l => BEGINNER_LABEL_KEYWORDS.some(b => l.includes(b)))
  const isDoc = labels.some(l => DOC_LABEL_KEYWORDS.some(k => l.includes(k)))
  const isBug = labels.some(l => l.includes('bug'))

  // 简单：有新手 label + 评论少 + (文档类或仓库适中)
  if (hasBeginnerLabel && comments < 5 && (isDoc || (stars != null && stars >= 100 && stars <= 50000))) {
    return 'easy'
  }
  // 困难：bug 类 + 评论多 + 大仓库
  if (isBug && comments > 10 && stars != null && stars > 50000) {
    return 'hard'
  }
  // 中等：其它有 label 的
  if (labels.length > 0) {
    return 'medium'
  }
  // 无 label 无法判断
  return 'unknown'
}

// ===== 辅助函数 =====

function scoreToLevel(score) {
  if (score >= 80) return 5
  if (score >= 60) return 4
  if (score >= 40) return 3
  if (score >= 20) return 2
  return 1
}

function formatStars(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

/** 评分等级 → 星级字符串 */
export function levelToStars(level) {
  return '★'.repeat(level) + '☆'.repeat(5 - level)
}

/** 评分等级 → CSS class */
export function levelToClass(level) {
  if (level >= 4) return 'score-high'
  if (level >= 3) return 'score-mid'
  if (level >= 2) return 'score-low'
  return 'score-very-low'
}
