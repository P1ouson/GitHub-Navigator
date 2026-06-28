import { createElement as h } from 'react'

/** 渲染行内格式（加粗/代码/链接/图片/删除线） */
export function renderInline(text) {
  if (!text) return text
  const parts = []
  let remaining = text
  let key = 0
  while (remaining) {
    // 图片 ![alt](url)
    const imgMatch = remaining.match(/!\[([^\]]*)\]\(([^)\s]+)\)/)
    if (imgMatch) {
      const idx = remaining.indexOf(imgMatch[0])
      if (idx > 0) parts.push(remaining.slice(0, idx))
      parts.push(
        h('img', {
          key: key++,
          src: imgMatch[2],
          alt: imgMatch[1] || '',
          style: { maxWidth: '100%' },
          loading: 'lazy',
        })
      )
      remaining = remaining.slice(idx + imgMatch[0].length)
      continue
    }
    // 加粗 **text**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
    if (boldMatch) {
      const idx = remaining.indexOf(boldMatch[0])
      if (idx > 0) parts.push(remaining.slice(0, idx))
      parts.push(h('strong', { key: key++ }, boldMatch[1]))
      remaining = remaining.slice(idx + boldMatch[0].length)
      continue
    }
    // 链接 [text](url)
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)\s]+)\)/)
    if (linkMatch) {
      const idx = remaining.indexOf(linkMatch[0])
      if (idx > 0) parts.push(remaining.slice(0, idx))
      parts.push(
        h('a', { key: key++, href: linkMatch[2], target: '_blank', rel: 'noopener noreferrer', className: 'md-link' },
          linkMatch[1]
        )
      )
      remaining = remaining.slice(idx + linkMatch[0].length)
      continue
    }
    // 行内代码 `code`
    const codeMatch = remaining.match(/`(.+?)`/)
    if (codeMatch) {
      const idx = remaining.indexOf(codeMatch[0])
      if (idx > 0) parts.push(remaining.slice(0, idx))
      parts.push(h('code', { key: key++, className: 'md-inline-code' }, codeMatch[1]))
      remaining = remaining.slice(idx + codeMatch[0].length)
      continue
    }
    // 斜体 *text*
    const emMatch = remaining.match(/\*(.+?)\*/)
    if (emMatch) {
      const idx = remaining.indexOf(emMatch[0])
      if (idx > 0) parts.push(remaining.slice(0, idx))
      parts.push(h('em', { key: key++ }, emMatch[1]))
      remaining = remaining.slice(idx + emMatch[0].length)
      continue
    }
    // 删除线 ~~text~~
    const delMatch = remaining.match(/~~(.+?)~~/)
    if (delMatch) {
      const idx = remaining.indexOf(delMatch[0])
      if (idx > 0) parts.push(remaining.slice(0, idx))
      parts.push(h('del', { key: key++ }, delMatch[1]))
      remaining = remaining.slice(idx + delMatch[0].length)
      continue
    }
    parts.push(remaining)
    break
  }
  return parts
}

/** 安全渲染 HTML 片段（保留 img / a / br / code 等安全标签） */
function renderHtml(html) {
  // 简单的 HTML 标签解析，保留安全标签
  return h('span', {
    dangerouslySetInnerHTML: {
      __html: html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
        .replace(/on\w+="[^"]*"/gi, '')
        .replace(/on\w+='[^']*'/gi, ''),
    },
  })
}

/** 渲染 Markdown 文本为 React 元素 */
export function renderMarkdown(md) {
  if (!md) return null
  const lines = md.split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // 代码块
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim()
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // 跳过结束的 ```
      blocks.push(h('pre', { key: blocks.length, className: 'md-code-block' },
        h('code', { className: lang ? `language-${lang}` : undefined }, codeLines.join('\n'))
      ))
      continue
    }

    // 标题
    const hMatch = trimmed.match(/^(#{1,4})\s+(.*)/)
    if (hMatch) {
      const level = hMatch[1].length
      const text = renderInline(hMatch[2])
      blocks.push(level === 1
        ? h('h3', { key: blocks.length, className: 'md-h1' }, text)
        : level === 2
        ? h('h4', { key: blocks.length, className: 'md-h2' }, text)
        : h('h5', { key: blocks.length, className: 'md-h3' }, text))
      i++
      continue
    }

    // 水平分割线
    if (/^(---|\*\*\*|___)\s*$/.test(trimmed)) {
      blocks.push(h('hr', { key: blocks.length, className: 'md-hr' }))
      i++
      continue
    }

    // 引用块
    if (trimmed.startsWith('>')) {
      const quoteLines = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s*/, ''))
        i++
      }
      blocks.push(
        h('blockquote', { key: blocks.length, className: 'md-blockquote' },
          quoteLines.map((ql, qi) => h('p', { key: qi }, renderInline(ql)))
        )
      )
      continue
    }

    // 无序列表
    if (/^\s*[-*•]\s+/.test(trimmed)) {
      const items = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i].trim())) {
        items.push(h('li', { key: items.length }, renderInline(lines[i].trim().replace(/^\s*[-*•]\s+/, ''))))
        i++
      }
      blocks.push(h('ul', { key: blocks.length, className: 'md-ul' }, items))
      continue
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(trimmed)) {
      const items = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(h('li', { key: items.length }, renderInline(lines[i].trim().replace(/^\s*\d+[.)]\s+/, ''))))
        i++
      }
      blocks.push(h('ol', { key: blocks.length, className: 'md-ol' }, items))
      continue
    }

    // 空行
    if (!trimmed) { i++; continue }

    // Markdown 表格
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const tableRows = []
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableRows.push(lines[i].trim())
        i++
      }
      // 跳过只有分隔符的行（如 |---|---|）
      const dataRows = tableRows.filter(r => !/^\|[\s\-:|]+\|$/.test(r))
      if (dataRows.length >= 2) {
        const headerCells = dataRows[0].split('|').filter(c => c.trim())
        const bodyRows = dataRows.slice(1)
        blocks.push(
          h('table', { key: blocks.length, className: 'md-table' },
            h('thead', null,
              h('tr', null, headerCells.map((c, ci) => h('th', { key: ci }, renderInline(c.trim()))))
            ),
            h('tbody', null,
              bodyRows.map((row, ri) => {
                const cells = row.split('|').filter(c => c.trim())
                return h('tr', { key: ri }, cells.map((c, ci) => h('td', { key: ci }, renderInline(c.trim()))))
              })
            )
          )
        )
      }
      continue
    }

    // HTML 标签行（包含 <img> <a> 等）
    if (/^<[a-zA-Z]/.test(trimmed) && />$/.test(trimmed)) {
      blocks.push(renderHtml(trimmed))
      i++
      continue
    }

    // 段落：合并连续的非空行
    const paraLines = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|[-*•]\s|\d+[.)]\s|\||---|\*\*\*|___)/.test(lines[i].trim())) {
      paraLines.push(lines[i].trim())
      i++
    }
    if (paraLines.length > 0) {
      blocks.push(h('p', { key: blocks.length, className: 'md-p' }, renderInline(paraLines.join(' '))))
    } else {
      i++
    }
  }
  return blocks
}