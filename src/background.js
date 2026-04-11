// ZDFTranslate - Background Service Worker
// 处理翻译请求、API调用、跨域等问题
try {
  importScripts('providers.js');
} catch (error) {
  console.error('[ZDFTranslate] failed to load providers.js:', error);
}

const {
  DEFAULT_MODELS: providerDefaultModels,
  PROMPT_PRESETS: providerPromptPresets,
  isCustomService: providerIsCustomService,
  isLLMService: providerIsLLMService,
  resolveModelForService: providerResolveModelForService,
  resolveTargetLangName: providerResolveTargetLangName,
  buildTranslationMessages: providerBuildTranslationMessages,
  extractChatCompletionText: providerExtractChatCompletionText,
  extractAnthropicText: providerExtractAnthropicText,
} = self.ZDFProviders || {};

const DEFAULT_MODELS = providerDefaultModels || {
  openai: 'gpt-4o-mini',
  claude: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.0-flash',
  kimi: 'moonshot-v1-8k',
  zhipu: 'glm-4-flash',
  aliyun: 'qwen-turbo',
  deepseek: 'deepseek-chat',
  openrouter: 'openai/gpt-4o-mini',
};

function isCustomService(service) {
  if (typeof providerIsCustomService === 'function') return providerIsCustomService(service);
  return String(service || '').startsWith('custom_');
}

function isLLMService(service) {
  if (typeof providerIsLLMService === 'function') return providerIsLLMService(service);
  return ['kimi', 'aliyun', 'zhipu', 'openai', 'claude', 'gemini', 'deepseek', 'openrouter'].includes(service) || isCustomService(service);
}

function resolveTargetLangName(targetLang) {
  if (typeof providerResolveTargetLangName === 'function') return providerResolveTargetLangName(targetLang);
  const langNames = {
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    en: 'English',
    ja: '日本語',
    ko: '한국어',
    fr: 'Français',
    de: 'Deutsch',
    es: 'Español',
    ru: 'Русский',
  };
  return langNames[targetLang] || targetLang;
}

function resolveModelForService(config, service, modelOverride) {
  if (typeof providerResolveModelForService === 'function') {
    return providerResolveModelForService(config, service, modelOverride);
  }
  if (modelOverride) return modelOverride;
  if (isCustomService(service)) {
    const custom = config?.customServices?.find(s => s.id === service);
    return custom?.selectedModel || 'default';
  }
  return config?.selectedModels?.[service] || DEFAULT_MODELS[service] || '';
}

function buildTranslationMessages(targetLang, text, promptPreset) {
  if (typeof providerBuildTranslationMessages === 'function') {
    return providerBuildTranslationMessages(targetLang, text, promptPreset);
  }
  const targetLangName = resolveTargetLangName(targetLang);
  return {
    system: `You are a professional translator. Translate into ${targetLangName} accurately and naturally. Preserve numbers, names, entities, and paragraph boundaries. Return translation only. If input contains <TEXT>...</TEXT>, translate ONLY the content inside <TEXT> and ignore other context blocks.`,
    user: text,
  };
}

function extractChatCompletionText(data, serviceName) {
  const normalizeContent = (content) => {
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      const joined = content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object') {
            return part.text || part.content || part.output_text || '';
          }
          return '';
        })
        .join('')
        .trim();
      return joined;
    }
    if (content && typeof content === 'object') {
      return String(content.text || content.content || content.output_text || '').trim();
    }
    return '';
  };

  if (typeof providerExtractChatCompletionText === 'function') {
    try {
      const out = providerExtractChatCompletionText(data, serviceName);
      if (out && String(out).trim()) return String(out).trim();
    } catch (_) {
      // provider parser failed, fallback below
    }
  }

  const candidates = [
    data?.choices?.[0]?.message?.content,
    data?.choices?.[0]?.text,
    data?.output?.[0]?.content,
    data?.output_text,
  ];

  for (const c of candidates) {
    const text = normalizeContent(c);
    if (text) return text;
  }

  throw new Error(`${serviceName} API 返回格式错误`);
}

