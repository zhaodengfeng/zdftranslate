// ZDFTranslate - Background Service Worker
// 处理翻译请求、API调用、跨域等问题
// v2.2.0 - 新增 Token Bucket 限流和配置管理系统

// 导入新模块（通过 importScripts 在 Service Worker 中加载）
try {
  importScripts('lib/token-bucket.js', 'lib/config-manager.js');
} catch (e) {
  console.warn('[ZDFTranslate] Failed to import modules:', e);
}

const TRANSLATION_CACHE = new Map();
const CACHE_MAX_SIZE = 1000;

// 标签页翻译状态跟踪
const tabTranslationStatus = new Map();

// 初始化限流管理器
let rateLimitManager;
if (typeof RateLimitManager !== 'undefined') {
  rateLimitManager = new RateLimitManager();
} else {
  // 降级：使用旧版简单限流
  rateLimitManager = null;
}

self.addEventListener('unhandledrejection', (event) => {
  console.error('[ZDFTranslate] unhandledrejection:', event?.reason || event);
});

self.addEventListener('error', (event) => {
  console.error('[ZDFTranslate] worker error:', event?.message || event);
});

// 通用请求包装器：支持 Token Bucket 限流和重试
async function fetchWithRetry(url, options, serviceName, maxRetries = 2) {
  // 使用 Token Bucket 限流（如果可用）
  if (rateLimitManager) {
    await rateLimitManager.wait(serviceName);
  } else {
    // 降级：使用旧版限流
    await legacyRateLimit(serviceName);
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    try {
      const fetchOptions = { ...options, signal: controller.signal };
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      
      // 429 限流：指数退避重试
      if (response.status === 429 && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 500 + Math.random() * 200;
        await sleep(delay);
        continue;
      }
      
      if (!response.ok) {
        let errorDetail = '';
        try {
          const errorData = await response.json();
          errorDetail = errorData.error?.message || errorData.message || JSON.stringify(errorData);
        } catch (e) {
          errorDetail = await response.text().catch(() => '无法读取错误详情');
        }
        throw new Error(`${serviceName} API 错误 ${response.status}: ${errorDetail.slice(0, 200)}`);
      }
      
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error(`${serviceName} 请求超时`);
      }
      
      if (attempt < maxRetries - 1) {
        const delay = 500 * (attempt + 1);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
  throw new Error(`${serviceName} 请求失败`);
}

// 旧版限流（降级用）
const lastRequestTime = new Map();
const MIN_REQUEST_INTERVAL_BY_SERVICE = {
  default: 80,
  libretranslate: 300,
  mymemory: 250,
  aliyun: 60,
  'aliyun-mt': 60,
  kimi: 50,
  zhipu: 60,
  deepseek: 60,
  openai: 60,
  openrouter: 60,
  custom: 60
};

async function legacyRateLimit(serviceName) {
  const now = Date.now();
  const lastTime = lastRequestTime.get(serviceName) || 0;
  const minInterval = MIN_REQUEST_INTERVAL_BY_SERVICE[serviceName] || MIN_REQUEST_INTERVAL_BY_SERVICE.default;
  const waitTime = minInterval - (now - lastTime);
  if (waitTime > 0) {
    await sleep(waitTime);
  }
  lastRequestTime.set(serviceName, Date.now());
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 默认模型配置
const DEFAULT_MODELS = {
  openai: 'gpt-3.5-turbo',
  kimi: 'moonshot-v1-8k',
  zhipu: 'glm-4-flash',
  aliyun: 'qwen-turbo',
  deepseek: 'deepseek-chat',
  openrouter: 'openai/gpt-4o-mini'
};

function ensureApiKey(key, serviceName) {
  if (!key || !String(key).trim()) {
    throw new Error(`${serviceName} API key not configured`);
  }
}

function ensureContextMenu() {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'zdf-translate-selection',
        title: '使用 ZDFTranslate 翻译',
        contexts: ['selection']
      }, () => {
        const err = chrome.runtime.lastError;
        if (err) console.warn('[ZDFTranslate] contextMenus.create:', err.message);
      });
    });
  } catch (e) {
    console.warn('[ZDFTranslate] ensureContextMenu failed:', e);
  }
}

