// ZDFTranslate - Background Service Worker (inlined single file)

// ========================================
// 1. providers.js - Provider Registry
// ========================================
(function initProviders(global) {
  const DEFAULT_MODELS = {
    openai: 'gpt-4o-mini',
    claude: 'claude-sonnet-4-20250514',
    gemini: 'gemini-2.0-flash',
    kimi: 'moonshot-v1-8k',
    zhipu: 'glm-4-flash',
    aliyun: 'qwen-turbo',
    deepseek: 'deepseek-chat',
    openrouter: 'openai/gpt-4o-mini',
  };

  const PROVIDER_META = {
    'microsoft-free': { kind: 'free', label: 'Microsoft Translator (Free)' },
    'google-free': { kind: 'free', label: 'Google Translate (Free)' },
    aliyun: { kind: 'llm', defaultModel: DEFAULT_MODELS.aliyun, label: '阿里百炼 (Qwen)' },
    deepl: { kind: 'api', label: 'DeepL' },
    gemini: { kind: 'llm', defaultModel: DEFAULT_MODELS.gemini, label: 'Google Gemini' },
    openrouter: { kind: 'llm', defaultModel: DEFAULT_MODELS.openrouter, label: 'OpenRouter' },
    deepseek: { kind: 'llm', defaultModel: DEFAULT_MODELS.deepseek, label: 'DeepSeek' },
    zhipu: { kind: 'llm', defaultModel: DEFAULT_MODELS.zhipu, label: '智谱 GLM' },
    kimi: { kind: 'llm', defaultModel: DEFAULT_MODELS.kimi, label: 'Kimi (Moonshot)' },
    openai: { kind: 'llm', defaultModel: DEFAULT_MODELS.openai, label: 'OpenAI' },
    claude: { kind: 'llm', defaultModel: DEFAULT_MODELS.claude, label: 'Claude (Anthropic)' },
  };

  const PROMPT_PRESETS = {
    general: {
      label: '通用翻译',
      system: 'You are a professional translator. Translate into {targetLang} accurately and naturally. Preserve numbers, names, entities, and paragraph boundaries. Return translation only.',
    },
    news: {
      label: '新闻媒体',
      system: 'You are a professional news translator. Translate into {targetLang} with journalistic accuracy. Maintain the tone and urgency of the original reporting. Keep proper nouns, place names, and organization names in their commonly known forms. Preserve paragraph structure. Return translation only.',
    },
    academic: {
      label: '学术论文',
      system: 'You are an academic translator. Translate into {targetLang} with scholarly precision. Preserve technical terminology, citation references, and formal academic tone. Keep abbreviations and acronyms unchanged. Maintain paragraph and section structure. Return translation only.',
    },
    technical: {
      label: '技术文档',
      system: 'You are a technical documentation translator. Translate into {targetLang} accurately. Keep code snippets, variable names, API names, and technical terms unchanged. Preserve formatting markers and list structures. Return translation only.',
    },
    literary: {
      label: '文学作品',
      system: 'You are a literary translator. Translate into {targetLang} with attention to style, rhythm, and literary devices. Convey the emotional tone and atmosphere of the original. Adapt cultural references when necessary for readability. Preserve paragraph structure. Return translation only.',
    },
    social: {
      label: '社交媒体',
      system: 'You are a social media translator. Translate into {targetLang} in a casual, natural tone. Keep hashtags, mentions, and emojis unchanged. Adapt internet slang and cultural references appropriately. Return translation only.',
    },
  };

  const LANG_NAME_MAP = {
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    en: 'English',
    ja: '日本語',
    ko: '한국어',
    fr: 'Français',
    de: 'Deutsch',
    es: 'Español',
    ru: 'Русский',
    pt: 'Português',
    ar: 'العربية',
    th: 'ไทย',
    vi: 'Tiếng Việt',
  };

  function isCustomService(service) {
    return String(service || '').startsWith('custom_');
  }

  function isLLMService(service) {
    if (isCustomService(service)) return true;
    return PROVIDER_META[service]?.kind === 'llm';
  }

  function resolveModelForService(config, service, modelOverride) {
    if (modelOverride) return modelOverride;
    if (isCustomService(service)) {
      const custom = config?.customServices?.find(s => s.id === service);
      return custom?.selectedModel || 'default';
    }
    const selected = config?.selectedModels?.[service];
    if (selected) return selected;
    return PROVIDER_META[service]?.defaultModel || '';
  }

  function resolveTargetLangName(targetLang) {
    return LANG_NAME_MAP[targetLang] || targetLang;
  }

  function buildTranslationMessages(targetLang, text, promptPreset) {
    const targetLangName = resolveTargetLangName(targetLang);
    const preset = PROMPT_PRESETS[promptPreset] || PROMPT_PRESETS.general;
    const system = preset.system.replace(/\{targetLang\}/g, targetLangName);
    return {
      system: system + ' If input contains <TEXT>...</TEXT>, translate ONLY the content inside <TEXT> and ignore other context blocks.',
      user: text,
    };
  }

  function extractChatCompletionText(data, serviceName) {
    const content = data?.choices?.[0]?.message?.content;
    if (!content || !String(content).trim()) {
      throw new Error(serviceName + ' API 返回格式错误');
    }
    return String(content).trim();
  }

  function extractAnthropicText(data, serviceName) {
    const blocks = data?.content;
    if (!Array.isArray(blocks) || blocks.length === 0) {
      throw new Error(serviceName + ' API 返回格式错误');
    }
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
    if (!text.trim()) {
      throw new Error(serviceName + ' API 返回为空');
    }
    return text.trim();
  }

  global.ZDFProviders = {
    DEFAULT_MODELS,
    PROVIDER_META,
    PROMPT_PRESETS,
    LANG_NAME_MAP,
    isCustomService,
    isLLMService,
    resolveModelForService,
    resolveTargetLangName,
    buildTranslationMessages,
    extractChatCompletionText,
    extractAnthropicText,
  };
})(self);