const TRANSLATION_CACHE = new Map();
const CACHE_MAX_SIZE = 1000;

// 标签页翻译状态跟踪
const tabTranslationStatus = new Map();

// 请求限流：记录每个服务的上次请求时间
const lastRequestTime = new Map();
const MIN_REQUEST_INTERVAL_BY_SERVICE = {
  default: 80,
  'google-free': 120,
  'microsoft-free': 120,
  aliyun: 1200,
  kimi: 60,
  zhipu: 60,
  deepseek: 60,
  openai: 60,
  claude: 60,
  gemini: 60,
  openrouter: 60,
  deepl: 100,
  custom: 60
};

const REQUEST_TIMEOUT_BY_SERVICE = {
  default: 15000,
  'google-free': 15000,
  'microsoft-free': 15000,
  deepl: 20000,
  aliyun: 45000,
  kimi: 45000,
  zhipu: 45000,
  deepseek: 45000,
  openai: 45000,
  claude: 45000,
  gemini: 45000,
  openrouter: 45000,
  custom: 45000
};

// 翻译队列（P0）：同配置请求短时间聚合为一次批处理调用
const translationBatchQueues = new Map();
const BATCH_DELAY_MS = 60;
const MAX_BATCH_ITEMS = 6;
const BATCH_SEPARATOR = '\n\n---ZDF_BATCH_BREAK---\n\n';
const PROMPT_VERSION = 'v6-p0';

self.addEventListener('unhandledrejection', (event) => {
  console.error('[ZDFTranslate] unhandledrejection:', event?.reason || event);
});

self.addEventListener('error', (event) => {
  console.error('[ZDFTranslate] worker error:', event?.message || event);
});