// 获取默认配置（兼容旧版本）
function getDefaultConfig() {
  if (typeof getDefaultConfigFromManager === 'function') {
    return getDefaultConfigFromManager();
  }
  
  // 降级配置
  return {
    version: 4,
    enabled: true,
    targetLang: 'zh-CN',
    sourceLang: 'auto',
    displayMode: 'bilingual',
    translationService: 'libretranslate',
    autoTranslateYouTube: true,
    autoEnableYouTubeCC: true,
    showFloatingImageExportButton: true,
    showFloatingPdfExportButton: true,
    selectedModels: { ...DEFAULT_MODELS },
    apiKeys: {},
    customServices: [],
    excludedSites: [],
    rateLimitConfig: {
      libretranslate: { capacity: 3, rate: 4 },
      openai: { capacity: 10, rate: 20 },
      default: { capacity: 5, rate: 8 }
    },
    preloadConfig: {
      margin: 200,
      threshold: 0.1
    },
    style: {
      translationColor: '#111111',
      translationSize: '0.95em',
      lineSpacing: '1.6',
      backgroundHighlight: false
    }
  };
}

// 安装时初始化
chrome.runtime.onInstalled.addListener((details) => {
  try {
    if (details.reason === 'install') {
      chrome.storage.sync.set({ zdfConfig: getDefaultConfig() }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[ZDFTranslate] init default config failed:', chrome.runtime.lastError.message);
        }
      });
      ensureContextMenu();
      return;
    }

    if (details.reason === 'update') {
      // 使用新的配置迁移系统
      chrome.storage.sync.get(['zdfConfig'], (res) => {
        try {
          let cfg = res?.zdfConfig || {};
          
          // 使用 migrateConfig 如果可用
          if (typeof migrateConfig === 'function') {
            cfg = migrateConfig(cfg);
            console.log('[ZDFTranslate] Config migrated to version', cfg.version);
          } else {
            // 降级：手动迁移
            cfg = manualMigrateConfig(cfg);
          }
          
          // 更新限流配置
          if (cfg.rateLimitConfig && rateLimitManager) {
            Object.entries(cfg.rateLimitConfig).forEach(([service, config]) => {
              if (service !== 'default') {
                rateLimitManager.updateConfig(service, config.capacity, config.rate);
              }
            });
          }
          
          chrome.storage.sync.set({ zdfConfig: cfg }, () => {
            if (chrome.runtime.lastError) {
              console.warn('[ZDFTranslate] migrate config failed:', chrome.runtime.lastError.message);
            }
          });
        } catch (e) {
          console.warn('[ZDFTranslate] update migration failed:', e);
        }
      });
      ensureContextMenu();
      return;
    }

    ensureContextMenu();
  } catch (e) {
    console.error('[ZDFTranslate] onInstalled failed:', e);
  }
});

// 手动配置迁移（降级用）
function manualMigrateConfig(cfg) {
  const version = cfg.version || 1;
  
  if (version < 2) {
    cfg.selectedModels = { ...DEFAULT_MODELS };
    cfg.version = 2;
  }
  
  if (version < 3) {
    cfg.customServices = cfg.customServices || [];
    cfg.version = 3;
  }
  
  if (version < 4) {
    cfg.rateLimitConfig = {
      libretranslate: { capacity: 3, rate: 4 },
      openai: { capacity: 10, rate: 20 },
      default: { capacity: 5, rate: 8 }
    };
    cfg.preloadConfig = {
      margin: 200,
      threshold: 0.1
    };
    cfg.version = 4;
  }
  
  return cfg;
}

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenu();
});

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'zdf-translate-selection' && info.selectionText) {
    try {
      let segments = [];
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'getSelectionSegments'
        });
        segments = response?.segments || [];
      } catch (e) {
        // Silently ignore
      }

      await chrome.tabs.sendMessage(tab.id, {
        action: 'showTranslationPopup',
        originalText: info.selectionText,
        translatedText: null,
        error: null,
        originalSegments: segments
      });

      const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
      const config = zdfConfig || {};

      const textToTranslate = (Array.isArray(segments) && segments.length)
        ? segments.join('\n\n')
        : info.selectionText;

      const result = await handleTranslation({
        text: textToTranslate,
        targetLang: config.targetLang || 'zh-CN',
        sourceLang: config.sourceLang || 'auto',
        service: config.translationService || 'libretranslate'
      });

      let translatedSegments = result
        .split(/\n\s*\n+/)
        .map(s => s.trim())
        .filter(Boolean);
      if (translatedSegments.length <= 1) {
        translatedSegments = result.split(/\n+/).map(s => s.trim()).filter(Boolean);
      }

      await chrome.tabs.sendMessage(tab.id, {
        action: 'showTranslationPopup',
        originalText: info.selectionText,
        translatedText: result,
        error: null,
        originalSegments: segments,
        translatedSegments: translatedSegments
      });
    } catch (error) {
      console.error('[ZDFTranslate] Translation failed:', error);
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'showTranslationPopup',
          originalText: info.selectionText,
          translatedText: null,
          error: error.message || 'Translation failed'
        });
      } catch (e) {
        console.error('[ZDFTranslate] Could not show error popup:', e);
      }
    }
  }
});

