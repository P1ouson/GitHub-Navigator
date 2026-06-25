/**
 * 错误归一化公共模块
 *
 * 把原始 Error / fetch 失败 / API 错误转成可展示的友好文案。
 * 页面层应只消费本模块输出的文案，不自己拼各种错误正则。
 *
 * 收口原因：SearchPage 内部维护了一份 friendlyError，逻辑通用但耦合在页面里。
 *   本模块抽出同样的规则，供后续 Step 3 拆 SearchPage 时替换调用方。
 *   本轮不强制替换 SearchPage 内部实现（避免扩散到页面层）。
 *
 * 覆盖的错误类型：
 *   - 网络连接失败（Failed to fetch / NetworkError / ECONNREFUSED 等）
 *   - 请求超时
 *   - 代理网关错误（502/503/504）
 *   - 鉴权失败（401）
 *   - 限流（403 / rate limit）
 *   - 其他：原样返回 err.message
 */

/**
 * 把原始错误转成可展示的友好文案
 * @param {Error|{message?:string}|string} err
 * @returns {string}
 */
export function friendlyError(err) {
  const msg = err?.message || String(err)
  if (/Failed to fetch|NetworkError|Network request failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ERR_CONN/i.test(msg)) {
    return '网络连接失败，请检查代理是否开启或切换为直连模式'
  }
  if (/timeout|timed? ?out/i.test(msg)) {
    return '请求超时，GitHub 响应较慢或代理不稳定，请稍后重试'
  }
  if (/502|503|504|Bad Gateway/i.test(msg)) {
    return '代理连接失败，请在搜索配置中关闭代理或更换代理端口后重试'
  }
  if (/401|Unauthorized/i.test(msg)) {
    return 'GitHub Token 未配置或已失效。搜索接口需要认证，请在右上角设置中配置 GitHub Personal Access Token。'
  }
  if (/403|rate limit/i.test(msg)) {
    return 'GitHub API 限流，请在设置中配置 Token 以提升限额，或稍后重试'
  }
  return msg
}
