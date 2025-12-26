const jwt = require('jsonwebtoken');

// 你的OnlyOffice JWT密钥（和Docker配置中的一致）
const ONLYOFFICE_JWT_SECRET = 'my_secret_key_for_onlyoffice';

/**
 * 生成OnlyOffice的JWT令牌
 * @param {object} payload 载荷（可包含用户、文档信息等，非必需）
 * @returns {string} JWT令牌
 */
function generateOnlyOfficeToken(payload = {}) {
  // 可以设置过期时间，比如1小时（避免令牌长期有效）
  return jwt.sign(payload, ONLYOFFICE_JWT_SECRET, { expiresIn: '1h' });
}

/**
 * 验证OnlyOffice的JWT令牌
 * @param {string} token JWT令牌
 * @returns {object} 解码后的载荷（验证失败则抛出错误）
 */
function verifyOnlyOfficeToken(token) {
  try {
    return jwt.verify(token, ONLYOFFICE_JWT_SECRET);
  } catch (error) {
    throw new Error('JWT验证失败：' + error.message);
  }
}

module.exports = {
  generateOnlyOfficeToken,
  verifyOnlyOfficeToken
};