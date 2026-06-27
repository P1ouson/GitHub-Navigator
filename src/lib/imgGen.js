/**
 * 图像生成模块 — 智谱 AI CogView-3-Flash
 *
 * 使用与 LLM 共用的智谱 API Key，OpenAI 兼容格式
 * 免费模型：cogview-3-flash（永久免费）
 */

import { getSetting } from './db.js'

const ZHIPU_BASE = 'https://open.bigmodel.cn/api/paas/v4'

/**
 * 生成图片
 * @param {string} prompt - 图片描述（中文）
 * @param {string} size - 图片尺寸，默认 '1024x1024'
 * @returns {Promise<{url: string} | null>}
 */
export async function generateImage(prompt, size = '1024x1024') {
  const apiKey = await getSetting('zhipu_api_key')
  if (!apiKey) return null

  try {
    const resp = await fetch(`${ZHIPU_BASE}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'cogview-3-flash',
        prompt,
        size,
      }),
    })

    if (!resp.ok) {
      const err = await resp.text().catch(() => '')
      console.warn('[图像生成] API 错误:', resp.status, err.slice(0, 200))
      return null
    }

    const data = await resp.json()
    return { url: data.data?.[0]?.url || null }
  } catch (err) {
    console.warn('[图像生成] 失败:', err.message)
    return null
  }
}

/**
 * 为开源项目生成封面图
 * @param {object} repo - 仓库信息 { name, desc, language, topics }
 * @returns {Promise<string|null>} 图片 URL
 */
export async function generateProjectCover(repo) {
  const name = repo.name || ''
  const desc = (repo.desc || '').slice(0, 100)
  const lang = repo.language || ''
  const topics = (repo.topics || []).slice(0, 3).join('、')

  const prompt = `一个现代简约风格的开源项目封面插图，项目名称"${name}"，${desc ? `描述：${desc}` : ''}${lang ? `，编程语言：${lang}` : ''}${topics ? `，技术标签：${topics}` : ''}。简洁的几何图形和科技感配色，适合作为项目卡片封面，无文字。`

  const result = await generateImage(prompt, '1024x1024')
  return result?.url || null
}

/**
 * 为项目分析生成概念图
 * @param {object} info - 仓库基本信息 { name, desc, language }
 * @returns {Promise<string|null>} 图片 URL
 */
export async function generateProjectConcept(info) {
  const name = info.name || ''
  const desc = (info.desc || '').slice(0, 120)

  const prompt = `一个科技感的概念插图，展示开源项目"${name}"的核心功能。${desc ? `项目描述：${desc}` : ''}。风格：现代简约、扁平化设计、深色背景配亮色元素，适合作为技术分析页面的配图，无文字。`

  const result = await generateImage(prompt, '1024x1024')
  return result?.url || null
}