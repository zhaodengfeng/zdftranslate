// ZDFTranslate - Background Service Worker
// 处理翻译请求、API调用、跨域等问题

const TRANSLATION_CACHE = new Map();
const CACHE_MAX_SIZE = 1000;

// 标签页翻译状态跟踪
const tabTranslationStatus = new Map();

// 请求限流：记录每个服务的上次请求时间
const lastRequestTime = new Map();
const MIN_REQUEST_INTERVAL = 300; // 服务间最小间隔 300ms

// 通用请求包装器：支持限流和重试
async function fetchWithRetry(url, options, serviceName, maxRetries = 3) {
  // 限流：确保同一服务请求间隔
  const now = Date.now();
  const lastTime = lastRequestTime.get(serviceName) || 0;
  const waitTime = MIN_REQUEST_INTERVAL - (now - lastTime);
  if (waitTime > 0) {
    await sleep(waitTime);
  }
  lastRequestTime.set(serviceName, Date.now());

  let lastResponse;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      lastResponse = response;
      
      // 429 限流：指数退避重试
      if (response.status === 429) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        console.log(`${serviceName}: 429 限流，等待 ${delay.toFixed(0)}ms 后重试 (${attempt + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }
      
      // 其他错误状态码
      if (!response.ok) {
        let errorDetail = '';
        try {
          const errorData = await response.json();
          errorDetail = errorData.error?.message || errorData.message || JSON.stringify(errorData);
        } catch (e) {
          errorDetail = await response.text().catch(() => '无法读取错误详情');
        }
        console.error(`${serviceName} API 错误详情:`, errorDetail);
        throw new Error(`${serviceName} API 错误 ${response.status}: ${errorDetail.slice(0, 300)}`);
      }
      
      return response;
    } catch (error) {
      // 网络错误或重试
      if (attempt < maxRetries - 1) {
        const delay = 1000 * (attempt + 1);
        console.log(`${serviceName}: 请求失败，${delay}ms 后重试 (${attempt + 1}/${maxRetries}): ${error.message}`);
        await sleep(delay);
      } else {
        // 最后一次尝试，抛出详细错误
        if (lastResponse && !lastResponse.ok) {
          throw new Error(`${serviceName} API 错误 ${lastResponse.status}: 重试${maxRetries}次后仍失败`);
        }
        throw error;
      }
    }
  }
  
  throw new Error(`${serviceName} 请求失败，已重试${maxRetries}次`);
}

// 辅助函数：延迟
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 默认模型配置
const DEFAULT_MODELS = {
  openai: 'gpt-3.5-turbo',
  kimi: 'moonshot-v1-8k',
  zhipu: 'glm-4-flash',
  aliyun: 'qwen-turbo',
  deepseek: 'deepseek-chat'
};

// 默认配置
const DEFAULT_CONFIG = {
  enabled: true,
  targetLang: 'zh-CN',
  sourceLang: 'auto',
  displayMode: 'bilingual',
  translationService: 'libretranslate',
  selectedModels: { ...DEFAULT_MODELS },
  apiKeys: {
    google: '',
    deepl: '',
    openai: '',
    kimi: '',
    zhipu: '',
    aliyun: '',
    deepseek: ''
  },
  excludedSites: [],
  style: {
    translationColor: '#666666',
    translationSize: '0.95em',
    lineSpacing: '1.6',
    backgroundHighlight: false
  }
};

// 安装时初始化
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({ zdfConfig: DEFAULT_CONFIG });
    console.log('ZDFTranslate installed successfully');
  }
});

// 标签页切换时更新状态
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const status = tabTranslationStatus.get(activeInfo.tabId) || false;
  // 通知 popup 更新状态
  chrome.runtime.sendMessage({ 
    action: 'tabStatusChanged', 
    tabId: activeInfo.tabId, 
    isTranslated: status 
  }).catch(() => {});
});

// 标签页关闭时清理状态
chrome.tabs.onRemoved.addListener((tabId) => {
  tabTranslationStatus.delete(tabId);
});

// 页面刷新时重置状态
chrome.webNavigation?.onBeforeNavigate?.addListener((details) => {
  if (details.frameId === 0) {
    tabTranslationStatus.delete(details.tabId);
  }
});

// 更新标签页翻译状态
function setTabTranslationStatus(tabId, isTranslated) {
  tabTranslationStatus.set(tabId, isTranslated);
}

// 处理消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    handleTranslation(request)
      .then(result => sendResponse({ translatedText: result }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
  
  if (request.action === 'getConfig') {
    chrome.storage.sync.get(['zdfConfig'], (result) => {
      sendResponse(result.zdfConfig || DEFAULT_CONFIG);
    });
    return true;
  }
  
  if (request.action === 'saveConfig') {
    chrome.storage.sync.set({ zdfConfig: request.config }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (request.action === 'setTabStatus') {
    setTabTranslationStatus(request.tabId, request.isTranslated);
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'getTabStatus') {
    const status = tabTranslationStatus.get(request.tabId) || false;
    sendResponse({ isTranslated: status });
    return true;
  }
  
  if (request.action === 'getModels') {
    fetchModels(request.service)
      .then(models => sendResponse({ models }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});

// 处理翻译请求
async function handleTranslation(request) {
  const { text, targetLang, sourceLang, service } = request;
  
  console.log('翻译请求:', { service, targetLang, sourceLang, textLength: text?.length });
  
  // 检查缓存
  const cacheKey = `${text}_${targetLang}_${sourceLang}`;
  if (TRANSLATION_CACHE.has(cacheKey)) {
    return TRANSLATION_CACHE.get(cacheKey);
  }
  
  let result;
  
  switch (service) {
    case 'libretranslate':
      result = await translateWithLibreTranslate(text, targetLang, sourceLang);
      break;
    case 'google':
      result = await translateWithGoogle(text, targetLang, sourceLang);
      break;
    case 'deepl':
      result = await translateWithDeepL(text, targetLang, sourceLang);
      break;
    case 'openai':
      result = await translateWithOpenAI(text, targetLang, sourceLang);
      break;
    case 'kimi':
      result = await translateWithKimi(text, targetLang, sourceLang);
      break;
    case 'zhipu':
      result = await translateWithZhipu(text, targetLang, sourceLang);
      break;
    case 'aliyun':
      result = await translateWithAliyun(text, targetLang, sourceLang);
      break;
    case 'deepseek':
      result = await translateWithDeepSeek(text, targetLang, sourceLang);
      break;
    default:
      result = await translateWithLibreTranslate(text, targetLang, sourceLang);
  }
  
  // 存入缓存
  if (TRANSLATION_CACHE.size >= CACHE_MAX_SIZE) {
    const firstKey = TRANSLATION_CACHE.keys().next().value;
    TRANSLATION_CACHE.delete(firstKey);
  }
  TRANSLATION_CACHE.set(cacheKey, result);
  
  return result;
}

// 免费翻译服务 - LibreTranslate + MyMemory 双重保障
async function translateWithLibreTranslate(text, targetLang, sourceLang) {
  // 首先尝试 LibreTranslate
  try {
    return await translateWithLibreTranslateInstances(text, targetLang, sourceLang);
  } catch (libreError) {
    console.log('[ZDFTranslate] LibreTranslate 全部失败，尝试 MyMemory:', libreError.message);
    // 回退到 MyMemory
    return await translateWithMyMemory(text, targetLang, sourceLang);
  }
}

// LibreTranslate 多实例尝试
async function translateWithLibreTranslateInstances(text, targetLang, sourceLang) {
  // 语言代码映射
  const langMap = {
    'zh-CN': 'zh',
    'zh-TW': 'zh',
    'en': 'en',
    'ja': 'ja',
    'ko': 'ko',
    'fr': 'fr',
    'de': 'de',
    'es': 'es',
    'ru': 'ru',
    'it': 'it',
    'pt': 'pt'
  };
  
  const target = langMap[targetLang] || targetLang.split('-')[0];
  const source = sourceLang === 'auto' ? 'auto' : (langMap[sourceLang] || sourceLang.split('-')[0]);
  
  console.log('[ZDFTranslate] LibreTranslate 请求:', { source, target, textLength: text.length });
  
  // 扩展的免费公共实例列表
  const instances = [
    'https://libretranslate.de',
    'https://translate.argosopentech.com',
    'https://libretranslate.pussthecat.org',
    'https://translate.terraprint.co',
    'https://lt.vern.cc',
    'https://translate.dragonstring.xyz',
    'https://translate.josias.dev',
    'https://libretranslate.eownerdead.de',
    'https://translate.flossboxin.org.in',
    'https://libretranslate.nicfab.eu'
  ];
  
  let lastError;
  
  for (const baseUrl of instances) {
    try {
      console.log(`[ZDFTranslate] 尝试 LibreTranslate: ${baseUrl}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒超时
      
      const response = await fetch(`${baseUrl}/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          q: text.slice(0, 1500),
          source: source,
          target: target,
          format: 'text'
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.translatedText) {
        console.log(`[ZDFTranslate] LibreTranslate 成功: ${baseUrl}`);
        return data.translatedText;
      }
      if (data.translation) {
        return data.translation;
      }
      if (data.translations && data.translations[0]) {
        return data.translations[0].text || data.translations[0].translation;
      }
      if (data.error) {
        throw new Error(data.error);
      }
    } catch (error) {
      lastError = error;
      console.log(`[ZDFTranslate] LibreTranslate ${baseUrl} 失败:`, error.message);
      continue;
    }
  }
  
  throw new Error(`所有 LibreTranslate 实例都失败了`);
}

// MyMemory 备用翻译
async function translateWithMyMemory(text, targetLang, sourceLang) {
  const langMap = {
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    'en': 'en-US',
    'ja': 'ja',
    'ko': 'ko',
    'fr': 'fr',
    'de': 'de',
    'es': 'es',
    'ru': 'ru',
    'it': 'it',
    'pt': 'pt'
  };
  
  const target = langMap[targetLang] || targetLang.split('-')[0];
  const source = sourceLang === 'auto' ? 'Autodetect' : (langMap[sourceLang] || sourceLang.split('-')[0]);
  
  console.log('[ZDFTranslate] MyMemory 备用请求:', { source, target, textLength: text.length });
  
  const encodedText = encodeURIComponent(text.slice(0, 500));
  const url = `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=${source}|${target}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timeoutId);
  
  if (!response.ok) {
    throw new Error(`MyMemory HTTP ${response.status}`);
  }
  
  const data = await response.json();
  
  if (data.responseData && data.responseData.translatedText) {
    console.log('[ZDFTranslate] MyMemory 备用成功');
    return data.responseData.translatedText;
  }
  
  if (data.responseStatus && data.responseStatus !== 200) {
    throw new Error(`MyMemory 错误: ${data.responseDetails || '配额用尽'}`);
  }
  
  throw new Error('MyMemory 返回异常');
}

// Google Translate API (需要API Key)
async function translateWithGoogle(text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.google;
  
  if (!apiKey) {
    throw new Error('Google Translate API key not configured');
  }
  
  const url = 'https://translation.googleapis.com/language/translate/v2';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: text,
      target: targetLang,
      source: sourceLang === 'auto' ? undefined : sourceLang,
      format: 'text',
      key: apiKey
    })
  });
  
  if (!response.ok) {
    throw new Error(`Google Translate API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.data.translations[0].translatedText;
}

// DeepL API (需要API Key)
async function translateWithDeepL(text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.deepl;
  
  if (!apiKey) {
    throw new Error('DeepL API key not configured');
  }
  
  const url = apiKey.endsWith(':fx') 
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
    
  const params = new URLSearchParams({
    text: text,
    target_lang: targetLang.toUpperCase(),
  });
  
  if (sourceLang !== 'auto') {
    params.append('source_lang', sourceLang.toUpperCase());
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params
  });
  
  if (!response.ok) {
    throw new Error(`DeepL API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.translations[0].text;
}

// OpenAI API (需要API Key)
async function translateWithOpenAI(text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.openai;
  const model = zdfConfig?.selectedModels?.openai || DEFAULT_MODELS.openai;
  
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }
  
  const langNames = {
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    'en': 'English',
    'ja': '日本語',
    'ko': '한국어',
    'fr': 'Français',
    'de': 'Deutsch',
    'es': 'Español',
    'ru': 'Русский'
  };
  
  const targetLangName = langNames[targetLang] || targetLang;
  const sourceHint = sourceLang !== 'auto' ? `from ${langNames[sourceLang] || sourceLang}` : '';
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: `You are a professional translator. Translate the following text to ${targetLangName} ${sourceHint}. Preserve the original formatting and tone. Only return the translation, no explanations.`
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.3,
      max_tokens: 2000
    })
  });
  
  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// Kimi API (月之暗面) - https://platform.moonshot.cn/