// ========================================
// 2. constants.js - Shared constants
// ========================================
self.ZDF_CONSTANTS = {
  PROMPT_VERSION: 'v6-p1',
  BATCH_SEPARATOR: '\n\n\uE000\uE001\uE002\n\n',
  PARA_BREAK: '\n\n\uE000\uE001\uE003\n\n',
};

// ========================================
// 3. background/utils.js - Utilities
// ========================================
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

const LAST_REQUEST_TIME_KEY = 'lastRequestTime';
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

self.addEventListener('unhandledrejection', (event) => {
  console.error('[ZDFTranslate] unhandledrejection:', event?.reason || event);
});

self.addEventListener('error', (event) => {
  console.error('[ZDFTranslate] worker error:', event?.message || event);
});

async function fetchWithRetry(url, options, serviceName, maxRetries = 2) {
  const now = Date.now();
  const minInterval = MIN_REQUEST_INTERVAL_BY_SERVICE[serviceName] || MIN_REQUEST_INTERVAL_BY_SERVICE.default;

  try {
    const result = await chrome.storage.session.get([LAST_REQUEST_TIME_KEY]);
    const times = result?.[LAST_REQUEST_TIME_KEY] || {};
    const lastTime = times[serviceName] || 0;
    const waitTime = minInterval - (now - lastTime);
    if (waitTime > 0) {
      await sleep(waitTime);
    }
    times[serviceName] = Date.now();
    await chrome.storage.session.set({ [LAST_REQUEST_TIME_KEY]: times });
  } catch (e) {
    // 如果 storage 读取失败，继续执行但不做限流
  }

  const timeoutMs = REQUEST_TIMEOUT_BY_SERVICE[serviceName] || REQUEST_TIMEOUT_BY_SERVICE.default;

  let keepAliveInterval = null;
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    keepAliveInterval = setInterval(() => {
      try {
        chrome.runtime.sendMessage({ action: 'keepAlive' });
      } catch (e) {
        // ignore
      }
    }, 20000);
  }

  try {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const fetchOptions = { ...options, signal: controller.signal };
        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);

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
  } finally {
    if (keepAliveInterval) clearInterval(keepAliveInterval);
  }
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

    const mergedUserPrompt = `${system}\n\n${user}`;
    return await requestWithMessages([
      { role: 'user', content: mergedUserPrompt },
    ]);
  }
}