// 通用请求包装器：支持限流和重试
async function fetchWithRetry(url, options, serviceName, maxRetries = 2) {
  // 限流：确保同一服务请求间隔
  const now = Date.now();
  const lastTime = lastRequestTime.get(serviceName) || 0;
  const minInterval = MIN_REQUEST_INTERVAL_BY_SERVICE[serviceName] || MIN_REQUEST_INTERVAL_BY_SERVICE.default;
  const waitTime = minInterval - (now - lastTime);
  if (waitTime > 0) {
    await sleep(waitTime);
  }
  lastRequestTime.set(serviceName, Date.now());

  const timeoutMs = REQUEST_TIMEOUT_BY_SERVICE[serviceName] || REQUEST_TIMEOUT_BY_SERVICE.default;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const fetchOptions = { ...options, signal: controller.signal };
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      
      // 429 限流：指数退避重试（优先尊重 Retry-After）
      if (response.status === 429 && attempt < maxRetries - 1) {
        const retryAfterHeader = response.headers?.get?.('retry-after');
        let retryAfterMs = 0;
        if (retryAfterHeader) {
          const sec = Number(retryAfterHeader);
          if (!Number.isNaN(sec) && sec > 0) {
            retryAfterMs = sec * 1000;
          }
        }
        const baseDelay = Math.pow(2, attempt) * 1200 + Math.random() * 400;
        const delay = Math.max(retryAfterMs, baseDelay);
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureApiKey(key, serviceName) {
  if (!key || !String(key).trim()) {
    throw new Error(`${serviceName} API key not configured`);
  }
}

async function fetchRemoteModelsForService(service, apiKey) {
  const key = (apiKey || '').trim();
  if (!key) return [];

  const mapToModels = (arr) => (arr || []).map(m => ({ id: m.id, name: m.name || m.id }));

  const fetchers = {
    openai: async () => {
      const resp = await fetchWithRetry('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } }, 'openai');
      const data = await resp.json();
      return mapToModels((data.data || []).filter(m => m.id && m.id.includes('gpt')));
    },
    claude: async () => {
      // Anthropic doesn't have a models list API, return commonly used models
      return [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
        { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
        { id: 'claude-haiku-4-20250514', name: 'Claude Haiku 4' },
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
      ];
    },
    gemini: async () => {
      const resp = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, { method: 'GET' }, 'gemini');
      const data = await resp.json();
      return (data.models || [])
        .filter(m => m.name && m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => ({ id: m.name.replace('models/', ''), name: m.displayName || m.name.replace('models/', '') }));
    },
    openrouter: async () => {
      const resp = await fetchWithRetry('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${key}` } }, 'openrouter');
      const data = await resp.json();
      return mapToModels(data.data || []);
    },
    kimi: async () => {
      const resp = await fetchWithRetry('https://api.moonshot.cn/v1/models', { headers: { Authorization: `Bearer ${key}` } }, 'kimi');
      const data = await resp.json();
      return mapToModels(data.data || []);
    },
    deepseek: async () => {
      const resp = await fetchWithRetry('https://api.deepseek.com/models', { headers: { Authorization: `Bearer ${key}` } }, 'deepseek');
      const data = await resp.json();
      return mapToModels(data.data || []);
    },
    aliyun: async () => {
      const resp = await fetchWithRetry('https://dashscope.aliyuncs.com/compatible-mode/v1/models', { headers: { Authorization: `Bearer ${key}` } }, 'aliyun');
      const data = await resp.json();
      return mapToModels((data.data || []).filter(m => m.id));
    },
    zhipu: async () => {
      const resp = await fetchWithRetry('https://open.bigmodel.cn/api/paas/v4/models', { headers: { Authorization: `Bearer ${key}` } }, 'zhipu');
      const data = await resp.json();
      return mapToModels(data.data || []);
    },
  };

  const fn = fetchers[service];
  if (!fn) return [];
  return await fn();
}

function resolveTemperatureForService(serviceName, model, requested = 0.3) {
  // Kimi 部分模型仅接受 temperature=1
  if (serviceName === 'kimi') return 1;
  return requested;
}

async function callOpenAICompatibleTranslate({
  serviceName,
  url,
  apiKey,
  model,
  targetLang,
  text,
  headers = {},
  maxRetries = 2,
  maxTokens,
  temperature = 0.3,
  promptPreset,
}) {
  ensureApiKey(apiKey, serviceName);
  const { system, user } = buildTranslationMessages(targetLang, text, promptPreset);

  const finalTemperature = resolveTemperatureForService(serviceName, model, temperature);

  const baseBody = {
    model,
    temperature: finalTemperature,
    ...(typeof maxTokens === 'number' ? { max_tokens: maxTokens } : {}),
  };

  const requestHeaders = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...headers,
  };

  const requestWithMessages = async (messages) => {
    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ ...baseBody, messages }),
      },
      serviceName,
      maxRetries,
    );
    const data = await response.json();
    return extractChatCompletionText(data, serviceName);
  };

  try {
    return await requestWithMessages([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
  } catch (error) {
    const msg = String(error?.message || '');
    const roleRelated =
      /role/i.test(msg) &&
      (msg.includes('[user, assistant]') || msg.includes('system') || msg.includes('unsupported_value'));

    if (!roleRelated) throw error;

    // 兼容部分服务/模型：不支持 system 角色时，自动回退为纯 user 提示词
    const mergedUserPrompt = `${system}\n\n${user}`;
    return await requestWithMessages([
      { role: 'user', content: mergedUserPrompt },
    ]);
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

function getDefaultConfig() {
  return {
    enabled: true,
    targetLang: 'zh-CN',
    sourceLang: 'auto',
    displayMode: 'bilingual',
    translationService: 'microsoft-free',
    enableAIContentAware: false,
    promptPreset: 'general',
    deeplPlan: 'free',
    selectedModels: { ...DEFAULT_MODELS },
    apiKeys: {},
    customServices: [],
    excludedSites: [],
    style: {
      translationColor: '#111111',
      translationSize: '0.95em',
      lineSpacing: '1.6',
      backgroundHighlight: false
    }
  };
}

// 安装时初始化（加固：避免异步异常导致 SW 无效）
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
      chrome.storage.sync.get(['zdfConfig'], (res) => {
        try {
          const cfg = res?.zdfConfig || {};
          let needsUpdate = false;

          if (!cfg.targetLang || cfg.targetLang === 'en') {
            cfg.targetLang = 'zh-CN';
            needsUpdate = true;
          }

          if (!cfg.translationService || cfg.translationService === 'libretranslate' || cfg.translationService === 'google') {
            cfg.translationService = 'microsoft-free';
            needsUpdate = true;
          }

          if (!cfg.selectedModels) {
            cfg.selectedModels = { ...DEFAULT_MODELS };
            needsUpdate = true;
          }

          // Migrate: remove obsolete config keys
          if ('showFloatingImageExportButton' in cfg) {
            delete cfg.showFloatingImageExportButton;
            needsUpdate = true;
          }
          if ('showFloatingPdfExportButton' in cfg) {
            delete cfg.showFloatingPdfExportButton;
            needsUpdate = true;
          }
          if ('autoTranslateYouTube' in cfg) {
            delete cfg.autoTranslateYouTube;
            needsUpdate = true;
          }
          if ('autoEnableYouTubeCC' in cfg) {
            delete cfg.autoEnableYouTubeCC;
            needsUpdate = true;
          }
          if (cfg.style && 'showWatermark' in cfg.style) {
            delete cfg.style.showWatermark;
            needsUpdate = true;
          }
          if (cfg.apiKeys && 'google' in cfg.apiKeys) {
            delete cfg.apiKeys.google;
            needsUpdate = true;
          }

          if (!cfg.promptPreset) {
            cfg.promptPreset = 'general';
            needsUpdate = true;
          }
          if (!cfg.deeplPlan) {
            cfg.deeplPlan = 'free';
            needsUpdate = true;
          }

          if (typeof cfg.enableAIContentAware !== 'boolean') {
            cfg.enableAIContentAware = false;
            needsUpdate = true;
          }

          if (needsUpdate) {
            chrome.storage.sync.set({ zdfConfig: cfg }, () => {
              if (chrome.runtime.lastError) {
                console.warn('[ZDFTranslate] migrate config failed:', chrome.runtime.lastError.message);
              }
            });
          }
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

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenu();
});

// FIX: Handle context menu clicks (was missing!)
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'zdf-translate-selection' && info.selectionText) {
    try {
      // Get selection segments from content script
      let segments = [];
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'getSelectionSegments'
        });
        segments = response?.segments || [];
      } catch (e) {
        // Silently ignore - optional feature
      }

      // Show loading popup first
      await chrome.tabs.sendMessage(tab.id, {
        action: 'showTranslationPopup',
        originalText: info.selectionText,
        translatedText: null,
        error: null,
        originalSegments: segments
      });

      // Get current config
      const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
      const config = zdfConfig || {};

      // Translate (v1.5.6: 严格按结构分段，block 之间用双换行)
      const textToTranslate = (Array.isArray(segments) && segments.length)
        ? segments.join('\n\n')
        : info.selectionText;

      const selectedService = config.translationService || 'microsoft-free';
      const result = await handleTranslation({
        text: textToTranslate,
        targetLang: config.targetLang || 'zh-CN',
        sourceLang: config.sourceLang || 'auto',
        service: selectedService,
        model: config?.selectedModels?.[selectedService] || '',
        enableAIContentAware: !!config.enableAIContentAware,
        articleTitle: tab?.title || '',
        articleSummary: '',
        promptVersion: 'v6-p1'
      });

      // 优先按双换行切分（结构边界），回退到单换行
      let translatedSegments = result
        .split(/\n\s*\n+/)
        .map(s => s.trim())
        .filter(Boolean);
      if (translatedSegments.length <= 1) {
        translatedSegments = result.split(/\n+/).map(s => s.trim()).filter(Boolean);
      }

      // Show result
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

// Kimi API - 优化请求头
async function translateWithKimi(text, targetLang, sourceLang, modelOverride) {
  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const apiKey = zdfConfig?.apiKeys?.kimi;
  const model = resolveModelForService(zdfConfig, 'kimi', modelOverride);

  ensureApiKey(apiKey, 'kimi');

  // Kimi 某些模型对 system / temperature 参数更严格，合并为 user 消息
  const { system, user } = buildTranslationMessages(targetLang, text, zdfConfig?.promptPreset);
  const response = await fetchWithRetry(
    'https://api.moonshot.cn/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: `${system}\n\n${user}` }],
        temperature: 1,
      }),
    },
    'kimi',
    2,
  );

  const data = await response.json();
  return extractChatCompletionText(data, 'kimi');
}