// 消息监听
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    handleTranslation(request)
      .then(result => sendResponse({ translatedText: result }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
  
  if (request.action === 'getConfig') {
    chrome.storage.sync.get(['zdfConfig'], (result) => {
      const config = result.zdfConfig || getDefaultConfig();
      // 确保配置是最新的
      if (typeof migrateConfig === 'function' && config.version !== CONFIG_VERSION) {
        const migrated = migrateConfig(config);
        sendResponse(migrated);
        // 异步更新存储
        chrome.storage.sync.set({ zdfConfig: migrated });
      } else {
        sendResponse(config);
      }
    });
    return true;
  }
  
  if (request.action === 'saveConfig') {
    // 验证配置
    if (typeof validateConfig === 'function') {
      const validation = validateConfig(request.config);
      if (!validation.valid) {
        sendResponse({ success: false, error: validation.errors.join(', ') });
        return true;
      }
    }
    
    chrome.storage.sync.set({ zdfConfig: request.config }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        // 更新限流配置
        if (request.config.rateLimitConfig && rateLimitManager) {
          Object.entries(request.config.rateLimitConfig).forEach(([service, config]) => {
            if (service !== 'default') {
              rateLimitManager.updateConfig(service, config.capacity, config.rate);
            }
          });
        }
        sendResponse({ success: true });
      }
    });
    return true;
  }
  
  if (request.action === 'exportConfig') {
    chrome.storage.sync.get(['zdfConfig'], (result) => {
      if (typeof exportConfig === 'function') {
        sendResponse({ data: exportConfig(result.zdfConfig) });
      } else {
        // 降级导出
        const data = {
          ...result.zdfConfig,
          exportedAt: new Date().toISOString(),
          extensionVersion: chrome.runtime.getManifest?.()?.version || 'unknown'
        };
        sendResponse({ data: JSON.stringify(data, null, 2) });
      }
    });
    return true;
  }
  
  if (request.action === 'importConfig') {
    if (typeof importConfig === 'function') {
      const result = importConfig(request.data);
      if (result.success) {
        chrome.storage.sync.set({ zdfConfig: result.config }, () => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse(result);
      }
    } else {
      // 降级导入
      try {
        const data = JSON.parse(request.data);
        delete data.exportedAt;
        delete data.extensionVersion;
        chrome.storage.sync.set({ zdfConfig: data }, () => {
          sendResponse({ success: true });
        });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    }
    return true;
  }
  
  if (request.action === 'getTabStatus') {
    const status = tabTranslationStatus.get(request.tabId) || false;
    sendResponse({ isTranslated: status });
    return true;
  }
  
  if (request.action === 'setTabStatus') {
    tabTranslationStatus.set(request.tabId, request.isTranslated);
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'getCurrentTabId') {
    if (sender.tab) {
      sendResponse({ tabId: sender.tab.id });
    } else {
      sendResponse({ tabId: null });
    }
    return true;
  }
  
  return true;
});