function buildContextAwareText(request) {
  const { text, service, enableAIContentAware, articleTitle, articleSummary } = request;
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

// ========================================
// 4. background/cache.js - Translation cache
// ========================================
const PROMPT_VERSION = self.ZDF_CONSTANTS?.PROMPT_VERSION || 'v6-p1';
const CACHE_MAX_SIZE = 1000;

class LRUCache extends Map {
  get(key) {
    const v = super.get(key);
    if (v !== undefined) {
      super.delete(key);
      super.set(key, v);
    }
    return v;
  }
  set(key, value) {
    if (super.has(key)) {
      super.delete(key);
    } else if (super.size >= CACHE_MAX_SIZE) {
      super.delete(super.keys().next().value);
    }
    super.set(key, value);
  }
}

const TRANSLATION_CACHE = new LRUCache();

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
  TRANSLATION_CACHE.set(key, value);
}

// ========================================
// 5. background/config.js - Configuration management
// ========================================
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
    selectedModels: { ...(self.ZDFProviders?.DEFAULT_MODELS || {
      openai: 'gpt-4o-mini',
      claude: 'claude-sonnet-4-20250514',
      gemini: 'gemini-2.0-flash',
      kimi: 'moonshot-v1-8k',
      zhipu: 'glm-4-flash',
      aliyun: 'qwen-turbo',
      deepseek: 'deepseek-chat',
      openrouter: 'openai/gpt-4o-mini',
    }) },
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

const API_KEYS_STORAGE_KEY = 'zdfEncryptedApiKeys';
const ENCRYPTION_KEY_STORAGE_KEY = 'zdfEncryptionKey';

async function getOrCreateEncryptionKey() {
  const result = await chrome.storage.local.get([ENCRYPTION_KEY_STORAGE_KEY]);
  if (result[ENCRYPTION_KEY_STORAGE_KEY]) {
    return new Uint8Array(result[ENCRYPTION_KEY_STORAGE_KEY]);
  }
  const key = crypto.getRandomValues(new Uint8Array(32));
  await chrome.storage.local.set({ [ENCRYPTION_KEY_STORAGE_KEY]: Array.from(key) });
  return key;
}

async function encryptApiKeys(apiKeys, key) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(JSON.stringify(apiKeys || {}));
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, data);
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
}

async function decryptApiKeys(encryptedObj, key) {
  if (!encryptedObj || !encryptedObj.iv || !encryptedObj.data) return {};
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);
  const iv = new Uint8Array(encryptedObj.iv);
  const data = new Uint8Array(encryptedObj.data);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, data);
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(decrypted));
}

