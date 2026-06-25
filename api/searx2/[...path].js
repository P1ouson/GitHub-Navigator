/** SearXNG 实例 2 代理：/api/searx2/* → https://search.sapti.me/* */
import { createSearxngProxy } from '../_lib/searxng-proxy.js'

export const config = { runtime: 'edge' }

export default createSearxngProxy('https://search.sapti.me')