// 处理翻译请求
async function handleTranslation(request) {
  const { text, targetLang, sourceLang, service } = request;
  const cacheKey = `${text}_${targetLang}_${sourceLang}_${service}`;
  
  if (TRANSLATION_CACHE.has(cacheKey)) {
    return TRANSLATION_CACHE.get(cacheKey);
  }

  let result;
  
  switch (service) {
    case 'kimi':
      result = await translateWithKimi(text, targetLang, sourceLang);
      break;
    case 'aliyun':
    case 'aliyun-mt':
      result = await translateWithAliyun(text, targetLang, sourceLang);
      break;
    case 'zhipu':
      result = await translateWithZhipu(text, targetLang, sourceLang);
      break;
    case 'openai':
      result = await translateWithOpenAI(text, targetLang, sourceLang);
      break;
    case 'deepseek':
      result = await translateWithDeepSeek(text, targetLang, sourceLang);
      break;
    case 'google':
      result = await translateWithGoogle(text, targetLang, sourceLang);
      break;
    case 'deepl':
      result = await translateWithDeepL(text, targetLang, sourceLang);
      break;
    case 'openrouter':
      result = await translateWithOpenRouter(text, targetLang, sourceLang);
      break;
    default:
      if (service?.startsWith('custom_')) {
        result = await translateWithCustomService(service, text, targetLang, sourceLang);
      } else {
        result = await translateWithLibreTranslate(text, targetLang, sourceLang);
      }
  }

  // 缓存结果
  if (TRANSLATION_CACHE.size >= CACHE_MAX_SIZE) {
    const firstKey = TRANSLATION_CACHE.keys().next().value;
    TRANSLATION_CACHE.delete(firstKey);
  }
  TRANSLATION_CACHE.set(cacheKey, result);
  return result;
}

// ============ 各翻译服务实现 ============

async function translateWithKimi(text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.kimi;
  const model = zdfConfig?.selectedModels?.kimi || DEFAULT_MODELS.kimi;
  
  ensureApiKey(apiKey, 'Kimi');
  
  const langNames = {
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    'en': 'English',
    'ja': '日本語'
  };
  const targetLangName = langNames[targetLang] || targetLang;

  const response = await fetchWithRetry(
    'https://api.moonshot.cn/v1/chat/completions', 
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: `Translate to ${targetLangName}. Only return the translated text.` },
          { role: 'user', content: text }
        ],
        temperature: 0.3, 
        max_tokens: 2000
      })
    },
    'kimi'
  );
  
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

async function translateWithAliyun(text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.aliyun;
  const model = zdfConfig?.selectedModels?.aliyun || 'qwen-turbo';
  ensureApiKey(apiKey, 'Aliyun');
  
  const response = await fetchWithRetry(
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${apiKey}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: model,
        messages: [{ 
          role: 'user', 
          content: `Translate to ${targetLang}:\n${text}` 
        }]
      })
    },
    'aliyun'
  );
  
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || 'Translation failed';
}

async function translateWithZhipu(text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.zhipu;
  const model = zdfConfig?.selectedModels?.zhipu || 'glm-4-flash';
  ensureApiKey(apiKey, 'Zhipu');

  const response = await fetchWithRetry(
    'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${apiKey}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: model,
        messages: [{ 
          role: 'user', 
          content: `Translate this to ${targetLang}, only output result:\n${text}` 
        }]
      })
    },
    'zhipu'
  );
  
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim();
}

async function translateWithOpenAI(text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.openai;
  const model = zdfConfig?.selectedModels?.openai || 'gpt-3.5-turbo';
  ensureApiKey(apiKey, 'OpenAI');

  const response = await fetchWithRetry(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${apiKey}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: `Translate to ${targetLang}` },
          { role: 'user', content: text }
        ]
      })
    },
    'openai'
  );
  
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim();
}

async function translateWithDeepSeek(text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.deepseek;
  const model = zdfConfig?.selectedModels?.deepseek || 'deepseek-chat';
  ensureApiKey(apiKey, 'DeepSeek');

  const response = await fetchWithRetry(
    'https://api.deepseek.com/chat/completions',
    {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${apiKey}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: model,
        messages: [{ 
          role: 'user', 
          content: `Translate to ${targetLang}:\n${text}` 
        }]
      })
    },
    'deepseek'
  );
  
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim();
}