async function translateWithKimi(text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.kimi;
  const model = zdfConfig?.selectedModels?.kimi || DEFAULT_MODELS.kimi;
  
  if (!apiKey) {
    throw new Error('Kimi API key not configured');
  }
  
  const langNames = {
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    'en': 'English',
    'ja': '日本語',
    'ko': '한국어',
    'fr': 'Français',
    'de': 'Deutsch',
    'es': 'Español',
    'ru': 'Русский'
  };
  
  const targetLangName = langNames[targetLang] || targetLang;
  const sourceHint = sourceLang !== 'auto' ? `从${langNames[sourceLang] || sourceLang}` : '';
  
  const requestBody = {
    model: model,
    messages: [
      {
        role: 'system',
        content: `你是一个专业翻译助手。请将用户提供的文本翻译成${targetLangName}${sourceHint}。保持原文格式和语气，只返回译文，不要解释。`
      },
      {
        role: 'user',
        content: text
      }
    ]
  };
  
  const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Kimi API error: ${response.status} - ${errorData.error?.message || JSON.stringify(errorData)}`);
  }
  
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// 智谱清言 API (GLM) - https://open.bigmodel.cn/
async function translateWithZhipu(text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.zhipu;
  const model = zdfConfig?.selectedModels?.zhipu || DEFAULT_MODELS.zhipu;
  
  if (!apiKey) {
    throw new Error('智谱清言 API key not configured');
  }
  
  const langNames = {
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    'en': '英文',
    'ja': '日文',
    'ko': '韩文',
    'fr': '法文',
    'de': '德文',
    'es': '西班牙文',
    'ru': '俄文'
  };
  
  const targetLangName = langNames[targetLang] || targetLang;
  const sourceHint = sourceLang !== 'auto' ? `从${langNames[sourceLang] || sourceLang}` : '';
  
  const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: `你是一个专业翻译助手。请将用户提供的文本翻译成${targetLangName}${sourceHint}。保持原文格式和语气，只返回译文，不要解释。`
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.3
    })
  });
  
  if (!response.ok) {
    throw new Error(`智谱清言 API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// 阿里云百炼 API - https://bailian.console.aliyun.com/
// 使用 OpenAI 兼容模式
async function translateWithAliyun(text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.aliyun;
  const model = zdfConfig?.selectedModels?.aliyun || DEFAULT_MODELS.aliyun;
  
  if (!apiKey) {
    throw new Error('阿里云百炼 API key not configured');
  }
  
  const langMap = {
    'zh-CN': 'Chinese',
    'zh-TW': 'Chinese',
    'en': 'English',
    'ja': 'Japanese',
    'ko': 'Korean',
    'fr': 'French',
    'de': 'German',
    'es': 'Spanish',
    'ru': 'Russian'
  };
  
  // 检查是否是 Qwen-MT 翻译专用模型
  const isMTModel = model.includes('mt') || model.includes('mt-turbo') || model.includes('mt-plus');
  
  let requestBody;
  
  if (isMTModel) {
    // Qwen-MT 模型：使用阿里云原生 API 格式
    const actualSourceLang = sourceLang === 'auto' ? 'auto' : (langMap[sourceLang] || sourceLang);
    const actualTargetLang = langMap[targetLang] || targetLang;
    
    console.log('阿里云 MT 模型参数:', { 
      sourceLang, targetLang, 
      actualSourceLang, actualTargetLang,
      textPreview: text.slice(0, 50) 
    });
    
    // 使用阿里云原生 API 格式，不是 OpenAI 兼容模式
    const mtRequestBody = {
      model: model,
      input: {
        messages: [
          {
            role: 'user',
            content: text
          }
        ]
      },
      parameters: {
        translation_options: {
          source_lang: actualSourceLang,
          target_lang: actualTargetLang
        }
      }
    };
    
    console.log('[ZDFTranslate] 阿里云 MT 请求体:', JSON.stringify(mtRequestBody, null, 2));
    
    // 直接调用阿里云原生 API
    const mtResponse = await fetchWithRetry(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(mtRequestBody)
      },
      'aliyun-mt',
      3
    );
    
    const mtData = await mtResponse.json();
    console.log('[ZDFTranslate] 阿里云 MT 响应:', JSON.stringify(mtData, null, 2).slice(0, 500));
    
    if (mtData.output?.text) {
      return mtData.output.text.trim();
    }
    if (mtData.output?.choices?.[0]?.message?.content) {
      return mtData.output.choices[0].message.content.trim();
    }
    
    throw new Error(`阿里云 MT 返回异常: ${JSON.stringify(mtData).slice(0, 200)}`);
  } else {
    // 普通模型使用 OpenAI 兼容模式
    const langNames = {
      'zh-CN': '简体中文',
      'zh-TW': '繁體中文',
      'en': 'English',
      'ja': '日本語',
      'ko': '한국어',
      'fr': 'Français',
      'de': 'Deutsch',
      'es': 'Español',
      'ru': 'Русский'
    };
    const targetLangName = langNames[targetLang] || targetLang;
    const sourceHint = sourceLang !== 'auto' ? `from ${langNames[sourceLang] || sourceLang}` : '';
    
    const requestBody = {
      model: model,
      messages: [
        {
          role: 'system',
          content: `You are a professional translator. Translate the following text to ${targetLangName} ${sourceHint}. Preserve the original formatting and tone. Only return the translation, no explanations.`
        },
        {
          role: 'user',
          content: text
        }
      ]
    };
    
    console.log('[ZDFTranslate] 阿里云 OpenAI 兼容请求:', { model, targetLang, textLength: text.length });
    
    const response = await fetchWithRetry(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      },
      'aliyun',
      3
    );

    const data = await response.json();
    
    // 处理 OpenAI 兼容格式的响应
    if (data.choices?.[0]?.message?.content) {
      return data.choices[0].message.content.trim();
    }
    
    // 错误处理
    if (data.error) {
      throw new Error(`阿里云百炼错误: ${data.error.message || data.error.code || JSON.stringify(data.error)}`);
    }
    
    console.error('阿里云百炼返回格式异常:', JSON.stringify(data).slice(0, 500));
    throw new Error('阿里云百炼 API 返回格式异常，请检查模型名称是否正确');
  }
}

