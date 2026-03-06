// ZDFTranslate Provider Registry (extracted)
(function initProviders(global) {
  const DEFAULT_MODELS = {
    openai: 'gpt-3.5-turbo',
    kimi: 'moonshot-v1-8k',
    zhipu: 'glm-4-flash',
    aliyun: 'qwen-turbo',
    deepseek: 'deepseek-chat',
    openrouter: 'openai/gpt-4o-mini',
  };

  const PROVIDER_META = {
    'microsoft-free': { kind: 'free' },
    'google-free': { kind: 'free' },
    kimi: { kind: 'llm', defaultModel: DEFAULT_MODELS.kimi },
    aliyun: { kind: 'llm', defaultModel: DEFAULT_MODELS.aliyun },
    zhipu: { kind: 'llm', defaultModel: DEFAULT_MODELS.zhipu },
    openai: { kind: 'llm', defaultModel: DEFAULT_MODELS.openai },
    deepseek: { kind: 'llm', defaultModel: DEFAULT_MODELS.deepseek },
    openrouter: { kind: 'llm', defaultModel: DEFAULT_MODELS.openrouter },
    google: { kind: 'api' },
    deepl: { kind: 'api' },
    libretranslate: { kind: 'api' },
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

  function buildTranslationMessages(targetLang, text) {
    const targetLangName = resolveTargetLangName(targetLang);
    return {
      system: `You are a professional translator. Translate into ${targetLangName} accurately and literally. Do NOT add facts, do NOT summarize, do NOT infer. Preserve numbers, names, entities, and paragraph boundaries. Return translation only. If input contains <TEXT>...</TEXT>, translate ONLY the content inside <TEXT> and ignore other context blocks.`,
      user: text,
    };
  }

  function extractChatCompletionText(data, serviceName) {
    const content = data?.choices?.[0]?.message?.content;
    if (!content || !String(content).trim()) {
      throw new Error(`${serviceName} API 返回格式错误`);
    }
    return String(content).trim();
  }

  global.ZDFProviders = {
    DEFAULT_MODELS,
    PROVIDER_META,
    LANG_NAME_MAP,
    isCustomService,
    isLLMService,
    resolveModelForService,
    resolveTargetLangName,
    buildTranslationMessages,
    extractChatCompletionText,
  };
})(self);