// 为了完整性，这里包含核心的消息监听和处理逻辑
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    enqueueTranslationRequest(request)
      .then(result => sendResponse({ translatedText: result }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
  
  if (request.action === 'getConfig') {
      chrome.storage.sync.get(['zdfConfig'], (result) => sendResponse(result.zdfConfig));
      return true;
  }
  
  if (request.action === 'saveConfig') {
      chrome.storage.sync.set({ zdfConfig: request.config }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true });
        }
      });
      return true;
  }
  
  if (request.action === 'getModels') {
      (async () => {
        try {
          const models = await fetchRemoteModelsForService(request.service, request.apiKey);
          sendResponse({ models });
        } catch (error) {
          sendResponse({ models: [], error: error?.message || '获取模型失败' });
        }
      })();
      return true;
  }
  
  // FIX: Add missing message handlers for tab status tracking
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

function buildTranslationCacheKey(request) {
  const { text, targetLang, sourceLang, service } = request;
  const model = request.model || '';
  const promptVersion = request.promptVersion || PROMPT_VERSION;
  const articleTitle = request.articleTitle || '';
  const articleSummary = request.articleSummary || '';
  const awareTag = request.enableAIContentAware ? 'aware:1' : 'aware:0';
  return `${service || 'microsoft-free'}|${model}|${sourceLang || 'auto'}|${targetLang || 'zh-CN'}|${promptVersion}|${awareTag}|${articleTitle}|${articleSummary}|${text}`;
}