// DeepSeek API - https://platform.deepseek.com/
async function translateWithDeepSeek(text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.deepseek;
  const model = zdfConfig?.selectedModels?.deepseek || DEFAULT_MODELS.deepseek;
  
  if (!apiKey) {
    throw new Error('DeepSeek API key not configured');
  }
  
  const langNames = {
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    'en': 'English',
    'ja': '日本語',
    'ko': '한국어',
    'fr': 'Français',
    'de': 'Deutsch',
    'es': 'Español',
    'ru': 'Русский'
  };
  
  const targetLangName = langNames[targetLang] || targetLang;
  const sourceHint = sourceLang !== 'auto' ? `from ${langNames[sourceLang] || sourceLang}` : '';
  
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: `You are a professional translator. Translate the following text to ${targetLangName} ${sourceHint}. Preserve the original formatting and tone. Only return the translation, no explanations.`
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.3
    })
  });
  
  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// 获取可用模型列表
async function fetchModels(service) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  
  switch (service) {
    case 'openai':
      return await fetchOpenAIModels(zdfConfig?.apiKeys?.openai);
    case 'kimi':
      return await fetchKimiModels(zdfConfig?.apiKeys?.kimi);
    case 'zhipu':
      return await fetchZhipuModels(zdfConfig?.apiKeys?.zhipu);
    case 'deepseek':
      return await fetchDeepSeekModels(zdfConfig?.apiKeys?.deepseek);
    case 'aliyun':
      return await fetchAliyunModels(zdfConfig?.apiKeys?.aliyun);
    default:
      return [];
  }
}

