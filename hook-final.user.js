// ==UserScript==
// @name         网络追踪 + CryptoJS 完整 Hook
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  运行时从 Encryptor 实例直接推断模式，精准关联网络请求
// @author       Final
// @match        *://*/*
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 全局数据 ====================
    const capturedRequests = [];
    window.__capturedRequests = capturedRequests; // 立即暴露

    let xhrCounter = 0;
    let recentCryptoOp = null;
    let cryptoOpTimestamp = 0;

    // 密文索引（内容关联，TTL 10s）: variant -> { info, ts }
    const cipherIndex = new Map();
    const CIPHER_TTL = 10000; // 10s

    // 控制台打印去重（2s窗口）
    const printIndex = new Map();
    const PRINT_TTL = 2000;
    function logOnce(label, info) {
        const now = Date.now();
        for (const [k, ts] of printIndex.entries()) {
            if (now - ts > PRINT_TTL) printIndex.delete(k);
        }
        const id = [info.operation, info.ciphertext, info.key, info.iv, info.mode, info.padding, info.algorithm].join('|');
        if (printIndex.has(id)) return;
        printIndex.set(id, now);
        console.log(label, info);
        console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color:green;');
    }

    function addCipherToIndex(ciphertext, info) {
        if (!ciphertext) return;
        const variants = new Set();
        variants.add(ciphertext);
        try { variants.add(encodeURIComponent(ciphertext)); } catch(_){}
        try { variants.add(encodeURI(ciphertext)); } catch(_){}
        variants.add(ciphertext.replace(/\+/g, '%2B'));
        // URL-safe base64 与去掉 padding 的变体
        variants.add(ciphertext.replace(/\+/g,'-').replace(/\//g,'_'));
        variants.add(ciphertext.replace(/=+$/,''));
        variants.add(ciphertext.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''));
        for (const v of variants) {
            cipherIndex.set(v, { info, ts: Date.now() });
        }
        purgeCipherIndex();
    }

    function purgeCipherIndex() {
        const now = Date.now();
        for (const [k, v] of cipherIndex.entries()) {
            if (now - v.ts > CIPHER_TTL) cipherIndex.delete(k);
        }
    }

    function matchCryptoInText(url, bodyStr) {
        purgeCipherIndex();
        const u = String(url || '');
        const b = String(bodyStr || '');
        const matches = [];
        const seen = new Set();
        for (const [k, v] of cipherIndex.entries()) {
            if (!k) continue;
            if (u.includes(k) || b.includes(k)) {
                const id = v.info && (v.info.ciphertext || `${v.info.key}|${v.info.iv}|${v.info.mode}|${v.info.padding}`);
                if (!seen.has(id)) {
                    matches.push(v.info);
                    seen.add(id);
                }
            }
        }
        return matches;
    }

    // ==================== 样式 ====================
    GM_addStyle(`
        #monitor {
            position: fixed; top: 10px; left: 10px; width: 700px; max-height: 80vh;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            color: #e8e8e8; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 13px; border: 1px solid #4a90e2; border-radius: 8px;
            padding: 16px; z-index: 999999; overflow-y: auto;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
        }
        #monitor h3 {
            margin: 0 0 15px 0; color: #4a90e2; font-size: 18px;
            font-weight: 600; text-align: center;
            border-bottom: 2px solid #4a90e2; padding-bottom: 8px;
        }
        .item {
            border: 1px solid #3a3a5c; background: rgba(255, 255, 255, 0.05);
            margin: 12px 0; padding: 14px; border-radius: 6px;
            transition: all 0.3s ease;
        }
        .item:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: #4a90e2;
            transform: translateY(-1px);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
        }
        .method {
            display: inline-block; padding: 4px 8px;
            background: linear-gradient(45deg, #4a90e2, #357abd);
            color: #fff; border-radius: 4px; font-weight: 500;
            margin-right: 8px; font-size: 12px; text-transform: uppercase;
        }
        .url {
            color: #a8c7fa; word-break: break-all; font-size: 12px;
            margin: 5px 0; line-height: 1.4;
        }
        .label {
            color: #ffd93d; font-weight: 500; font-size: 12px;
        }
        .value {
            color: #81c995; word-break: break-all; font-size: 12px;
            font-family: 'Courier New', monospace;
        }
        .crypto {
            background: linear-gradient(135deg, rgba(106, 90, 205, 0.1), rgba(72, 61, 139, 0.1));
            border-left: 4px solid #6a5acd; padding: 12px; margin: 10px 0;
            border-radius: 6px;
        }
        .crypto-title {
            color: #dda0dd; font-weight: 600; font-size: 14px;
            margin-bottom: 8px;
        }
        .data-block {
            max-height: 180px; overflow-y: auto; overflow-x: hidden;
            background: rgba(0, 0, 0, 0.3); padding: 8px; margin: 6px 0;
            font-size: 12px; border-radius: 4px;
            font-family: 'Courier New', monospace;
            border: 1px solid #333;
            white-space: pre-wrap; word-break: break-all; line-height: 1.5;
        }
        .btn {
            background: linear-gradient(45deg, #4a90e2, #357abd);
            color: #fff; border: none; padding: 8px 14px; cursor: pointer;
            margin: 3px; border-radius: 5px; font-size: 12px;
            transition: all 0.2s ease; font-weight: 500;
        }
        .btn:hover {
            background: linear-gradient(45deg, #357abd, #2968a3);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(74, 144, 226, 0.3);
        }
        .btn-danger {
            background: linear-gradient(45deg, #e74c3c, #c0392b);
        }
        .btn-danger:hover {
            background: linear-gradient(45deg, #c0392b, #a93226);
            box-shadow: 0 4px 12px rgba(231, 76, 60, 0.3);
        }
        .toggle {
            cursor: pointer; color: #4a90e2; text-decoration: underline;
            font-size: 12px; font-weight: 500;
        }
        .toggle:hover {
            color: #357abd;
        }
        /* 滚动条样式 */
        #monitor::-webkit-scrollbar { width: 6px; }
        #monitor::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); }
        #monitor::-webkit-scrollbar-thumb { background: #4a90e2; border-radius: 3px; }
        #monitor::-webkit-scrollbar-thumb:hover { background: #357abd; }
        .data-block::-webkit-scrollbar { width: 4px; }
        .data-block::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
        .data-block::-webkit-scrollbar-thumb { background: #666; border-radius: 2px; }
    `);

    // ==================== 界面 ====================
    function createPanel() {
        const panel = document.createElement('div');
        panel.id = 'monitor';
        panel.innerHTML = `
            <h3>🔐 最终版监控</h3>
            <div>
                <button class="btn" onclick="document.getElementById('list').innerHTML='';document.getElementById('cnt').textContent='0';">清空</button>
                <button class="btn btn-danger" onclick="console.log('请求数组:', window.__capturedRequests);">导出</button>
                <span style="color:#888; margin-left:10px;">请求: <span id="cnt">0</span></span>
            </div>
            <div id="list"></div>
        `;
        document.body.appendChild(panel);
    }


    function updatePanel(data) {
        const list = document.getElementById('list');
        const cnt = document.getElementById('cnt');
        if (!list || !cnt) return;

        cnt.textContent = capturedRequests.length;

        let cryptoHtml = '';
        if (data.cryptoInfo && Array.isArray(data.cryptoInfo) && data.cryptoInfo.length) {
            cryptoHtml = data.cryptoInfo.map((c, idx) => `
                <div class="crypto">
                    <div class="crypto-title">🔑 ${c.operation || '加密'} ${data.cryptoInfo.length>1 ? `(#${idx+1})` : ''}</div>
                    ${c.ciphertext ? `<div><span class="label">密文:</span> <span class="value">${esc(c.ciphertext)}</span></div>` : ''}
                    ${c.key ? `<div><span class="label">Key:</span> <span class="value">${esc(c.key)}</span></div>` : ''}
                    ${c.iv ? `<div><span class="label">IV:</span> <span class="value">${esc(c.iv)}</span></div>` : ''}
                    ${c.mode ? `<div><span class="label">Mode:</span> <span class="value">${c.mode}</span></div>` : ''}
                    ${c.padding ? `<div><span class="label">Padding:</span> <span class="value">${c.padding}</span></div>` : ''}
                    ${c.keySize ? `<div><span class="label">密钥长度:</span> <span class="value">${c.keySize}</span></div>` : ''}
                    ${c.algorithm ? `<div><span class="label">算法:</span> <span class="value">${c.algorithm}</span></div>` : ''}
                </div>
            `).join('');
        } else if (data.cryptoInfo && !Array.isArray(data.cryptoInfo)) {
            const c = data.cryptoInfo;
            cryptoHtml = `
                <div class="crypto">
                    <div class="crypto-title">🔑 ${c.operation || '加密'}</div>
                    ${c.ciphertext ? `<div><span class="label">密文:</span> <span class="value">${esc(c.ciphertext)}</span></div>` : ''}
                    ${c.key ? `<div><span class="label">Key:</span> <span class="value">${esc(c.key)}</span></div>` : ''}
                    ${c.iv ? `<div><span class="label">IV:</span> <span class="value">${esc(c.iv)}</span></div>` : ''}
                    ${c.mode ? `<div><span class="label">Mode:</span> <span class="value">${c.mode}</span></div>` : ''}
                    ${c.padding ? `<div><span class="label">Padding:</span> <span class="value">${c.padding}</span></div>` : ''}
                    ${c.keySize ? `<div><span class="label">密钥长度:</span> <span class="value">${c.keySize}</span></div>` : ''}
                    ${c.algorithm ? `<div><span class="label">算法:</span> <span class="value">${c.algorithm}</span></div>` : ''}
                </div>
            `;
        }

        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML = `
            <div><span class="method">${data.method}</span><span style="color:#888">${data.time}</span></div>
            <div class="url">${esc(data.url)}</div>
            ${cryptoHtml}
            <div>
                <span class="toggle" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">▶ 请求数据</span>
                <div class="data-block" style="display:none;">${esc(data.requestData)}</div>
            </div>
        `;

        list.insertBefore(item, list.firstChild);
        if (list.children.length > 10) list.removeChild(list.lastChild);
    }


    function esc(text) {
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    // ==================== CryptoJS Hook ====================

    function hasEncryptProp(obj) {
        return obj && typeof obj === 'object' && 'ciphertext' in obj && 'key' in obj && 'mode' in obj;
    }

    function hasDecryptProp(obj) {
        return obj && typeof obj === 'object' && 'sigBytes' in obj && 'words' in obj;
    }

    function getSigBytes(size) {
        const map = {8: '64bits', 16: '128bits', 24: '192bits', 32: '256bits'};
        return map[size] || size + 'bytes';
    }

    // 从 Encryptor 实例的内部状态推断模式
    function detectMode(ctx) {
        if (!ctx || typeof ctx !== 'object') return null;
        if ('_counter' in ctx) return 'CTR';
        if ('_keystream' in ctx) return 'OFB';
        if ('_prevBlock' in ctx) return 'CBC';
        if ('_iv' in ctx) return 'CFB';
        if ('_cipher' in ctx) return 'ECB';
        return null;
    }

    // 从 Encryptor 实例的 _cipher 推断算法类型
    function detectAlgorithm(ctx) {
        try {
            if (!ctx || typeof ctx !== 'object' || !('_cipher' in ctx)) return null;
            const c = ctx._cipher;
            if (c._des1 && c._des2 && c._des3) return 'TripleDES';
            if ('_subKeys' in c) return 'DES';
            if (('_keySchedule' in c) || ('_invKeySchedule' in c)) return 'AES';
            if ('blockSize' in c) {
                if (c.blockSize === 4) return 'AES'; // 128-bit block
                if (c.blockSize === 2) return 'DES/3DES'; // 64-bit block
            }
            return null;
        } catch(_) { return null; }
    }

    // 从 padding 对象推断类型
    function detectPadding(obj) {
        if (!obj) return null;
        if (!obj.pad || typeof obj.pad !== 'function') return null;
        const src = obj.pad.toString();
        if (src.length < 50) return 'NoPadding';
        if (src.includes('0x80000000')) return 'Pkcs7';
        if (src.includes('push(0)')) return 'ZeroPadding';
        if (src.includes('random')) return 'Iso10126';
        return 'Pkcs7'; // 默认
    }

    let temp_apply = Function.prototype.apply;
    let lastModeFromRuntime = null; // 运行时捕获的模式
    let lastAlgoFromRuntime = null; // 运行时捕获的算法

    Function.prototype.apply = function() {
        // 尝试从 this 或 arguments[0] 推断模式/算法
        try {
            const ctx = this && typeof this === 'object' ? this : arguments[0];
            let m = detectMode(ctx);
            if (m) {
                lastModeFromRuntime = m;
                console.log(`[运行时] 模式: ${m}`);
            }
            let a = detectAlgorithm(ctx);
            if (a) {
                lastAlgoFromRuntime = a;
                console.log(`[运行时] 算法: ${a}`);
            }
        } catch(_){}

        // Hook 加密
        if (arguments.length === 2 && arguments[1] && arguments[1].length === 1 && hasEncryptProp(arguments[1][0])) {
            if (arguments[0] && '$super' in arguments[0] && 'init' in arguments[0]) {
                const encObj = arguments[1][0];

                const cryptoInfo = {
                    operation: '对称加密',
                    ciphertext: null,
                    key: null,
                    iv: null,
                    mode: null,
                    padding: null,
                    keySize: null
                };

                try {
                    const text = arguments[0].$super.toString.call(encObj);
                    if (text !== '[object Object]') cryptoInfo.ciphertext = text;
                } catch(_){}

                try {
                    const key = encObj.key.toString();
                    if (key !== '[object Object]') cryptoInfo.key = key;
                } catch(_){}

                try {
                    if (encObj.iv) {
                        const iv = encObj.iv.toString();
                        if (iv !== '[object Object]') cryptoInfo.iv = iv;
                    }
                } catch(_){}

                // Mode / Algorithm: 优先用运行时检测的
                cryptoInfo.mode = lastModeFromRuntime || 'Unknown';
                cryptoInfo.algorithm = lastAlgoFromRuntime || (encObj.blockSize === 4 ? 'AES' : encObj.blockSize === 2 ? 'DES/3DES' : 'Unknown');
                cryptoInfo.padding = detectPadding(encObj.padding) || 'Unknown';

                try {
                    if (encObj.key && encObj.key.sigBytes) {
                        cryptoInfo.keySize = getSigBytes(encObj.key.sigBytes);
                    }
                } catch(_){}

                recentCryptoOp = cryptoInfo;
                cryptoOpTimestamp = Date.now();
                if (cryptoInfo.ciphertext) addCipherToIndex(cryptoInfo.ciphertext, cryptoInfo);

                logOnce('✓ 对称加密:', cryptoInfo);
            }
        }

        // Hook 解密
        else if (arguments.length === 2 && arguments[1] && arguments[1].length === 3 && hasDecryptProp(arguments[1][1])) {
            if (arguments[0] && '$super' in arguments[0] && 'init' in arguments[0] && arguments[1][0] === 2) {
                const decObj = arguments[1][2];

                const cryptoInfo = {
                    operation: '对称解密',
                    key: null,
                    iv: null,
                    mode: null,
                    padding: null
                };

                try {
                    const key = arguments[1][1].toString();
                    if (key !== '[object Object]') cryptoInfo.key = key;
                } catch(_){}

                try {
                    if (decObj.iv) {
                        const iv = decObj.iv.toString();
                        if (iv !== '[object Object]') cryptoInfo.iv = iv;
                    }
                } catch(_){}

                cryptoInfo.mode = lastModeFromRuntime || 'Unknown';
                cryptoInfo.algorithm = lastAlgoFromRuntime || (decObj.blockSize === 4 ? 'AES' : decObj.blockSize === 2 ? 'DES/3DES' : 'Unknown');
                cryptoInfo.padding = detectPadding(decObj.padding) || 'Unknown';

                recentCryptoOp = cryptoInfo;
                cryptoOpTimestamp = Date.now();
                // 解密阶段一般没有密文，不入索引

                logOnce('✓ 对称解密:', cryptoInfo);
            }
        }

        return temp_apply.call(this, ...arguments);
    };

    // ==================== JSEncrypt (RSA) Hook ====================

    function hasRSAProp(obj) {
        const requiredProps = [
            'constructor','getPrivateBaseKey','getPrivateBaseKeyB64','getPrivateKey',
            'getPublicBaseKey','getPublicBaseKeyB64','getPublicKey','parseKey','parsePropertiesFrom'
        ];
        if (!obj || typeof obj !== 'object') return false;
        for (const p of requiredProps) { if (!(p in obj)) return false; }
        return true;
    }

    function getRSAKeyBits(ctx) {
        try {
            // 优先从 RSAKey 对象获取（JSEncrypt 内部）
            let k = null;
            if (ctx && typeof ctx.getKey === 'function') {
                try { k = ctx.getKey(); } catch(_) {}
            }
            if (!k && ctx && 'key' in ctx) k = ctx.key;
            if (k && k.n) {
                if (typeof k.n.bitLength === 'function') return k.n.bitLength();
                const hex = k.n.toString(16);
                return hex.length * 4;
            }
            // 退化：从 PEM 长度估算（无需 ASN.1 解析）
            let pem = null;
            if (ctx && typeof ctx.getPublicKey === 'function') pem = ctx.getPublicKey();
            if (!pem && ctx && typeof ctx.getPrivateKey === 'function') pem = ctx.getPrivateKey();
            if (typeof pem === 'string') {
                const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
                const rawLen = (typeof atob === 'function') ? atob(b64).length : Math.floor(b64.length * 0.75);
                if (rawLen > 500) return 4096;
                if (rawLen > 300) return 2048;
                if (rawLen > 200) return 1536;
                if (rawLen > 128) return 1024;
                if (rawLen > 64) return 512;
            }
        } catch(_) {}
        return null;
    }

    (function installRSAHook(){
        const temp_call = Function.prototype.call;
        if (temp_call.__installedForRSA) return;
        Function.prototype.call = function() {
            try {
                if (arguments.length === 1 && arguments[0] && arguments[0].__proto__ && typeof arguments[0].__proto__ === 'object' && hasRSAProp(arguments[0].__proto__)) {
                    const base = arguments[0].__proto__.__proto__;
                    if (base && typeof base === 'object' && 'encrypt' in base && 'decrypt' in base) {
                        if (typeof base.encrypt === 'function' && base.encrypt.toString().indexOf('RSA加密') === -1) {
                            const temp_encrypt = base.encrypt;
                            base.encrypt = function () {
                                const encrypt_text = temp_encrypt.bind(this, ...arguments)();
                                const bits = getRSAKeyBits(this);
                                const info = {
                                    operation: 'RSA加密',
                                    algorithm: 'RSA',
                                    input: String(arguments[0] || ''),
                                    ciphertext: encrypt_text,
                                    key: (this && this.getPublicKey) ? this.getPublicKey() : null,
                                    keySize: bits ? bits + 'bits' : null
                                };
                                if (encrypt_text) addCipherToIndex(encrypt_text, info);
                                recentCryptoOp = info; cryptoOpTimestamp = Date.now();
                                logOnce('✓ RSA 加密:', info);
                                return encrypt_text;
                            };
                        }
                        if (typeof base.decrypt === 'function' && base.decrypt.toString().indexOf('RSA解密') === -1) {
                            const temp_decrypt = base.decrypt;
                            base.decrypt = function () {
                                const decrypt_text = temp_decrypt.bind(this, ...arguments)();
                                const bits = getRSAKeyBits(this);
                                const info = {
                                    operation: 'RSA解密',
                                    algorithm: 'RSA',
                                    ciphertext: String(arguments[0] || ''),
                                    key: (this && this.getPrivateKey) ? this.getPrivateKey() : null,
                                    keySize: bits ? bits + 'bits' : null
                                };
                                recentCryptoOp = info; cryptoOpTimestamp = Date.now();
                                logOnce('✓ RSA 解密:', info);
                                return decrypt_text;
                            };
                        }
                    }
                }
            } catch(_) {}
            return temp_call.bind(this, ...arguments)();
        };
        Function.prototype.call.__installedForRSA = true;
    })();

    // ==================== Hook XMLHttpRequest ====================

    const xhrMap = new WeakMap();
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        xhrMap.set(this, {method, url, stack: new Error().stack});
        console.log('[XHR] open:', method, url);
        return origOpen.apply(this, [method, url, ...args]);
    };

    XMLHttpRequest.prototype.send = function(data) {
        const xhr = xhrMap.get(this);
        if (xhr) {
            xhr.data = data;

            // 内容关联：仅当请求体或 URL 真正包含密文（含多种变体）才关联
            const bodyStr = serializeBody(data);
            let cryptoInfos = matchCryptoInText(xhr.url, bodyStr);
            // Fallback: 最近一次RSA操作 + 短窗口 + 有字符串请求体，则弱关联一次
            if ((!cryptoInfos || !cryptoInfos.length) && recentCryptoOp && recentCryptoOp.algorithm === 'RSA') {
                const within = Date.now() - cryptoOpTimestamp;
                if (within > 0 && within < 1200 && typeof bodyStr === 'string' && bodyStr.length) {
                    cryptoInfos = [recentCryptoOp];
                }
            }

            const record = {
                time: new Date().toLocaleTimeString(),
                method: xhr.method,
                url: xhr.url,
                requestData: formatData(data),
                cryptoInfo: cryptoInfos,
                stack: xhr.stack
            };

            capturedRequests.push(record);
            updatePanel(record);

            console.log('[XHR] send:', {url: xhr.url, hasCrypto: !!(cryptoInfos && cryptoInfos.length)});
            if ((!cryptoInfos || !cryptoInfos.length) && bodyStr) console.log('[关联] 未命中，body 片段:', bodyStr.slice(0, 120));
        }

        return origSend.apply(this, arguments);
    };

    // ==================== Hook Fetch ====================

    const origFetch = window.fetch;

    window.fetch = function(url, options = {}) {
        const body = options.body;
        const bodyStr = serializeBody(body);

        let cryptoInfos = matchCryptoInText(url, bodyStr);
        if ((!cryptoInfos || !cryptoInfos.length) && recentCryptoOp && recentCryptoOp.algorithm === 'RSA') {
            const within = Date.now() - cryptoOpTimestamp;
            if (within > 0 && within < 1200 && typeof bodyStr === 'string' && bodyStr.length) {
                cryptoInfos = [recentCryptoOp];
            }
        }

        const record = {
            time: new Date().toLocaleTimeString(),
            method: options.method || 'GET',
            url: typeof url === 'string' ? url : url.toString(),
            requestData: formatData(body),
            cryptoInfo: cryptoInfos,
            stack: new Error().stack
        };

        capturedRequests.push(record);
        updatePanel(record);

        console.log('[Fetch]:', {url: record.url, hasCrypto: !!(cryptoInfos && cryptoInfos.length)});
        if ((!cryptoInfos || !cryptoInfos.length) && bodyStr) console.log('[关联] 未命中，body 片段:', bodyStr.slice(0, 120));

        return origFetch.apply(this, arguments);
    };

    // ==================== 工具 ====================

    function formatData(data) {
        if (!data) return 'null';
        if (typeof data === 'string') return data.length > 300 ? data.substring(0, 300) + '...' : data;
        if (data instanceof URLSearchParams) {
            const arr = [];
            for (const [k, v] of data.entries()) arr.push(`${k}=${v}`);
            const str = arr.join('&');
            return str.length > 300 ? str.substring(0, 300) + '...' : str;
        }
        if (data instanceof FormData) {
            const arr = [];
            for (const [k, v] of data.entries()) arr.push(`${k}=${v}`);
            const str = arr.join('&');
            return str.length > 300 ? str.substring(0, 300) + '...' : str;
        }
        try {
            const str = JSON.stringify(data);
            return str.length > 300 ? str.substring(0, 300) + '...' : str;
        } catch(_) {
            return String(data);
        }
    }

    function serializeBody(data) {
        if (!data) return '';
        if (typeof data === 'string') return data;
        if (data instanceof URLSearchParams) {
            const arr = [];
            for (const [k, v] of data.entries()) arr.push(`${k}=${v}`);
            return arr.join('&');
        }
        if (data instanceof FormData) {
            const arr = [];
            for (const [k, v] of data.entries()) arr.push(`${k}=${v}`);
            return arr.join('&');
        }
        try { return JSON.stringify(data); } catch(_) { return ''; }
    }

    // ==================== 初始化 ====================

    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', createPanel);
        } else {
            setTimeout(createPanel, 100);
        }

        console.log('%c[最终版] 已安装', 'color:#0f0; font-weight:bold; font-size:14px;');
        console.log('✓ 运行时模式检测');
        console.log('✓ 密文匹配关联');
        console.log('✓ window.__capturedRequests 已暴露');
    }

    init();

})();