async function loadMergedConfig() {
  const [syncResult, localResult] = await Promise.all([
    chrome.storage.sync.get(['zdfConfig']),
    chrome.storage.local.get([API_KEYS_STORAGE_KEY, ENCRYPTION_KEY_STORAGE_KEY]),
  ]);
  const config = syncResult.zdfConfig || {};
  let apiKeys = {};
  let migrated = false;

  if (localResult[API_KEYS_STORAGE_KEY] && localResult[ENCRYPTION_KEY_STORAGE_KEY]) {
    try {
      const key = new Uint8Array(localResult[ENCRYPTION_KEY_STORAGE_KEY]);
      apiKeys = await decryptApiKeys(localResult[API_KEYS_STORAGE_KEY], key);
    } catch (e) {
      console.warn('[ZDFTranslate] decrypt api keys failed:', e);
      apiKeys = {};
    }
  }

  if (!apiKeys || Object.keys(apiKeys).length === 0) {
    if (config.apiKeys && Object.keys(config.apiKeys).length > 0) {
      apiKeys = config.apiKeys;
      try {
        const key = await getOrCreateEncryptionKey();
        const encrypted = await encryptApiKeys(apiKeys, key);
        await chrome.storage.local.set({ [API_KEYS_STORAGE_KEY]: encrypted });
        migrated = true;
      } catch (e) {
        console.warn('[ZDFTranslate] encrypt migrate api keys failed:', e);
      }
    }
  }

  if (migrated && config.apiKeys) {
    delete config.apiKeys;
    try {
      await chrome.storage.sync.set({ zdfConfig: config });
    } catch (e) {
      console.warn('[ZDFTranslate] clear sync api keys failed:', e);
    }
  }

  return { ...config, apiKeys };
}

async function saveMergedConfig(config) {
  const { apiKeys, ...syncConfig } = config;
  syncConfig._version = (syncConfig._version || 0) + 1;
  syncConfig._updatedAt = Date.now();
  const key = await getOrCreateEncryptionKey();
  const encrypted = await encryptApiKeys(apiKeys, key);
  await chrome.storage.sync.set({ zdfConfig: syncConfig });
  await chrome.storage.local.set({ [API_KEYS_STORAGE_KEY]: encrypted });
}

