# HookCryptoJs
# 项目说明
一款 Tampermonkey 油猴脚本，用来“把网络请求和前端加密行为关联在一起”。
同时 Hook CryptoJS（AES/DES/3DES）与 JSEncrypt（RSA），在页面运行时精准捕获：
- 对称加密：密文/密钥/IV/模式/填充/密钥长度/算法
- RSA：密文、公钥/私钥（PEM）、密钥长度（位）
并把这些信息附着在真实的 XHR/Fetch 请求卡片中展示。

## 功能特性
- 请求级关联
  - 基于“密文内容索引”的强关联（10 秒 TTL，兼容多种 URL/base64 变体）
  - RSA 额外提供 1.2 秒短时窗口的弱关联兜底，尽量不漏报
  - 单个请求内的多处加密字段全部展示
- CryptoJS（对称）
  - 通过运行时实例内部状态，稳定识别 CBC/CFB/CTR/OFB/ECB
  - 填充识别：Pkcs7/Zero/NoPadding/Iso10126（启发式）
  - 密钥长度：64/128/192/256 bits
- JSEncrypt（RSA）
  - Hook encrypt/decrypt，记录 PEM；
  - 密钥位数：优先 `n.bitLength()`，失败则按 PEM 长度估算常见位数
- 交互体验
  - 深色面板、每个请求下呈现多个“加密块”，请求体支持折叠
  - 控制台打印 2 秒去重；暴露 `window.__capturedRequests` 便于调试

## 安装
1. 浏览器安装 Tampermonkey 扩展。
2. 新建脚本，把本仓库的 `hook-final.user.js` 全量粘贴进去。
3. 确保 `@run-at` 为 `document-start`，保存启用。

## 使用
- 打开目标站点，进行登录/提交等操作。
- 浮动面板会记录最近请求；展开某条请求即可看到附着的“对称加密 / RSA 加密”信息：
  - 对称：密文、Key(hex)、IV(hex)、Mode、Padding、KeySize、算法
  - RSA：密文、PEM Key、KeySize(bits)、算法

## 可调参数
- 密文索引 TTL：`CIPHER_TTL`（默认 10000ms）
- 控制台去重窗口：`PRINT_TTL`（默认 2000ms）
- 面板样式可在 `GM_addStyle` 段落自行调整（宽高/字号/配色）

## 实现原理（简要）
- 对称：重写 `Function.prototype.apply`，在 CryptoJS 运行期抓取 Encryptor/Decryptor 的 `this`，基于 `_counter/_keystream/_prevBlock/_iv/_cipher` 推断模式。
- RSA：包裹 `Function.prototype.call`，拦截 JSEncrypt 的 `encrypt/decrypt`，记录 PEM 与密文，并计算位数。
- 在 XHR/Fetch 发送前，将 URL 与 body 字符串化，与密文索引做匹配，从而把“加密行为”精准附着到“真实请求”。

## 兼容与扩展
- 你可以把“面板 + 索引 + 关联”的通用部分复用到其他库：
  - 替换为目标库的公开 API 包装（或 WebCrypto `SubtleCrypto.encrypt/decrypt`）。
  - 拿到密文后加入索引，即可自动与请求建立关系。

## 注意事项
- 仅用于授权的测试/调试场景；请勿在未获许可的网站上使用。
- 对二进制请求体暂未做特征索引，可能会漏匹配。

## 许可证
MIT

## 感谢
https://github.com/0xsdeo/Hook_JS
