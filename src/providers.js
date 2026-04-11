// ZDFTranslate Provider Registry
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

  // 预设翻译 Prompt
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
