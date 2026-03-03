/**
 * 免费翻译服务集合
 * 包含 Google Translate、Microsoft Translator、DeepLX 等免费 API
 */

/**
 * Google Translate 免费 API（使用 gtranslate 逆向接口）
 * 注意：这是非官方接口，可能有稳定性问题
 */
async function translateWithGoogleFree(text, targetLang, sourceLang = 'auto') {
  const target = targetLang === 'zh-CN' ? 'zh-CN' : 
                  targetLang === 'zh-TW' ? 'zh-TW' : 
                  targetLang.split('-')[0];
  const source = sourceLang === 'auto' ? 'auto' : sourceLang.split('-')[0];
  
  // 使用 gtranslate 免费接口
  const endpoints = [
    'https://translate.googleapis.com/translate_a/single',
    'https://translation.googleapis.com/language/translate/v2'  // 备用
  ];
  
  const params = new URLSearchParams({
    client: 'gtx',
    sl: source,
    tl: target,
    hl: target,
    dt: 't',
    dt: 'bd',
    dj: '1',
    source: 'input',
    q: text
  });
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}?${params.toString()}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!response.ok) continue;
      
      const data = await response.json();
      
      // 解析 Google Translate 响应格式
      if (data.sentences) {
        return data.sentences.map(s => s.trans).join('');
      } else if (data.data?.translations) {
        return data.data.translations.map(t => t.translatedText).join('');
      }
    } catch (e) {
      console.warn(`Google Free endpoint failed: ${endpoint}`, e);
    }
  }
  
  throw new Error('Google Translate 免费接口不可用');
}

/**
 * Microsoft Translator 免费 API（使用 Azure Cognitive Services 免费层）
 */
class MicrosoftTranslator {
  constructor() {
    this.baseUrl = 'https://api.cognitive.microsofttranslator.com';
    this.authUrl = 'https://edge.microsoft.com/translate/auth';  // Edge 浏览器内置接口
  }

  /**
   * 获取访问令牌（通过 Edge 接口或用户配置的 Key）
   */
  async getToken(config) {
    // 如果用户配置了 Azure Key，直接使用
    if (config?.apiKeys?.microsoft) {
      return { key: config.apiKeys.microsoft, region: config.microsoftRegion || 'global' };
    }
    
    // 否则尝试使用 Edge 免费接口
    try {
      const response = await fetch(this.authUrl);
      if (response.ok) {
        const token = await response.text();
        return { token: token.trim() };
      }
    } catch (e) {
      console.warn('Microsoft Edge 免费接口失败:', e);
    }
    
    throw new Error('Microsoft Translator 需要配置 API Key 或 Edge 浏览器');
  }

  async translate(text, targetLang, sourceLang = null, config) {
    const auth = await this.getToken(config);
    
    const target = targetLang === 'zh-CN' ? 'zh-Hans' : 
                    targetLang === 'zh-TW' ? 'zh-Hant' : 
                    targetLang;
    
    const url = `${this.baseUrl}/translate?api-version=3.0&to=${target}`;
    const fromParam = sourceLang && sourceLang !== 'auto' ? `&from=${sourceLang}` : '';
    
    const headers = {
      'Content-Type': 'application/json',
    };
    
    if (auth.key) {
      headers['Ocp-Apim-Subscription-Key'] = auth.key;
      if (auth.region && auth.region !== 'global') {
        headers['Ocp-Apim-Subscription-Region'] = auth.region;
      }
    } else if (auth.token) {
      headers['Authorization'] = `Bearer ${auth.token}`;
    }
    
    const body = [{
      text: text
    }];
    
    const response = await fetch(url + fromParam, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Microsoft Translator 错误: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    return data[0]?.translations?.[0]?.text || text;
  }
}

/**
 * DeepLX 免费 API（DeepL 的第三方免费接口）
 */
async function translateWithDeepLX(text, targetLang, sourceLang = 'auto') {
  // DeepLX 公共实例列表
  const endpoints = [
    'https://api.deeplx.org',
    'https://deeplx.vercel.app',
    'https://deeplx.space',
    'https://deeplx.pot-app.com',
    'https://api.deeplx.org/translate',
  ];
  
  const target = targetLang === 'zh-CN' ? 'ZH' : 
                  targetLang === 'zh-TW' ? 'ZH' : 
                  targetLang.toUpperCase().split('-')[0];
  const source = sourceLang === 'auto' ? 'auto' : sourceLang.toUpperCase().split('-')[0];
  
  const payload = {
    text: text,
    source_lang: source,
    target_lang: target,
    quality: 'normal'
  };
  
  for (const endpoint of endpoints) {
    try {
      const url = endpoint.endsWith('/translate') ? endpoint : `${endpoint}/translate`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) continue;
      
      const data = await response.json();
      if (data.data) {
        return data.data;
      } else if (data.result) {
        return data.result;
      } else if (data.translation) {
        return data.translation;
      }
    } catch (e) {
      console.warn(`DeepLX endpoint failed: ${endpoint}`, e);
    }
  }
  
