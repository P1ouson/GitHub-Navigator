/**
 * 仓库健康度检测
 * 六维度评分：活跃度、贡献者、新手友好、维护质量、文档、生态
 */

/**
 * 活跃度评级 — 综合四个时间维度取最新的
 *
 * 不再只看默认分支 commit 时间（会误判 Hello-World 这种社区仍活跃的老仓库）：
 * - daysSinceLastCommit：默认分支最新 commit
 * - daysSincePush：任何分支 push（含删除/创建分支）
 * - daysSinceUpdated：仓库元数据/Issue/PR 等任意变更
 * - daysSinceCommunity：最近 Issue/PR 的 updated_at（评论、关闭等）
 *
 * 取四者中最新的（天数最小）作为活跃度判断依据。
 *
 * @param {object} data - getAnalysisData 返回的结构
 * @returns {{ level: string, status: 'good'|'warn'|'bad', days: number|null, basis: string }}
 *   level: '活跃'|'维护中'|'低活跃'|'疑似废弃'|'未知'
 *   basis: 判断依据（说明用了哪个时间）
 */
export function assessLiveness(data) {
  const candidates = [
    { key: 'daysSinceCommunity', days: data.daysSinceCommunity, label: '社区活动' },
    { key: 'daysSinceUpdated', days: data.daysSinceUpdated, label: '仓库更新' },
    { key: 'daysSincePush', days: data.daysSincePush, label: 'Push' },
    { key: 'daysSinceLastCommit', days: data.daysSinceLastCommit, label: 'Commit' },
  ].filter(c => c.days !== null && c.days !== undefined)

  if (candidates.length === 0) return { level: '未知', status: 'warn', days: null, basis: '无时间数据' }

  // 取最新的（天数最小）
  const latest = candidates.reduce((min, c) => (c.days < min.days ? c : min))
  const days = latest.days

  if (days > 365) return { level: '疑似废弃', status: 'bad', days, basis: latest.label }
  if (days > 180) return { level: '低活跃', status: 'warn', days, basis: latest.label }
  if (days > 30) return { level: '维护中', status: 'warn', days, basis: latest.label }
  return { level: '活跃', status: 'good', days, basis: latest.label }
}

/**
 * 六维度健康度评分
 * - 活跃度 /20（最后提交 + push 时间 + 30天提交数）
 * - 贡献者 /15（贡献者数 + release）
 * - 新手友好 /20（GFI + help wanted + CONTRIBUTING.md）
 * - 维护质量 /20（PR 处理时间 + PR merge rate + open PR 比例）
 * - 文档 /15（README + CONTRIBUTING + 社区文件）
 * - 生态 /10（Topics + star 规模 + fork）
 */
export function calcAnalysisScores(data) {
  if (data.info?.archived) return { total: 0, activity: 0, contributors: 0, beginner: 0, maintenance: 0, docs: 0, ecosystem: 0 }

  // 活跃度 /20 — 综合四维度时间 + 30天提交数
  // 取 commit/push/updated/community 中最新的天数
  const timeCandidates = [
    data.daysSinceCommunity,
    data.daysSinceUpdated,
    data.daysSincePush,
    data.daysSinceLastCommit,
  ].filter(d => d !== null && d !== undefined)
  const days = timeCandidates.length ? Math.min(...timeCandidates) : null

  let activity = 0
  if (days === null) activity = 8
  else if (days <= 7) activity = 16
  else if (days <= 30) activity = 14
  else if (days <= 90) activity = 10
  else if (days <= 180) activity = 5
  else activity = 2
  // 30天提交数加分（计数型，0 是合理值）
  const commits30d = data.commits30d ?? 0
  if (commits30d >= 30) activity = Math.min(20, activity + 4)
  else if (commits30d >= 10) activity = Math.min(20, activity + 3)
  else if (commits30d >= 1) activity = Math.min(20, activity + 1)

  // 贡献者 /15（计数型，0 是合理值）
  let contributors = 0
  const cCount = data.contributorCount ?? 0
  if (cCount >= 50) contributors = 12
  else if (cCount >= 20) contributors = 10
  else if (cCount >= 10) contributors = 8
  else if (cCount >= 5) contributors = 6
  else if (cCount >= 1) contributors = 3
  if (data.hasReleases) contributors = Math.min(15, contributors + 3)

  // 新手友好 /20
  let beginner = 0
  if (data.gfiCount >= 5) beginner = 10
  else if (data.gfiCount >= 1) beginner = 6
  if (data.helpWantedCount >= 3) beginner += 6
  else if (data.helpWantedCount >= 1) beginner += 4
  if (data.hasContributing) beginner += 4

  // 维护质量 /20
  let maintenance = 0
  if (data.prDays !== null) {
    if (data.prDays <= 3) maintenance = 12
    else if (data.prDays <= 7) maintenance = 9
    else if (data.prDays <= 30) maintenance = 6
    else if (data.prDays <= 90) maintenance = 3
    else maintenance = 1
  } else {
    maintenance = 4
  }
  // PR merge rate 加分
  if (data.prMergeRate !== null) {
    if (data.prMergeRate >= 70) maintenance = Math.min(20, maintenance + 4)
    else if (data.prMergeRate >= 40) maintenance = Math.min(20, maintenance + 2)
  }
  // open PR 比例低加分（openIssues 为 null 时跳过该加分块）
  const openIssues = data.info?.trueOpenIssues ?? data.info?.openIssues ?? null
  if (openIssues != null && openIssues > 0 && data.openPRCount !== null) {
    const ratio = data.openPRCount / openIssues
    if (ratio < 0.3) maintenance = Math.min(20, maintenance + 4)
    else if (ratio < 0.6) maintenance = Math.min(20, maintenance + 2)
  } else {
    maintenance = Math.min(20, maintenance + 2)
  }

  // 文档 /15
  let docs = 0
  if (data.hasReadme) docs += 6
  if (data.hasContributing) docs += 4
  if (data.community) {
    if (data.community.hasCodeOfConduct) docs += 2
    if (data.community.hasIssueTemplate) docs += 2
    if (data.community.hasPullRequestTemplate) docs += 1
  }
  docs = Math.min(15, docs)

  // 生态 /10
  let ecosystem = 0
  const topicCount = data.info?.topics?.length || 0
  if (topicCount >= 10) ecosystem = 5
  else if (topicCount >= 5) ecosystem = 4
  else if (topicCount >= 1) ecosystem = 2
  // stars 为 null 时跳过加分（未知数据不伪装为 0）
  const stars = data.info?.stars ?? null
  if (stars != null) {
    if (stars >= 10000) ecosystem += 4
    else if (stars >= 1000) ecosystem += 3
    else if (stars >= 100) ecosystem += 1
  }
  // forks 为 null 时跳过加分
  const forks = data.info?.forks ?? null
  if (forks != null && forks >= 1000) ecosystem = Math.min(10, ecosystem + 1)

  return {
    total: activity + contributors + beginner + maintenance + docs + ecosystem,
    activity, contributors, beginner, maintenance, docs, ecosystem,
  }
}