// OpenAI 模型列表
async function fetchOpenAIModels(apiKey) {
  if (!apiKey) {
    return [
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
      { id: 'gpt-4', name: 'GPT-4' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' }
    ];
  }
  
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    if (!response.ok) throw new Error('Failed to fetch models');
    
    const data = await response.json();
    return data.data
      .filter(m => m.id.includes('gpt'))
      .map(m => ({ id: m.id, name: m.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch (error) {
    return [
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
      { id: 'gpt-4', name: 'GPT-4' }
    ];
  }
}

// Kimi 模型列表
async function fetchKimiModels(apiKey) {
  return [
    { id: 'moonshot-v1-8k', name: 'Moonshot v1 (8K)' },
    { id: 'moonshot-v1-32k', name: 'Moonshot v1 (32K)' },
    { id: 'moonshot-v1-128k', name: 'Moonshot v1 (128K)' }
  ];
}

// 智谱清言模型列表
async function fetchZhipuModels(apiKey) {
  return [
    { id: 'glm-4-flash', name: 'GLM-4 Flash (免费)' },
    { id: 'glm-4', name: 'GLM-4' },
    { id: 'glm-4-plus', name: 'GLM-4 Plus' },
    { id: 'glm-4-air', name: 'GLM-4 Air' }
  ];
}

// DeepSeek 模型列表
async function fetchDeepSeekModels(apiKey) {
  return [
    { id: 'deepseek-chat', name: 'DeepSeek Chat' },
    { id: 'deepseek-coder', name: 'DeepSeek Coder' }
  ];
}

// 阿里云百炼模型列表
async function fetchAliyunModels(apiKey) {
  return [
    { id: 'qwen-turbo', name: '通义千问 Turbo' },
    { id: 'qwen-plus', name: '通义千问 Plus' },
    { id: 'qwen-max', name: '通义千问 Max' }
  ];
}

// 清理旧缓存（每1小时清理一次，避免内存泄漏）
setInterval(() => {
  // LRU策略：只保留最近500条缓存
  if (TRANSLATION_CACHE.size > 500) {
    const keysToDelete = Array.from(TRANSLATION_CACHE.keys()).slice(0, TRANSLATION_CACHE.size - 500);
    keysToDelete.forEach(key => TRANSLATION_CACHE.delete(key));
    console.log(`ZDFTranslate: 清理了 ${keysToDelete.length} 条过期缓存`);
  }
}, 60 * 60 * 1000);