async function translateWithGoogle(text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.google;
  ensureApiKey(apiKey, 'Google');
  
  const response = await fetchWithRetry(
    `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        q: text, 
        target: targetLang, 
        format: 'text', 
        source: sourceLang 
      })
    },
    'google'
  );
  
  const data = await response.json();
  if (!data.data?.translations?.[0]?.translatedText) {
    throw new Error('Google API 返回格式错误');
  }
  return data.data.translations[0].translatedText;
}

async function translateWithDeepL(text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.deepl;
  ensureApiKey(apiKey, 'DeepL');

  const params = new URLSearchParams();
  params.set('text', text);
  params.set('target_lang', targetLang.toUpperCase());
  if (sourceLang && sourceLang !== 'auto') {
    params.set('source_lang', sourceLang.toUpperCase());
  }
  
  const response = await fetchWithRetry(
    'https://api-free.deepl.com/v2/translate',
    {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    },
    'deepl'
  );
  
  const data = await response.json();
  if (!data.translations?.[0]?.text) {
    throw new Error('DeepL API 返回格式错误');
  }
  return data.translations[0].text;
}

async function translateWithLibreTranslate(text, targetLang, sourceLang) {
  try {
    const target = targetLang === 'zh-CN' ? 'zh' : targetLang.split('-')[0];
    const response = await fetchWithRetry(
      'https://libretranslate.de/translate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          q: text, 
          source: sourceLang === 'auto' ? 'auto' : sourceLang.split('-')[0], 
          target: target 
        })
      },
      'libretranslate',
      1
    );
    const data = await response.json();
    return data.translatedText || text;
  } catch (error) {
    console.error('LibreTranslate 翻译失败:', error);
    throw new Error('LibreTranslate 翻译失败: ' + error.message);
  }
}

async function translateWithOpenRouter(text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.openrouter;
  const model = zdfConfig?.selectedModels?.openrouter || 'openai/gpt-4o-mini';
  
  ensureApiKey(apiKey, 'OpenRouter');
  
  const langNames = {
    'zh-CN': '简体中文', 'zh-TW': '繁體中文', 'en': 'English',
    'ja': '日本語', 'ko': '한국어', 'fr': 'Français',
    'de': 'Deutsch', 'es': 'Español', 'ru': 'Русский'
  };
  const targetLangName = langNames[targetLang] || targetLang;

  const response = await fetchWithRetry(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/zdf-translate',
        'X-Title': 'ZDFTranslate'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: `You are a professional translator. Translate the following text to ${targetLangName}. Only return the translated text, no explanations.`
          },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
        max_tokens: 2000
      })
    },
    'openrouter'
  );
  
  const data = await response.json();
  if (!data.choices?.[0]?.message?.content) {
    throw new Error('OpenRouter API 返回格式错误: ' + JSON.stringify(data));
  }
  return data.choices[0].message.content.trim();
}

async function translateWithCustomService(serviceId, text, targetLang, sourceLang) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const customService = zdfConfig?.customServices?.find(s => s.id === serviceId);
  
  if (!customService) {
    throw new Error(`自定义服务 ${serviceId} 未找到`);
  }
  
  if (!customService.apiKey) {
    throw new Error(`自定义服务 ${customService.name} 未配置 API Key`);
  }
  
  if (!customService.apiBaseUrl) {
    throw new Error(`自定义服务 ${customService.name} 未配置 API Base URL`);
  }
  
  const langNames = {
    'zh-CN': '简体中文', 'zh-TW': '繁體中文', 'en': 'English',
    'ja': '日本語', 'ko': '한국어', 'fr': 'Français',
    'de': 'Deutsch', 'es': 'Español', 'ru': 'Русский'
  };
  const targetLangName = langNames[targetLang] || targetLang;
  
  let baseUrl = customService.apiBaseUrl.trim();
  while (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }
  const model = customService.selectedModel || 'default';
  
  if (customService.mode === 'anthropic') {
    const response = await fetchWithRetry(
      `${baseUrl}/messages`,
      {
        method: 'POST',
        headers: {
          'x-api-key': customService.apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 2000,
          system: `You are a professional translator. Translate to ${targetLangName}. Only return the translated text.`,
          messages: [{ role: 'user', content: text }]
        })
      },
      'custom'
    );
    
    const data = await response.json();
    if (!data.content?.[0]?.text) {
      throw new Error('Anthropic API 返回格式错误: ' + JSON.stringify(data));
    }
    return data.content[0].text.trim();
  } else {
    const response = await fetchWithRetry(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${customService.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: `You are a professional translator. Translate to ${targetLangName}. Only return the translated text.`
            },
            { role: 'user', content: text }
          ],
          temperature: 0.3,
          max_tokens: 2000
        })
      },
      'custom'
    );
    
    const data = await response.json();
    if (!data.choices?.[0]?.message?.content) {
      throw new Error('OpenAI API 返回格式错误: ' + JSON.stringify(data));
    }
    return data.choices[0].message.content.trim();
  }
}