function setTranslationCache(key, value) {
  if (TRANSLATION_CACHE.size >= CACHE_MAX_SIZE) {
    const firstKey = TRANSLATION_CACHE.keys().next().value;
    TRANSLATION_CACHE.delete(firstKey);
  }
  TRANSLATION_CACHE.set(key, value);
}

function buildContextAwareText(request) {
  const { text, service, enableAIContentAware, articleTitle, articleSummary } = request;
  // Kimi / Aliyun 走稳态路径：关闭上下文拼接，避免每段都携带长上下文导致限流或明显变慢
  if (service === 'kimi' || service === 'aliyun') {
    return text;
  }
  if (!enableAIContentAware || !isLLMService(service)) {
    return text;
  }
  const title = (articleTitle || '').trim();
  const summary = (articleSummary || '').trim();
  if (!title && !summary) {
    return text;
  }
  return [
    '<CONTEXT>',
    title ? `Title: ${title}` : '',
    summary ? `Summary: ${summary}` : '',
    '</CONTEXT>',
    '<TEXT>',
    text,
    '</TEXT>',
  ].filter(Boolean).join('\n');
}

const TRANSLATION_HANDLER_MAP = {
  'microsoft-free': translateWithMicrosoftFree,
  'google-free': translateWithGoogleFree,
  kimi: translateWithKimi,
  aliyun: translateWithAliyun,
  zhipu: translateWithZhipu,
  openai: translateWithOpenAI,
  claude: translateWithClaude,
  gemini: translateWithGemini,
  deepseek: translateWithDeepSeek,
  deepl: translateWithDeepL,
  openrouter: translateWithOpenRouter,
};

async function dispatchSingleTranslation(request) {
  const { targetLang, sourceLang, service } = request;
  const text = buildContextAwareText(request);

  if (isCustomService(service)) {
    return await translateWithCustomService(service, text, targetLang, sourceLang);
  }

  const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
  const resolvedModel = resolveModelForService(zdfConfig, service, request.model);
  const handler = TRANSLATION_HANDLER_MAP[service] || translateWithMicrosoftFree;
  return await handler(text, targetLang, sourceLang, resolvedModel);
}

async function handleTranslation(request) {
  const cacheKey = buildTranslationCacheKey(request);
  if (TRANSLATION_CACHE.has(cacheKey)) {
    return TRANSLATION_CACHE.get(cacheKey);
  }
  const result = await dispatchSingleTranslation(request);
  setTranslationCache(cacheKey, result);
  return result;
}

