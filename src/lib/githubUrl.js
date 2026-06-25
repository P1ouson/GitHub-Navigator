/**
 * GitHub URL / 坐标解析公共模块
 *
 * 收口项目里多处重复的 GitHub 仓库 URL 解析逻辑：
 *   - owner/repo 坐标提取
 *   - github.com/owner/repo URL 解析
 *   - /pulls /issues 后缀归并
 *   - 组织 / 仓库 / 用户输入识别
 *
 * 收口原因：github.js 原有 parseRepoUrl / parseGitHubUrl / parseGithubRepoCoordinates
 *   三个函数语义高度重叠（都在做 owner/repo 提取），只是返回结构略有不同。
 *   本模块提供统一入口，原 github.js 的三个函数改为转发到此处，保持外部兼容。
 *
 * 返回结构约定：
 *   - parseRepoCoordinates: { owner, repo, canonicalUrl, truncated } | null
 *       适合需要完整坐标 + 后缀信息的场景（AnalysisPage / SocialPage）
 *   - parseGitHubInput: { type: 'repo'|'org', owner, repo? } | null
 *       适合搜索框输入识别（SearchPage）
 *   - extractOwnerRepo: { owner, repo } | null
 *       适合只要坐标的轻量场景（ContributionPage）
 */

/**
 * 解析 owner/repo 或完整 GitHub URL，支持 /pulls /issues 后缀自动归并
 * @param {string} url
 * @returns {{owner:string, repo:string, canonicalUrl:string, truncated:boolean} | null}
 */
export function parseRepoCoordinates(url) {
  const trimmed = (url || '').trim()
  if (!trimmed) return null
  // owner/repo 格式
  const slashMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/)
  if (slashMatch) {
    return {
      owner: slashMatch[1],
      repo: slashMatch[2],
      canonicalUrl: trimmed,
      truncated: false,
    }
  }
  // github.com/owner/repo 格式，去掉 /pulls /issues 等后缀
  const urlMatch = trimmed.match(/github\.com\/([\w.-]+)\/([\w.-]+)/)
  if (urlMatch) {
    const canonical = `${urlMatch[1]}/${urlMatch[2]}`
    const hasSuffix = trimmed.includes('/pulls') || trimmed.includes('/issues')
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      canonicalUrl: canonical,
      truncated: hasSuffix,
    }
  }
  return null
}

/**
 * 解析 GitHub 输入（仓库 / 组织 / 用户）
 * 用于搜索框输入识别：owner/repo 或 github.com/owner/repo 视为仓库，
 * org:xxx 或 @xxx 视为组织。
 * @param {string} input
 * @returns {{type:'repo', owner:string, repo:string} | {type:'org', owner:string} | null}
 */
export function parseGitHubInput(input) {
  const trimmed = (input || '').trim()
  if (!trimmed) return null
  // owner/repo
  const repoMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/)
  if (repoMatch) return { type: 'repo', owner: repoMatch[1], repo: repoMatch[2] }
  // github.com/owner/repo
  const urlRepoMatch = trimmed.match(/github\.com\/([\w.-]+)\/([\w.-]+)/)
  if (urlRepoMatch) return { type: 'repo', owner: urlRepoMatch[1], repo: urlRepoMatch[2] }
  // 只有显式 org: 或 @ 开头才算组织
  const orgMatch = trimmed.match(/^(?:org:|@)([\w.-]+)$/)
  if (orgMatch) return { type: 'org', owner: orgMatch[1] }
  return null
}

/**
 * 从任意 GitHub URL / 坐标字符串中提取 owner/repo
 * 轻量场景用：不区分后缀、不返回 canonicalUrl，只要坐标。
 * @param {string} url
 * @returns {{owner:string, repo:string} | null}
 */
export function extractOwnerRepo(url) {
  const m = String(url || '').match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+)/)
  return m ? { owner: m[1], repo: m[2].replace(/\/$/, '') } : null
}
