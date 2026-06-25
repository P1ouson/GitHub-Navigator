/** SearXNG 实例 3 代理：/api/searx3/* → https://search.ononoki.org/* */
import { createSearxngProxy } from '../_lib/searxng-proxy.js'

export const config = { runtime: 'edge' }

export default createSearxngProxy('https://search.ononoki.org')