function getBatchGroupKey(request) {
  const { targetLang, sourceLang, service } = request;
  const model = request.model || '';
  const promptVersion = request.promptVersion || PROMPT_VERSION;
  const awareTag = request.enableAIContentAware ? 'aware:1' : 'aware:0';
  return `${service || 'microsoft-free'}|${sourceLang || 'auto'}|${targetLang || 'zh-CN'}|${model}|${promptVersion}|${awareTag}`;
}

function flushTranslationBatch(groupKey) {
  const queue = translationBatchQueues.get(groupKey);
  if (!queue || !queue.items.length) {
    translationBatchQueues.delete(groupKey);
    return;
  }

  const items = queue.items.splice(0, queue.items.length);
  translationBatchQueues.delete(groupKey);

  (async () => {
    if (items.length === 1) {
      const item = items[0];
      try {
        const result = await handleTranslation(item.request);
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }
      return;
    }

    const combinedText = items.map(i => i.request.text).join(BATCH_SEPARATOR);
    const first = items[0].request;
    const batchRequest = { ...first, text: combinedText };

    try {
      const combinedResult = await dispatchSingleTranslation(batchRequest);
      const parts = String(combinedResult || '').split(BATCH_SEPARATOR);
      if (parts.length === items.length) {
        items.forEach((item, idx) => {
          const text = (parts[idx] ?? '').trim();
          const cacheKey = buildTranslationCacheKey(item.request);
          setTranslationCache(cacheKey, text);
          item.resolve(text);
        });
        return;
      }
      throw new Error(`批量返回段落数不匹配: expected ${items.length}, got ${parts.length}`);
    } catch (batchError) {
      // 批处理失败时自动回退逐条翻译
      for (const item of items) {
        try {
          const result = await handleTranslation(item.request);
          item.resolve(result);
        } catch (error) {
          item.reject(error);
        }
      }
    }
  })().catch((error) => {
    items.forEach(item => item.reject(error));
  });
}

function enqueueTranslationRequest(request) {
  const cacheKey = buildTranslationCacheKey(request);
  if (TRANSLATION_CACHE.has(cacheKey)) {
    return Promise.resolve(TRANSLATION_CACHE.get(cacheKey));
  }

  const service = request?.service || 'microsoft-free';
  const isFastPath = !['microsoft-free', 'google-free'].includes(service);
  if (isFastPath) {
    // API/LLM 服务不做后台聚合，避免分隔符污染与“前几段后就卡住”
    return handleTranslation(request);
  }

  const groupKey = getBatchGroupKey(request);
  let queue = translationBatchQueues.get(groupKey);
  if (!queue) {
    queue = { items: [], timer: null };
    translationBatchQueues.set(groupKey, queue);
  }

  return new Promise((resolve, reject) => {
    queue.items.push({ request, resolve, reject });

    if (queue.items.length >= MAX_BATCH_ITEMS) {
      if (queue.timer) clearTimeout(queue.timer);
      queue.timer = null;
      flushTranslationBatch(groupKey);
      return;
    }

    if (!queue.timer) {
      queue.timer = setTimeout(() => {
        queue.timer = null;
        flushTranslationBatch(groupKey);
      }, BATCH_DELAY_MS);
    }
  });
}

async function translateWithAliyun(text, targetLang, sourceLang, modelOverride) {
    const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
    const apiKey = zdfConfig?.apiKeys?.aliyun;
    const model = resolveModelForService(zdfConfig, 'aliyun', modelOverride);

    ensureApiKey(apiKey, 'aliyun');

    // 某些阿里云模型不接受 system 角色（报错: Role must be in [user, assistant]），合并为 user 消息
    const { system, user } = buildTranslationMessages(targetLang, text, zdfConfig?.promptPreset);
    const response = await fetchWithRetry(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: `${system}\n\n${user}` }],
          temperature: 0.3,
        }),
      },
      'aliyun',
      4,
    );

    const data = await response.json();
    return extractChatCompletionText(data, 'aliyun');
}

