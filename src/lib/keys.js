// 密钥解码工具 — 对硬编码的 API 密钥进行简单的 base64 编码存放
// 防止密钥明文直接出现在源代码中
const _fromBase64 = (s) => {
  try { return atob(s) } catch { return '' }
}

// SiliconFlow 默认 API Key（base64 编码）
export const DEFAULT_SILICONFLOW_KEY = _fromBase64('c2staHV6ZXNkcXNmYWNyd2VobW5vYWFlemF0a2N6cXJjdmRja3d3cXVqamdxZXRoeXd4')