// ========================================
// 6. background/providers.js - Translation providers
// ========================================
async function translateWithKimi(text, targetLang, sourceLang, modelOverride) {
  const zdfConfig = await loadMergedConfig();
  const apiKey = zdfConfig?.apiKeys?.kimi;
  const model = resolveModelForService(zdfConfig, 'kimi', modelOverride);

  ensureApiKey(apiKey, 'kimi');

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

async function translateWithAliyun(text, targetLang, sourceLang, modelOverride) {
  const zdfConfig = await loadMergedConfig();
  const apiKey = zdfConfig?.apiKeys?.aliyun;
  const model = resolveModelForService(zdfConfig, 'aliyun', modelOverride);

  ensureApiKey(apiKey, 'aliyun');

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
  const zdfConfig = await loadMergedConfig();
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
  const zdfConfig = await loadMergedConfig();
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
  const zdfConfig = await loadMergedConfig();
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
  const zdfConfig = await loadMergedConfig();
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

async function translateWithGemini(text, targetLang, sourceLang, modelOverride) {
  const zdfConfig = await loadMergedConfig();
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

async function translateWithClaude(text, targetLang, sourceLang, modelOverride) {
  const zdfConfig = await loadMergedConfig();
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

async function translateWithOpenRouter(text, targetLang, sourceLang, modelOverride) {
  const zdfConfig = await loadMergedConfig();
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
    if (error.message?.includes('404') && error.message?.includes('data policy')) {
      throw new Error('OpenRouter 隐私设置错误：当前模型需要调整数据使用策略。\n\n解决方法：\n1. 访问 https://openrouter.ai/settings/privacy\n2. 开启 "Allow my prompts to be used for training" 或选择允许免费模型使用的选项\n3. 或者更换为不需要数据共享的模型（如 openai/gpt-4o-mini）');
    }
    if (error.message?.includes('404') && error.message?.includes('No endpoints found')) {
      throw new Error('OpenRouter 错误：找不到可用的模型端点。\n\n可能原因：\n1. 所选模型暂时不可用\n2. 账户余额不足\n3. 模型需要特定权限\n\n建议：尝试更换其他模型，或检查 OpenRouter 账户余额。');
    }
    throw error;
  }
}

async function translateWithCustomService(serviceId, text, targetLang, sourceLang) {
  const zdfConfig = await loadMergedConfig();
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

  let baseUrl = customService.apiBaseUrl.trim();
  while (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }
  const model = customService.selectedModel || 'default';

  if (customService.mode === 'anthropic') {
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

// ========================================
// 7. background/batch.js - Batch queue logic
// ========================================
const BATCH_DELAY_MS = 60;
const MAX_BATCH_ITEMS = 6;
const BATCH_SEPARATOR = self.ZDF_CONSTANTS?.BATCH_SEPARATOR || '\n\n---ZDF_BATCH_BREAK---\n\n';

const translationBatchQueues = new Map();

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

  // 批量队列依赖 Unicode 分隔符原样返回，免费及部分 API 无法保证，直接单条处理更稳
  return handleTranslation(request);
}

async function dispatchSingleTranslation(request) {
  const { targetLang, sourceLang, service } = request;
  const text = buildContextAwareText(request);

  if (isCustomService(service)) {
    return await translateWithCustomService(service, text, targetLang, sourceLang);
  }

  const zdfConfig = await loadMergedConfig();
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

// ========================================
// 8. Main background script - Event handlers
// ========================================
const logger = {
  error: (ctx, err) => console.error(`[ZDFTranslate][${ctx}]`, err),
  warn: (ctx, msg) => console.warn(`[ZDFTranslate][${ctx}]`, msg),
  info: (ctx, msg) => console.info(`[ZDFTranslate][${ctx}]`, msg),
};

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

chrome.runtime.onInstalled.addListener((details) => {
  (async () => {
    try {
      if (details.reason === 'install') {
        await saveMergedConfig(getDefaultConfig());
        ensureContextMenu();
        return;
      }

      if (details.reason === 'update') {
        const cfg = await loadMergedConfig();
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
          await saveMergedConfig(cfg);
        }
        ensureContextMenu();
        return;
      }

      ensureContextMenu();
    } catch (e) {
      logger.error('onInstalled', e);
    }
  })();
});

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenu();
});

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
        // Silently ignore - optional feature
      }

      await chrome.tabs.sendMessage(tab.id, {
        action: 'showTranslationPopup',
        originalText: info.selectionText,
        translatedText: null,
        error: null,
        originalSegments: segments
      });

      const zdfConfig = await loadMergedConfig();
      const config = zdfConfig || {};

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
        promptVersion: self.ZDF_CONSTANTS?.PROMPT_VERSION || 'v6-p1'
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
      logger.error('contextMenuTranslate', error);
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'showTranslationPopup',
          originalText: info.selectionText,
          translatedText: null,
          error: error.message || 'Translation failed'
        });
      } catch (e) {
        logger.error('showErrorPopup', e);
      }
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    enqueueTranslationRequest(request)
      .then(result => sendResponse({ translatedText: result }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'getConfig') {
    (async () => {
      try {
        const cfg = await loadMergedConfig();
        sendResponse(cfg);
      } catch (e) {
        logger.error('getConfig', e);
        sendResponse(getDefaultConfig());
      }
    })();
    return true;
  }

  if (request.action === 'saveConfig') {
    (async () => {
      try {
        await saveMergedConfig(request.config);
        sendResponse({ success: true });
      } catch (error) {
        logger.error('saveConfig', error);
        sendResponse({ success: false, error: error?.message || '保存失败' });
      }
    })();
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

  if (request.action === 'getTabStatus') {
    (async () => {
      try {
        const result = await chrome.storage.session.get(['tabTranslationStatus']);
        const status = result?.tabTranslationStatus?.[request.tabId] || false;
        sendResponse({ isTranslated: status });
      } catch (e) {
        sendResponse({ isTranslated: false });
      }
    })();
    return true;
  }

  if (request.action === 'setTabStatus') {
    (async () => {
      try {
        const result = await chrome.storage.session.get(['tabTranslationStatus']);
        const map = result?.tabTranslationStatus || {};
        map[request.tabId] = request.isTranslated;
        await chrome.storage.session.set({ tabTranslationStatus: map });
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false });
      }
    })();
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

  if (request.action === 'keepAlive') {
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
