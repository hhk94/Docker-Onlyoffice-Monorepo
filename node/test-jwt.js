// JWT令牌格式测试脚本
const jwt = require('jsonwebtoken');

// 使用与配置文件相同的密钥
const JWT_SECRET = 'my_secret_key_for_onlyoffice';

// 测试生成符合OnlyOffice要求的JWT令牌
function testJwtFormat() {
  try {
    // 创建符合OnlyOffice要求的payload结构
    const onlyOfficePayload = {
      document: {
        key: 'key-1234567890'
      },
      user: {
        id: 'user-1',
        name: '用户'
      },
      action: 'download',
      expires: Math.floor(Date.now() / 1000) + 3600, // 1小时后过期
      iat: Math.floor(Date.now() / 1000) // 发布时间
    };
    
    // 生成JWT令牌
    const token = jwt.sign(onlyOfficePayload, JWT_SECRET, {
      algorithm: 'HS256'
    });
    
    console.log('生成的JWT令牌:');
    console.log(token);
    console.log('\n令牌格式验证:');
    
    // 验证令牌格式 (JWT格式: header.payload.signature)
    const parts = token.split('.');
    console.log(`- 令牌包含 ${parts.length} 个部分 (应为 3 个)`);
    console.log(`- 第一部分 (header): ${parts[0].length} 个字符`);
    console.log(`- 第二部分 (payload): ${parts[1].length} 个字符`);
    console.log(`- 第三部分 (signature): ${parts[2].length} 个字符`);
    
    // 解码并打印header和payload以验证内容
    try {
      const decodedHeader = JSON.parse(Buffer.from(parts[0], 'base64').toString());
      console.log('\n解码后的Header:');
      console.log(JSON.stringify(decodedHeader, null, 2));
    } catch (e) {
      console.error('解码Header失败:', e.message);
    }
    
    try {
      const decodedPayload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      console.log('\n解码后的Payload:');
      console.log(JSON.stringify(decodedPayload, null, 2));
    } catch (e) {
      console.error('解码Payload失败:', e.message);
    }
    
    // 验证令牌签名
    try {
      const verified = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      console.log('\n令牌验证结果: 成功');
    } catch (e) {
      console.error('\n令牌验证失败:', e.message);
    }
    
    console.log('\nOnlyOffice JWT令牌格式测试完成!');
    return token;
  } catch (error) {
    console.error('测试过程中出错:', error);
    return null;
  }
}

// 运行测试
if (require.main === module) {
  console.log('开始测试OnlyOffice JWT令牌格式...\n');
  testJwtFormat();
}

module.exports = { testJwtFormat };