  throw new Error('DeepLX 所有接口不可用');
}

/**
 * LibreTranslate 免费实例列表
 */
const LIBRETRANSLATE_INSTANCES = [
  'https://libretranslate.de',
  'https://libretranslate.com',  // 需要 API key 但有限免
  'https://translate.argosopentech.com',
  'https://libretranslate.pussthecat.org',
  'https://translate.terraprint.co',
  'https://lt.vern.cc',
  'https://libretranslate.northelity.com',
];

async function translateWithLibreTranslateEnhanced(text, targetLang, sourceLang = 'auto') {
  const target = targetLang === 'zh-CN' ? 'zh' : targetLang.split('-')[0];
  const source = sourceLang === 'auto' ? 'auto' : sourceLang.split('-')[0];
  
  // 打乱顺序，避免总是请求同一个实例
  const shuffled = [...LIBRETRANSLATE_INSTANCES].sort(() => Math.random() - 0.5);
  
  for (const instance of shuffled) {
    try {
      const response = await fetch(`${instance}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source: source,
          target: target,
          format: 'text'
        })
      });
      
      if (!response.ok) {
        const error = await response.text();
        console.warn(`LibreTranslate instance ${instance} failed:`, error);
        continue;
      }
      
      const data = await response.json();
      if (data.translatedText) {
        return data.translatedText;
      }
    } catch (e) {
      console.warn(`LibreTranslate instance ${instance} error:`, e);
    }
  }
  
  throw new Error('所有 LibreTranslate 实例都不可用');
}

/**
 * MyMemory 免费翻译 API
 */
async function translateWithMyMemory(text, targetLang, sourceLang = 'auto') {
  const target = targetLang.split('-')[0];
  const source = sourceLang === 'auto' ? 'Autodetect' : sourceLang.split('-')[0];
  
  const email = ''; // 可选：填入邮箱可获得更多配额
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}${email ? `&de=${email}` : ''}`;
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.responseStatus !== 200) {
    throw new Error(`MyMemory 错误: ${data.responseStatus} - ${data.responseDetails}`);
  }
  
  return data.responseData.translatedText;
}

/**
 * 翻译服务管理器
 */
class FreeTranslationService {
  constructor() {
    this.microsoftTranslator = new MicrosoftTranslator();
    this.cache = new Map();
    this.cacheMaxSize = 500;
  }

  async translate(text, targetLang, sourceLang = 'auto', service = 'libretranslate', config = {}) {
    const cacheKey = `${service}:${text}:${targetLang}:${sourceLang}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    let result;
    
    switch (service) {
      case 'googlefree':
        result = await translateWithGoogleFree(text, targetLang, sourceLang);
        break;
      case 'microsoft':
        result = await this.microsoftTranslator.translate(text, targetLang, sourceLang, config);
        break;
      case 'deeplx':
        result = await translateWithDeepLX(text, targetLang, sourceLang);
        break;
      case 'mymemory':
        result = await translateWithMyMemory(text, targetLang, sourceLang);
        break;
      case 'libretranslate':
      default:
        result = await translateWithLibreTranslateEnhanced(text, targetLang, sourceLang);
        break;
    }

    // 缓存结果
    if (this.cache.size >= this.cacheMaxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(cacheKey, result);
    
    return result;
  }

  /**
   * 健康检查：测试各服务可用性
   */
  async healthCheck() {
    const testText = 'Hello';
    const targetLang = 'zh-CN';
    
    const results = {};
    
    const services = [
      { name: 'libretranslate', fn: () => translateWithLibreTranslateEnhanced(testText, targetLang) },
      { name: 'deeplx', fn: () => translateWithDeepLX(testText, targetLang) },
      { name: 'mymemory', fn: () => translateWithMyMemory(testText, targetLang) },
    ];
    
    for (const service of services) {
      try {
        await Promise.race([
          service.fn(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]);
        results[service.name] = { available: true };
      } catch (e) {
        results[service.name] = { available: false, error: e.message };
      }
    }
    
    return results;
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FreeTranslationService,
    MicrosoftTranslator,
    translateWithGoogleFree,
    translateWithDeepLX,
    translateWithLibreTranslateEnhanced,
    translateWithMyMemory,
    LIBRETRANSLATE_INSTANCES
  };
}