async function translateWithZhipu(text, targetLang, sourceLang, modelOverride) {
    const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
    const apiKey = zdfConfig?.apiKeys?.zhipu;
    const model = resolveModelForService(zdfConfig, 'zhipu', modelOverride);

    return await callOpenAICompatibleTranslate({
      serviceName: 'zhipu',
      url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      apiKey,
      model,
      targetLang,
      text,
      promptPreset: zdfConfig?.promptPreset,
    });
}

async function translateWithOpenAI(text, targetLang, sourceLang, modelOverride) {
    const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
    const apiKey = zdfConfig?.apiKeys?.openai;
    const model = resolveModelForService(zdfConfig, 'openai', modelOverride);

    return await callOpenAICompatibleTranslate({
      serviceName: 'openai',
      url: 'https://api.openai.com/v1/chat/completions',
      apiKey,
      model,
      targetLang,
      text,
      promptPreset: zdfConfig?.promptPreset,
    });
}

async function translateWithDeepSeek(text, targetLang, sourceLang, modelOverride) {
    const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
    const apiKey = zdfConfig?.apiKeys?.deepseek;
    const model = resolveModelForService(zdfConfig, 'deepseek', modelOverride);

    return await callOpenAICompatibleTranslate({
      serviceName: 'deepseek',
      url: 'https://api.deepseek.com/chat/completions',
      apiKey,
      model,
      targetLang,
      text,
      promptPreset: zdfConfig?.promptPreset,
    });
}

async function translateWithGoogleFree(text, targetLang, sourceLang) {
  const sl = sourceLang && sourceLang !== 'auto' ? sourceLang : 'auto';
  const tl = targetLang || 'zh-CN';
  const params = new URLSearchParams({
    client: 'gtx',
    sl,
    tl,
    dt: 't',
    q: text,
  });

  const response = await fetchWithRetry(
    `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
    { method: 'GET' },
    'google-free',
  );

  const data = await response.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('Google 免费翻译返回格式错误');
  }

  return data[0]
    .filter(Array.isArray)
    .map(chunk => chunk[0])
    .filter(Boolean)
    .join('');
}

async function translateWithMicrosoftFree(text, targetLang, sourceLang) {
  const tokenResp = await fetchWithRetry(
    'https://edge.microsoft.com/translate/auth',
    { method: 'GET' },
    'microsoft-free',
  );
  const token = (await tokenResp.text()).trim();
  if (!token) throw new Error('Microsoft 免费翻译 token 获取失败');

  const from = sourceLang && sourceLang !== 'auto' ? sourceLang : '';
  const to = targetLang || 'zh-CN';

  const response = await fetchWithRetry(
    `https://api-edge.cognitive.microsofttranslator.com/translate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&api-version=3.0&includeSentenceLength=true&textType=html`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': token,
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify([{ Text: text }]),
    },
    'microsoft-free',
  );

  const data = await response.json();
  if (!Array.isArray(data) || !data[0]?.translations?.[0]?.text) {
    throw new Error('Microsoft 免费翻译返回格式错误');
  }
  return data[0].translations[0].text;
}

async function translateWithDeepL(text, targetLang, sourceLang) {
    const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
    const apiKey = zdfConfig?.apiKeys?.deepl;
    const plan = zdfConfig?.deeplPlan || 'free';
    
    ensureApiKey(apiKey, 'DeepL');

    const params = new URLSearchParams();
    params.set('text', text);
    params.set('target_lang', targetLang.toUpperCase());
    if (sourceLang && sourceLang !== 'auto') {
      params.set('source_lang', sourceLang.toUpperCase());
    }
    
    const baseUrl = plan === 'pro'
      ? 'https://api.deepl.com/v2/translate'
      : 'https://api-free.deepl.com/v2/translate';
    
    const response = await fetchWithRetry(
        baseUrl,
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

// Gemini 翻译 (Google AI)
async function translateWithGemini(text, targetLang, sourceLang, modelOverride) {
    const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
    const apiKey = zdfConfig?.apiKeys?.gemini;
    const model = resolveModelForService(zdfConfig, 'gemini', modelOverride);

    ensureApiKey(apiKey, 'Gemini');

    const { system, user } = buildTranslationMessages(targetLang, text, zdfConfig?.promptPreset);

    const response = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: system }] },
                contents: [{ parts: [{ text: user }] }],
                generationConfig: { temperature: 0.3 },
            }),
        },
        'gemini',
        2,
    );

    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content || !content.trim()) {
        throw new Error('Gemini API 返回格式错误');
    }
    return content.trim();
}

