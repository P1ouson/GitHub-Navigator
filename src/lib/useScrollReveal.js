import { useEffect } from 'react'

/**
 * 滚动入场动画 hook
 * 页面加载后，自动为所有带 [data-reveal] 属性的元素添加入场动画
 * 依赖 tokens.css 中的 [data-reveal] 样式
 */
export function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('[data-reveal]')
    if (!els.length) return
    if (typeof IntersectionObserver === 'undefined') {
      els.forEach(el => el.classList.add('in'))
      return
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in')
          io.unobserve(e.target)
        }
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [])
}