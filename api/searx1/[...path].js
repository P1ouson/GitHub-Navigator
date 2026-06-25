/** SearXNG 实例 1 代理：/api/searx1/* → https://searx.be/* */
import { createSearxngProxy } from '../_lib/searxng-proxy.js'

export const config = { runtime: 'edge' }

export default createSearxngProxy('https://searx.be')