// Claude (Anthropic) 翻译
async function translateWithClaude(text, targetLang, sourceLang, modelOverride) {
    const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
    const apiKey = zdfConfig?.apiKeys?.claude;
    const model = resolveModelForService(zdfConfig, 'claude', modelOverride);

    ensureApiKey(apiKey, 'Claude');

    const { system, user } = buildTranslationMessages(targetLang, text, zdfConfig?.promptPreset);

    const response = await fetchWithRetry(
        'https://api.anthropic.com/v1/messages',
        {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model,
                max_tokens: 4096,
                system,
                messages: [{ role: 'user', content: user }],
            }),
        },
        'claude',
        2,
    );

    const data = await response.json();
    if (typeof providerExtractAnthropicText === 'function') {
        return providerExtractAnthropicText(data, 'Claude');
    }
    const blocks = data?.content;
    if (!Array.isArray(blocks) || blocks.length === 0) {
        throw new Error('Claude API 返回格式错误');
    }
    return blocks.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

// OpenRouter 翻译
async function translateWithOpenRouter(text, targetLang, sourceLang, modelOverride) {
    const { zdfConfig } = await chrome.storage.sync.get(['zdfConfig']);
    const apiKey = zdfConfig?.apiKeys?.openrouter;
    const model = resolveModelForService(zdfConfig, 'openrouter', modelOverride);

    try {
        return await callOpenAICompatibleTranslate({
          serviceName: 'openrouter',
          url: 'https://openrouter.ai/api/v1/chat/completions',
          apiKey,
          model,
          targetLang,
          text,
          maxTokens: 2000,
          promptPreset: zdfConfig?.promptPreset,
          headers: {
            'HTTP-Referer': 'https://github.com/zdf-translate',
            'X-Title': 'ZDFTranslate',
          },
        });
    } catch (error) {
        // 处理 OpenRouter 特定的错误
        if (error.message?.includes('404') && error.message?.includes('data policy')) {
            throw new Error('OpenRouter 隐私设置错误：当前模型需要调整数据使用策略。\n\n解决方法：\n1. 访问 https://openrouter.ai/settings/privacy\n2. 开启 "Allow my prompts to be used for training" 或选择允许免费模型使用的选项\n3. 或者更换为不需要数据共享的模型（如 openai/gpt-4o-mini）');
        }
        if (error.message?.includes('404') && error.message?.includes('No endpoints found')) {
            throw new Error('OpenRouter 错误：找不到可用的模型端点。\n\n可能原因：\n1. 所选模型暂时不可用\n2. 账户余额不足\n3. 模型需要特定权限\n\n建议：尝试更换其他模型，或检查 OpenRouter 账户余额。');
        }
        throw error;
    }
}

// 自定义服务翻译
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
    
    // 规范化 URL：去除首尾空格，去除尾部斜杠
    let baseUrl = customService.apiBaseUrl.trim();
    while (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    const model = customService.selectedModel || 'default';
    
    if (customService.mode === 'anthropic') {
        // Anthropic 兼容模式
        const { system, user } = buildTranslationMessages(targetLang, text, zdfConfig?.promptPreset);
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
                    system,
                    messages: [{ role: 'user', content: user }]
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
        // OpenAI 兼容模式 (默认)
        return await callOpenAICompatibleTranslate({
          serviceName: 'custom',
          url: `${baseUrl}/chat/completions`,
          apiKey: customService.apiKey,
          model,
          targetLang,
          text,
          maxTokens: 2000,
          promptPreset: zdfConfig?.promptPreset,
        });
    }
}
