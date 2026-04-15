// ZDFTranslate - Options Script (Slim Edition)

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

document.addEventListener('DOMContentLoaded', async () => {
  // i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const msg = chrome.i18n.getMessage(key);
    if (msg) el.textContent = msg;
  });

  let customServices = [];

  const ADD_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

  const BRAND_ICON_PATHS = {
    openai: 'assets/providers/openai.png',
    openrouter: 'assets/providers/openrouter.png',
    kimi: 'assets/providers/kimi.png',
    deepseek: 'assets/providers/deepseek.png',
    zhipu: 'assets/providers/zhipu.png',
    aliyun: 'assets/providers/aliyun.png',
    gemini: 'assets/providers/google.png',
    claude: 'assets/providers/claude.svg',
    deepl: 'assets/providers/deepl.svg',
    'google-free': 'assets/providers/google.png',
    'microsoft-free': 'assets/providers/microsoft.svg',
    custom: 'assets/providers/custom.png',
  };

  function decorateModelName(service, modelName) {
    return String(modelName || '').trim();
  }

  function validateCustomServiceRequired(service) {
    const name = (service?.name || '').trim();
    const apiBaseUrl = (service?.apiBaseUrl || '').trim();
    const apiKey = (service?.apiKey || '').trim();
    const selectedModel = (service?.selectedModel || '').trim();

    if (!name || !apiBaseUrl || !apiKey || !selectedModel) {
      return false;
    }

    try {
      const u = new URL(apiBaseUrl);
      if (!/^https?:$/.test(u.protocol)) return false;
    } catch (e) {
      return false;
    }

    return true;
  }

  function syncCustomServicesFromDOM() {
    const cards = document.querySelectorAll('#customServicesContainer .custom-service-card');
    cards.forEach((card) => {
      const serviceId = card.dataset.serviceId;
      const service = customServices.find(s => s.id === serviceId);
      if (!service) return;

      const nameInput = card.querySelector('.custom-service-name');
      const baseUrlInput = card.querySelector('.custom-service-baseurl');
      const apiKeyInput = card.querySelector('.custom-service-apikey');
      const modeSelect = card.querySelector('.custom-service-mode');
      const modelSelect = card.querySelector('.custom-service-model');
      const modelInput = card.querySelector('.custom-service-model-custom');

      service.name = (nameInput?.value || '').trim();
      service.apiBaseUrl = (baseUrlInput?.value || '').trim();
      service.apiKey = (apiKeyInput?.value || '').trim();
      service.mode = modeSelect?.value || 'openai';
      service.selectedModel = (modelInput && modelInput.style.display !== 'none')
        ? (modelInput.value || '').trim()
        : ((modelSelect?.value || '').trim());
    });
  }

  function isBlankCustomService(service) {
    const name = (service?.name || '').trim();
    const apiBaseUrl = (service?.apiBaseUrl || '').trim();
    const apiKey = (service?.apiKey || '').trim();
    const selectedModel = (service?.selectedModel || '').trim();
    const nameIsPlaceholder = !name || name === '自定义服务';
    return nameIsPlaceholder && !apiBaseUrl && !apiKey && !selectedModel;
  }

  function normalizeCustomServiceDrafts() {
    let incompleteKept = false;
    customServices = customServices.filter((service) => {
      if (validateCustomServiceRequired(service)) return true;
      if (!incompleteKept) {
        incompleteKept = true;
        return true;
      }
      return false;
    });
  }

  // Bind add button early
  const addBtn = document.getElementById('addCustomServiceBtn');
  if (addBtn) {
    addBtn.disabled = true;
    addBtn.innerHTML = '<span>加载配置中...</span>';

    addBtn.addEventListener('click', () => {
      try {
        syncCustomServicesFromDOM();
        normalizeCustomServiceDrafts();

        const incomplete = customServices.find(s => !validateCustomServiceRequired(s));
        if (incomplete) {
          showStatus('未正确填写参数：请先完整填写当前自定义服务（名称、API Base URL、API Key、模型）', 'error');
          return;
        }

        const newService = {
          id: 'custom_' + generateId(),
          name: '自定义服务',
          apiBaseUrl: '',
          apiKey: '',
          mode: 'openai',
          selectedModel: ''
        };
        customServices.unshift(newService);
        renderCustomServices();
        showStatus('已添加自定义服务，请配置详细信息', 'success');
      } catch (e) {
        console.error('Error adding custom service:', e);
        showStatus('添加服务出错: ' + e.message, 'error');
      }
    });
  }

  // Display real version
  const appVersionEl = document.getElementById('appVersion');
  if (appVersionEl && chrome?.runtime?.getManifest) {
    appVersionEl.textContent = chrome.runtime.getManifest().version;
  }

  // Load config
  let config = {};
  try {
    config = await loadConfig();
  } catch (e) {
    console.error('loadConfig failed:', e);
    config = {};
  } finally {
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.innerHTML = `${ADD_ICON}<span>添加自定义服务</span>`;
    }
  }

  if (Array.isArray(config.customServices)) {
    customServices = config.customServices;
  }

  const activeServiceEl = document.getElementById('activeService');

  function restoreSelectOptionLabels(selectEl) {
    if (!selectEl) return;
    Array.from(selectEl.options || []).forEach((opt) => {
      const raw = opt.dataset.rawLabel || opt.textContent || '';
      if (!opt.dataset.rawLabel) opt.dataset.rawLabel = raw;
      opt.textContent = String(raw).trim();
    });
  }

  function renderActiveServiceSelectWithIcons() {
    if (!activeServiceEl) return;
    const service = activeServiceEl.value;
    const iconPath = BRAND_ICON_PATHS[service] || BRAND_ICON_PATHS.custom;
    restoreSelectOptionLabels(activeServiceEl);
    activeServiceEl.style.display = '';
    activeServiceEl.style.appearance = 'none';
    activeServiceEl.style.webkitAppearance = 'none';
    activeServiceEl.style.backgroundImage = `url(${iconPath}), url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`;
    activeServiceEl.style.backgroundRepeat = 'no-repeat, no-repeat';
    activeServiceEl.style.backgroundSize = '16px 16px, 16px 16px';
    activeServiceEl.style.backgroundPosition = '10px center, calc(100% - 10px) center';
    activeServiceEl.style.paddingLeft = '34px';
    activeServiceEl.style.paddingRight = '36px';
  }

  const ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"/></svg>';
  const ICON_CUSTOM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
  const ICON_LIST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/></svg>';

  function getServiceGroups() {
    const groups = {
      kimi: [document.getElementById('kimiApiKey')?.closest('.provider')],
      zhipu: [document.getElementById('zhipuApiKey')?.closest('.provider')],
      aliyun: [document.getElementById('aliyunApiKey')?.closest('.provider')],
      deepseek: [document.getElementById('deepseekApiKey')?.closest('.provider')],
      openai: [document.getElementById('openaiApiKey')?.closest('.provider')],
      openrouter: [document.getElementById('openrouterApiKey')?.closest('.provider')],
      gemini: [document.getElementById('geminiApiKey')?.closest('.provider')],
      claude: [document.getElementById('claudeApiKey')?.closest('.provider')],
      deepl: [document.getElementById('deeplApiKey')?.closest('.provider')],
      custom: [
        document.getElementById('custom-service-divider')
      ]
    };
    return groups;
  }

  function updateServiceVisibility(service) {
    const groups = getServiceGroups();
    const allServiceKeys = Object.keys(groups);

    allServiceKeys.forEach((key) => {
      const isActive = key === service;
      (groups[key] || []).forEach((el) => {
        if (!el) return;
        el.style.display = isActive ? '' : 'none';
      });
    });

    const secCn = document.getElementById('sec-cn');

    const freeServices = new Set(['microsoft-free', 'google-free']);
    if (freeServices.has(service)) {
      if (secCn) secCn.style.display = 'none';
      return;
    }

    // custom-service-divider is a standalone section, handled by groups['custom'] above
    if (secCn) secCn.style.display = service === 'custom' ? 'none' : '';
  }

  // Model selector mappings (now includes gemini and claude)
  const modelSelectors = {
    kimi: document.getElementById('kimiModel'),
    zhipu: document.getElementById('zhipuModel'),
    aliyun: document.getElementById('aliyunModel'),
    deepseek: document.getElementById('deepseekModel'),
    openai: document.getElementById('openaiModel'),
    openrouter: document.getElementById('openrouterModel'),
    gemini: document.getElementById('geminiModel'),
    claude: document.getElementById('claudeModel')
  };

  function renderModelSelectWithIcons(service, selectElement) {
    if (!selectElement) return;
    const iconPath = BRAND_ICON_PATHS[service] || BRAND_ICON_PATHS.custom;
    restoreSelectOptionLabels(selectElement);
    selectElement.style.display = '';
    selectElement.style.appearance = 'none';
    selectElement.style.webkitAppearance = 'none';
    selectElement.style.backgroundImage = `url(${iconPath}), url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`;
    selectElement.style.backgroundRepeat = 'no-repeat, no-repeat';
    selectElement.style.backgroundSize = '16px 16px, 16px 16px';
    selectElement.style.backgroundPosition = '10px center, calc(100% - 10px) center';
    selectElement.style.paddingLeft = '34px';
    selectElement.style.paddingRight = '36px';
  }

  function applyModelSelectBrandIcons() {
    Object.entries(modelSelectors).forEach(([service, el]) => {
      if (!el) return;
      renderModelSelectWithIcons(service, el);
    });
  }

  // Custom model input mappings
  const customModelInputs = {
    kimi: document.getElementById('kimiModelCustom'),
    zhipu: document.getElementById('zhipuModelCustom'),
    aliyun: document.getElementById('aliyunModelCustom'),
    deepseek: document.getElementById('deepseekModelCustom'),
    openai: document.getElementById('openaiModelCustom'),
    openrouter: document.getElementById('openrouterModelCustom'),
    gemini: document.getElementById('geminiModelCustom'),
    claude: document.getElementById('claudeModelCustom')
  };

  // API Key input mappings
  const apiKeyInputs = {
    kimi: document.getElementById('kimiApiKey'),
    zhipu: document.getElementById('zhipuApiKey'),
    aliyun: document.getElementById('aliyunApiKey'),
    deepseek: document.getElementById('deepseekApiKey'),
    openai: document.getElementById('openaiApiKey'),
    openrouter: document.getElementById('openrouterApiKey'),
    gemini: document.getElementById('geminiApiKey'),
    claude: document.getElementById('claudeApiKey')
  };

  applyModelSelectBrandIcons();

  // Default model lists (fallback)
  const DEFAULT_MODELS = {
    kimi: [
      { id: 'kimi-k2.5', name: 'Kimi K2.5' },
      { id: 'kimi-k2', name: 'Kimi K2' },
      { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking' }
    ],
    zhipu: [
      { id: 'glm-5.1', name: 'GLM-5.1' },
      { id: 'glm-5', name: 'GLM-5' },
      { id: 'glm-5-turbo', name: 'GLM-5 Turbo' },
      { id: 'glm-4-flash', name: 'GLM-4-Flash' },
      { id: 'glm-4-plus', name: 'GLM-4-Plus' }
    ],
    aliyun: [
      { id: 'qwen-mt-turbo', name: 'qwen-mt-turbo' },
      { id: 'qwen-mt-plus', name: 'qwen-mt-plus' },
      { id: 'qwen-mt-flash', name: 'qwen-mt-flash' },
      { id: 'qwen3-max', name: 'qwen3-max' },
      { id: 'qwen3.6-plus', name: 'qwen3.6-plus' },
      { id: 'qwen3.5-plus', name: 'qwen3.5-plus' },
      { id: 'qwen3.5-flash', name: 'qwen3.5-flash' },
      { id: 'qwen3-coder-plus', name: 'qwen3-coder-plus' },
      { id: 'qwen3-coder-flash', name: 'qwen3-coder-flash' },
      { id: 'qwen-long', name: 'qwen-long' },
      { id: 'qwen-plus', name: 'qwen-plus' },
      { id: 'qwen-turbo', name: 'qwen-turbo' }
    ],
    deepseek: [
      { id: 'deepseek-chat', name: 'deepseek-chat (V3.2)' },
      { id: 'deepseek-reasoner', name: 'deepseek-reasoner (V3.2)' }
    ],
    openai: [
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'gpt-5.4-pro', name: 'GPT-5.4 Pro' },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini' },
      { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano' },
      { id: 'gpt-5.3-chat', name: 'GPT-5.3 Chat' },
      { id: 'gpt-oss-120b', name: 'GPT-OSS 120B' },
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' }
    ],
    // NOTE: `deprecated: true` marks a model as retired; UI appends "（已弃用）"
    openrouter: [
      { id: 'openai/gpt-5.4', name: 'GPT-5.4' },
      { id: 'openai/gpt-5.4-pro', name: 'GPT-5.4 Pro' },
      { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini' },
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B' },
      { id: 'openai/gpt-oss-120b:free', name: 'GPT-OSS 120B (free)' },
      { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6' },
      { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
      { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash' },
      { id: 'google/gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite' },
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2' },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1' },
      { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (free)' },
      { id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5' },
      { id: 'qwen/qwen3.6-plus', name: 'Qwen3.6 Plus' },
      { id: 'qwen/qwen3.5-plus', name: 'Qwen3.5 Plus' }
    ],
    gemini: [
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
      { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite' },
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', deprecated: true }
    ],
    claude: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
      { id: 'claude-opus-4-1', name: 'Claude Opus 4.1' },
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', deprecated: true },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', deprecated: true }
    ]
  };

  // Migrate old default colors
  const oldDefaultColors = ['#666', '#666666', '#000', '#000000', 'rgb(102, 102, 102)', '#3b82f6'];
  const currentColor = (config.style?.translationColor || '').toLowerCase();
  if (!currentColor || oldDefaultColors.includes(currentColor)) {
    config.style = {
      ...(config.style || {}),
      translationColor: '#111111'
    };
    await saveConfig(config);
  }

  // Fill form - API Keys
  apiKeyInputs.kimi.value = config.apiKeys?.kimi || '';
  apiKeyInputs.zhipu.value = config.apiKeys?.zhipu || '';
  apiKeyInputs.aliyun.value = config.apiKeys?.aliyun || '';
  apiKeyInputs.deepseek.value = config.apiKeys?.deepseek || '';
  document.getElementById('deeplApiKey').value = config.apiKeys?.deepl || '';
  apiKeyInputs.openai.value = config.apiKeys?.openai || '';
  if (apiKeyInputs.openrouter) {
    apiKeyInputs.openrouter.value = config.apiKeys?.openrouter || '';
  }
  apiKeyInputs.gemini.value = config.apiKeys?.gemini || '';
  apiKeyInputs.claude.value = config.apiKeys?.claude || '';

  // DeepL plan
  const deeplPlanEl = document.getElementById('deeplPlan');
  if (deeplPlanEl) {
    deeplPlanEl.value = config.deeplPlan || 'free';
  }

  // Prompt preset
  const promptPresetEl = document.getElementById('promptPreset');
  if (promptPresetEl) {
    promptPresetEl.value = config.promptPreset || 'general';
  }

  // Style settings
  document.getElementById('translationColor').value = config.style?.translationColor || '#555555';
  document.getElementById('translationSize').value = config.style?.translationSize || '0.95em';
  document.getElementById('lineSpacing').value = config.style?.lineSpacing || '1.6';
  document.getElementById('translationBgColor') && (document.getElementById('translationBgColor').value = config.style?.translationBgColor || '#ffffff');
  document.getElementById('translationBgOpacity') && (document.getElementById('translationBgOpacity').value = config.style?.translationBgOpacity ?? 0);
  document.getElementById('translationFont') && (document.getElementById('translationFont').value = config.style?.translationFont || '');
  document.getElementById('translationDivider') && (document.getElementById('translationDivider').value = config.style?.translationDivider || 'dashed');
  document.getElementById('translationLeftBar') && (document.getElementById('translationLeftBar').value = config.style?.translationLeftBar || 'none');
  document.getElementById('translationFontWeight') && (document.getElementById('translationFontWeight').value = config.style?.translationFontWeight || 'normal');
  document.getElementById('translationUnderline') && (document.getElementById('translationUnderline').value = config.style?.translationUnderline || 'none');

  const currentService = config.translationService || 'microsoft-free';
  if (activeServiceEl) {
    activeServiceEl.value = currentService;
    activeServiceEl.addEventListener('change', () => {
      const selected = activeServiceEl.value;
      updateServiceVisibility(selected);

      if (selected === 'custom') {
        syncCustomServicesFromDOM();
        normalizeCustomServiceDrafts();

        if (customServices.length === 0) {
          customServices.unshift({
            id: 'custom_' + generateId(),
            name: '',
            apiBaseUrl: '',
            apiKey: '',
            mode: 'openai',
            selectedModel: ''
          });
        }
        renderCustomServices();
      }
      renderActiveServiceSelectWithIcons();
    });
    renderActiveServiceSelectWithIcons();
  }
  updateServiceVisibility(currentService);

  // Modern flat-cards feel: expand all providers by default
  document.querySelectorAll('details.provider').forEach(d => d.open = true);


  // Initialize all model selectors
  for (const [service, select] of Object.entries(modelSelectors)) {
    if (select) {
      renderModels(service, select, DEFAULT_MODELS[service] || [], config.selectedModels?.[service]);

      const apiKey = apiKeyInputs[service]?.value;
      if (apiKey) {
        try {
          const models = await fetchRemoteModelsWithFallback(service, apiKey);
          if (models.length > 0) {
            const mergedModels = [...(DEFAULT_MODELS[service] || [])];
            models.forEach(remoteModel => {
              if (!mergedModels.some(m => m.id === remoteModel.id)) {
                mergedModels.push(remoteModel);
              }
            });
            renderModels(service, select, mergedModels, config.selectedModels?.[service]);
          }
        } catch (e) {
          // Silently fall back to default models
        }
      }
    }
  }

  // Initialize custom model inputs
  for (const [service, input] of Object.entries(customModelInputs)) {
    if (input && config.selectedModels?.[service]) {
      const defaultModels = DEFAULT_MODELS[service] || [];
      const isCustom = !defaultModels.some(m => m.id === config.selectedModels[service]);
      if (isCustom) {
        input.value = config.selectedModels[service];
      }
    }
  }

  // Initialize custom services
  normalizeCustomServiceDrafts();
  if ((currentService === 'custom') && customServices.length === 0) {
    customServices.unshift({
      id: 'custom_' + generateId(),
      name: '',
      apiBaseUrl: '',
      apiKey: '',
      mode: 'openai',
      selectedModel: ''
    });
  }
  renderCustomServices();

  // Refresh models button events
  document.querySelectorAll('.refresh-models').forEach(btn => {
    btn.addEventListener('click', async () => {
      const service = btn.dataset.service;
      const select = modelSelectors[service];
      const apiKey = apiKeyInputs[service]?.value;
      const statusEl = document.getElementById(`${service}Status`);

      btn.disabled = true;
      const originalHtml = btn.innerHTML;
      btn.innerHTML = '<span>获取中...</span>';

      if (statusEl) {
        statusEl.textContent = '获取远程模型...';
        statusEl.className = 'model-status loading';
      }

      if (!apiKey) {
        showStatus(`请先输入 ${getServiceName(service)} API Key`, 'error');
        if (statusEl) {
          statusEl.textContent = '请先输入 API Key';
          statusEl.className = 'model-status error';
        }
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        return;
      }

      const success = await fetchRemoteModels(service, select, apiKey, select.value);

      btn.disabled = false;
      btn.innerHTML = originalHtml;

      if (success) {
        if (statusEl) {
          statusEl.textContent = '已获取最新模型';
          statusEl.className = 'model-status success';
        }
        showStatus(`${getServiceName(service)} 模型列表已更新`, 'success');
      } else {
        if (statusEl) {
          statusEl.textContent = '获取失败，使用默认模型';
          statusEl.className = 'model-status error';
        }
        showStatus(`${getServiceName(service)} 获取远程模型失败，已显示默认模型`, 'error');
      }

      setTimeout(() => {
        if (statusEl) {
          statusEl.textContent = '';
          statusEl.className = '';
        }
      }, 5000);
    });
  });

  // Custom model toggle button events
  document.querySelectorAll('.toggle-custom-model').forEach(btn => {
    btn.addEventListener('click', () => {
      const service = btn.dataset.service;
      const select = modelSelectors[service];
      const input = customModelInputs[service];

      if (!input) return;

      if (input.style.display === 'none') {
        select.style.display = 'none';
        input.style.display = 'block';
        btn.innerHTML = `${ICON_LIST}<span>选择列表</span>`;
        input.focus();
      } else {
        select.style.display = 'block';
        input.style.display = 'none';
        btn.innerHTML = `${ICON_CUSTOM}<span>自定义</span>`;

        if (input.value.trim()) {
          const customModel = input.value.trim();
          const exists = Array.from(select.options).some(opt => opt.value === customModel);
          if (!exists) {
            const option = document.createElement('option');
            option.value = customModel;
            option.textContent = decorateModelName('custom', customModel) + ' (自定义)';
            select.appendChild(option);
          }
          select.value = customModel;
        }
      }
    });
  });

  // ===== Style Presets =====
  const STYLE_PRESETS = {
    classic: {
      translationColor: '#555555', translationBgColor: '#ffffff', translationBgOpacity: 0,
      translationSize: '0.95em', lineSpacing: '1.6', translationFont: '',
      translationFontWeight: 'normal', translationUnderline: 'none',
      translationDivider: 'dashed', translationLeftBar: 'none',
    },
    subtle: {
      translationColor: '#9ca3af', translationBgColor: '#ffffff', translationBgOpacity: 0,
      translationSize: '0.9em', lineSpacing: '1.5', translationFont: '',
      translationFontWeight: 'normal', translationUnderline: 'none',
      translationDivider: 'none', translationLeftBar: 'none',
    },
    bold: {
      translationColor: '#111827', translationBgColor: '#ffffff', translationBgOpacity: 0,
      translationSize: '0.95em', lineSpacing: '1.7', translationFont: '',
      translationFontWeight: 'bold', translationUnderline: 'none',
      translationDivider: 'none', translationLeftBar: 'none',
    },
    underline: {
      translationColor: '#374151', translationBgColor: '#ffffff', translationBgOpacity: 0,
      translationSize: '0.95em', lineSpacing: '1.6', translationFont: '',
      translationFontWeight: 'normal', translationUnderline: 'underline',
      translationDivider: 'none', translationLeftBar: 'none',
    },
    highlight: {
      translationColor: '#1e293b', translationBgColor: '#fef08a', translationBgOpacity: 55,
      translationSize: '0.95em', lineSpacing: '1.6', translationFont: '',
      translationFontWeight: 'normal', translationUnderline: 'none',
      translationDivider: 'none', translationLeftBar: 'none',
    },
    paper: {
      translationColor: '#374151', translationBgColor: '#fefce8', translationBgOpacity: 40,
      translationSize: '0.95em', lineSpacing: '1.7',
      translationFont: '"Noto Serif SC", "Source Han Serif SC", Georgia, serif',
      translationFontWeight: 'normal', translationUnderline: 'none',
      translationDivider: 'solid', translationLeftBar: 'none',
    },
    side: {
      translationColor: '#4f46e5', translationBgColor: '#ffffff', translationBgOpacity: 0,
      translationSize: '0.95em', lineSpacing: '1.6', translationFont: '',
      translationFontWeight: 'normal', translationUnderline: 'none',
      translationDivider: 'none', translationLeftBar: '3px',
    },
  };

  const stylePresetsEl = document.getElementById('stylePresets');
  const styleCustomPanel = document.getElementById('styleCustomPanel');
  const previewTranslated = document.getElementById('previewTranslated');
  let activePreset = 'classic';

  function applyStyleValues(style) {
    const colorEl = document.getElementById('translationColor');
    const bgColorEl = document.getElementById('translationBgColor');
    const bgOpacityEl = document.getElementById('translationBgOpacity');
    const sizeEl = document.getElementById('translationSize');
    const spacingEl = document.getElementById('lineSpacing');
    const fontEl = document.getElementById('translationFont');
    const dividerEl = document.getElementById('translationDivider');
    const leftBarEl = document.getElementById('translationLeftBar');
    const fontWeightEl = document.getElementById('translationFontWeight');
    const underlineEl = document.getElementById('translationUnderline');

    if (colorEl) colorEl.value = style.translationColor || '#555555';
    if (bgColorEl) bgColorEl.value = style.translationBgColor || '#ffffff';
    if (bgOpacityEl) bgOpacityEl.value = Math.round((style.translationBgOpacity || 0) * 100 / 100);
    if (sizeEl) sizeEl.value = style.translationSize || '0.95em';
    if (spacingEl) spacingEl.value = style.lineSpacing || '1.6';
    if (fontEl) fontEl.value = style.translationFont || '';
    if (dividerEl) dividerEl.value = style.translationDivider || 'dashed';
    if (leftBarEl) leftBarEl.value = style.translationLeftBar || 'none';
    if (fontWeightEl) fontWeightEl.value = style.translationFontWeight || 'normal';
    if (underlineEl) underlineEl.value = style.translationUnderline || 'none';
    updateStylePreview();
  }

  function updateStylePreview() {
    if (!previewTranslated) return;
    const color = document.getElementById('translationColor')?.value || '#555555';
    const bgColor = document.getElementById('translationBgColor')?.value || '#ffffff';
    const bgOpacity = (parseInt(document.getElementById('translationBgOpacity')?.value || '0', 10)) / 100;
    const size = document.getElementById('translationSize')?.value || '0.95em';
    const spacing = document.getElementById('lineSpacing')?.value || '1.6';
    const font = document.getElementById('translationFont')?.value || '';
    const divider = document.getElementById('translationDivider')?.value || 'dashed';
    const leftBar = document.getElementById('translationLeftBar')?.value || 'none';
    const fontWeight = document.getElementById('translationFontWeight')?.value || 'normal';
    const underline = document.getElementById('translationUnderline')?.value || 'none';

    let styles = `color:${color};font-size:${size};line-height:${spacing};`;
    if (font) styles += `font-family:${font};`;
    if (fontWeight === 'bold') styles += 'font-weight:600;';
    if (underline === 'underline') styles += 'text-decoration:underline;text-underline-offset:3px;text-decoration-color:rgba(99,102,241,0.45);';
    else if (underline === 'wavy') styles += 'text-decoration:underline wavy;text-underline-offset:3px;text-decoration-color:rgba(99,102,241,0.45);';
    if (bgOpacity > 0) {
      const r = parseInt(bgColor.slice(1,3),16), g = parseInt(bgColor.slice(3,5),16), b = parseInt(bgColor.slice(5,7),16);
      styles += `background:rgba(${r},${g},${b},${bgOpacity});border-radius:4px;padding:8px 10px;`;
    }
    if (divider === 'dashed') styles += 'border-top:1px dashed rgba(120,120,120,0.18);padding-top:10px;margin-top:12px;';
    else if (divider === 'solid') styles += 'border-top:1px solid rgba(120,120,120,0.25);padding-top:10px;margin-top:12px;';
    else styles += 'margin-top:8px;';
    if (leftBar !== 'none') styles += `border-left:${leftBar} solid #6366f1;padding-left:10px;`;
    previewTranslated.style.cssText = styles;
  }

  if (stylePresetsEl) {
    stylePresetsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.style-preset');
      if (!btn) return;
      const preset = btn.dataset.preset;
      stylePresetsEl.querySelectorAll('.style-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activePreset = preset;

      if (preset === 'custom') {
        styleCustomPanel.style.display = '';
      } else {
        styleCustomPanel.style.display = 'none';
        applyStyleValues(STYLE_PRESETS[preset]);
      }
    });
  }

  // Bind live preview to custom style inputs
  ['translationColor','translationBgColor','translationBgOpacity','translationSize','lineSpacing','translationFont','translationFontWeight','translationUnderline','translationDivider','translationLeftBar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateStylePreview);
    if (el) el.addEventListener('change', updateStylePreview);
  });

  // Init preset from saved config
  const savedStyle = config.style || {};
  const savedPreset = savedStyle.preset || 'classic';
  activePreset = savedPreset;
  const presetBtn = stylePresetsEl?.querySelector(`[data-preset="${savedPreset}"]`);
  if (presetBtn) {
    stylePresetsEl?.querySelectorAll('.style-preset').forEach(b => b.classList.remove('active'));
    presetBtn.classList.add('active');
  }
  if (savedPreset === 'custom') {
    styleCustomPanel.style.display = '';
    applyStyleValues(savedStyle);
  } else if (STYLE_PRESETS[savedPreset]) {
    applyStyleValues(STYLE_PRESETS[savedPreset]);
  } else {
    applyStyleValues(savedStyle);
  }

  // Save button
  document.getElementById('saveBtn').addEventListener('click', async () => {
    try {
      const selectedModels = {};
      for (const [service, select] of Object.entries(modelSelectors)) {
        if (select) {
          const input = customModelInputs[service];
          if (input && input.style.display !== 'none' && input.value.trim()) {
            selectedModels[service] = input.value.trim();
          } else {
            selectedModels[service] = select.value;
          }
        }
      }

      // Collect custom service model selections
      customServices.forEach(service => {
        const card = document.querySelector(`.custom-service-card[data-service-id="${service.id}"]`);
        if (card) {
          const modelSelect = card.querySelector('.custom-service-model');
          const modelInput = card.querySelector('.custom-service-model-custom');
          if (modelInput && modelInput.style.display !== 'none' && modelInput.value.trim()) {
            service.selectedModel = modelInput.value.trim();
          } else if (modelSelect) {
            service.selectedModel = modelSelect.value;
          }
        }
      });

      syncCustomServicesFromDOM();
      const validCustomServices = customServices.filter(validateCustomServiceRequired);

      const newConfig = {
        ...config,
        translationService: activeServiceEl ? activeServiceEl.value : (config.translationService || 'microsoft-free'),
        promptPreset: document.getElementById('promptPreset')?.value || 'general',
        deeplPlan: document.getElementById('deeplPlan')?.value || 'free',
        apiKeys: {
          kimi: apiKeyInputs.kimi.value.trim(),
          zhipu: apiKeyInputs.zhipu.value.trim(),
          aliyun: apiKeyInputs.aliyun.value.trim(),
          deepseek: apiKeyInputs.deepseek.value.trim(),
          deepl: document.getElementById('deeplApiKey').value.trim(),
          openai: apiKeyInputs.openai.value.trim(),
          openrouter: apiKeyInputs.openrouter ? apiKeyInputs.openrouter.value.trim() : '',
          gemini: apiKeyInputs.gemini.value.trim(),
          claude: apiKeyInputs.claude.value.trim()
        },
        selectedModels: selectedModels,
        customServices: validCustomServices,
        style: {
          preset: activePreset,
          translationColor: document.getElementById('translationColor').value,
          translationBgColor: document.getElementById('translationBgColor')?.value || '#ffffff',
          translationBgOpacity: parseInt(document.getElementById('translationBgOpacity')?.value || '0', 10),
          translationSize: document.getElementById('translationSize').value,
          lineSpacing: document.getElementById('lineSpacing').value,
          translationFont: document.getElementById('translationFont')?.value || '',
          translationFontWeight: document.getElementById('translationFontWeight')?.value || 'normal',
          translationUnderline: document.getElementById('translationUnderline')?.value || 'none',
          translationDivider: document.getElementById('translationDivider')?.value || 'dashed',
          translationLeftBar: document.getElementById('translationLeftBar')?.value || 'none',
        },
        excludedSites: config.excludedSites || []
      };

      await saveConfig(newConfig);
      config = newConfig;
      showStatus('设置已保存！', 'success');
    } catch (error) {
      console.error('保存失败:', error);
      showStatus('保存失败：' + error.message, 'error');
    }
  });

  // Test connection button
  const testBtn = document.getElementById('testConnectionBtn');
  const testResult = document.getElementById('testResult');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const service = activeServiceEl ? activeServiceEl.value : 'microsoft-free';
      const serviceLabel = getServiceName(service);

      testBtn.disabled = true;
      testBtn.classList.add('loading');
      testResult.className = 'test-result';
      testResult.textContent = `正在测试 ${serviceLabel}...`;

      // Auto-save first so background picks up latest keys/models
      document.getElementById('saveBtn').click();
      await new Promise(r => setTimeout(r, 300));

      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: 'translate',
            text: 'Hello, this is a translation test.',
            targetLang: 'zh-CN',
            sourceLang: 'en',
            service,
          }, (res) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (res?.error) {
              reject(new Error(res.error));
            } else if (res?.translatedText) {
              resolve(res.translatedText);
            } else {
              reject(new Error('无响应'));
            }
          });
        });

        testResult.className = 'test-result success';
        testResult.textContent = `✓ ${serviceLabel} 连接正常：${response}`;
      } catch (err) {
        testResult.className = 'test-result error';
        testResult.textContent = `✗ ${serviceLabel} 测试失败：${err.message}`;
      } finally {
        testBtn.disabled = false;
        testBtn.classList.remove('loading');
      }
    });
  }

  // Reset button
  document.getElementById('resetBtn').addEventListener('click', async () => {
    if (confirm('确定要恢复默认设置吗？')) {
      const defaultConfig = {
        enabled: true,
        targetLang: 'zh-CN',
        sourceLang: 'auto',
        displayMode: 'bilingual',
        translationService: 'microsoft-free',
        promptPreset: 'general',
        deeplPlan: 'free',
        selectedModels: {
          kimi: 'kimi-k2.5',
          zhipu: 'glm-5.1',
          aliyun: 'qwen-mt-turbo',
          deepseek: 'deepseek-chat',
          openai: 'gpt-5.4',
          openrouter: 'openai/gpt-5.4',
          gemini: 'gemini-3.1-pro-preview',
          claude: 'claude-opus-4-6'
        },
        apiKeys: {
          kimi: '', zhipu: '', aliyun: '', deepseek: '',
          deepl: '', openai: '', openrouter: '',
          gemini: '', claude: ''
        },
        customServices: [],
        excludedSites: [],
        style: {
          translationColor: '#111111',
          translationSize: '0.95em',
          lineSpacing: '1.6',
          translationFontWeight: 'normal',
          translationUnderline: 'none',
        }
      };

      await saveConfig(defaultConfig);
      location.reload();
    }
  });

  // Render custom services list
  function renderCustomServices() {
    const container = document.getElementById('customServicesContainer');
    if (!container) return;

    const template = document.getElementById('customServiceTemplate');
    if (template) template.style.display = 'none';

    container.innerHTML = '';

    customServices.forEach(service => {
      const template = document.getElementById('customServiceTemplate');
      if (!template) return;

      const clone = template.firstElementChild.cloneNode(true);
      clone.dataset.serviceId = service.id;

      const nameInput = clone.querySelector('.custom-service-name');
      const baseUrlInput = clone.querySelector('.custom-service-baseurl');
      const apiKeyInput = clone.querySelector('.custom-service-apikey');
      const modeSelect = clone.querySelector('.custom-service-mode');
      const modelSelect = clone.querySelector('.custom-service-model');
      const modelInput = clone.querySelector('.custom-service-model-custom');

      nameInput.value = service.name || '';
      baseUrlInput.value = service.apiBaseUrl || '';
      apiKeyInput.value = service.apiKey || '';
      modeSelect.value = service.mode || 'openai';

      renderCustomServiceModels(modelSelect, service.selectedModel);

      if (service.selectedModel && modelSelect.querySelector(`option[value="${service.selectedModel}"]`)?.textContent?.includes('(自定义)')) {
        modelSelect.style.display = 'none';
        modelInput.style.display = 'block';
        modelInput.value = service.selectedModel;
        clone.querySelector('.toggle-custom-model-custom').innerHTML = `${ICON_LIST}<span>选择列表</span>`;
      }

      nameInput.addEventListener('change', () => { service.name = nameInput.value; });
      baseUrlInput.addEventListener('change', () => { service.apiBaseUrl = baseUrlInput.value; });
      apiKeyInput.addEventListener('change', () => { service.apiKey = apiKeyInput.value; });
      modeSelect.addEventListener('change', () => { service.mode = modeSelect.value; });
      modelSelect.addEventListener('change', () => { service.selectedModel = modelSelect.value; });
      modelInput.addEventListener('change', () => { service.selectedModel = modelInput.value; });

      clone.querySelector('.delete-custom-service').addEventListener('click', () => {
        if (confirm(`确定要删除自定义服务 "${service.name}" 吗？`)) {
          customServices = customServices.filter(s => s.id !== service.id);
          renderCustomServices();
          showStatus('已删除自定义服务', 'success');
        }
      });

      clone.querySelector('.refresh-custom-models').addEventListener('click', async () => {
        const btn = clone.querySelector('.refresh-custom-models');
        const statusEl = clone.querySelector('.custom-service-status');

        btn.disabled = true;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<span>获取中...</span>';

        if (statusEl) {
          statusEl.textContent = '获取远程模型...';
          statusEl.className = 'custom-service-status loading';
        }

        if (!service.apiKey || !service.apiBaseUrl) {
          if (statusEl) {
            statusEl.textContent = '请先输入 API Key 和 Base URL';
            statusEl.className = 'custom-service-status error';
          }
          btn.disabled = false;
          btn.innerHTML = originalHtml;
          return;
        }

        const models = await fetchCustomModels(service.apiBaseUrl, service.apiKey, service.mode);

        btn.disabled = false;
        btn.innerHTML = originalHtml;

        if (models.length > 0) {
          renderCustomServiceModels(modelSelect, service.selectedModel, models);
          if (statusEl) {
            statusEl.textContent = `已获取 ${models.length} 个模型`;
            statusEl.className = 'custom-service-status success';
          }
        } else {
          if (statusEl) {
            statusEl.textContent = '获取失败，请检查配置';
            statusEl.className = 'custom-service-status error';
          }
        }

        setTimeout(() => {
          if (statusEl) {
            statusEl.textContent = '';
            statusEl.className = '';
          }
        }, 5000);
      });

      clone.querySelector('.toggle-custom-model-custom').addEventListener('click', () => {
        const btn = clone.querySelector('.toggle-custom-model-custom');

        if (modelInput.style.display === 'none') {
          modelSelect.style.display = 'none';
          modelInput.style.display = 'block';
          btn.innerHTML = `${ICON_LIST}<span>选择列表</span>`;
          modelInput.focus();
        } else {
          modelSelect.style.display = 'block';
          modelInput.style.display = 'none';
          btn.innerHTML = `${ICON_CUSTOM}<span>自定义</span>`;

          if (modelInput.value.trim()) {
            const customModel = modelInput.value.trim();
            const exists = Array.from(modelSelect.options).some(opt => opt.value === customModel);
            if (!exists) {
              const option = document.createElement('option');
              option.value = customModel;
              option.textContent = decorateModelName('custom', customModel) + ' (自定义)';
              modelSelect.appendChild(option);
            }
            modelSelect.value = customModel;
            service.selectedModel = customModel;
          }
        }
      });

      container.appendChild(clone);
    });
  }

  function renderCustomServiceModels(selectElement, selectedModel, models = []) {
    selectElement.innerHTML = '';

    if (models.length === 0) {
      selectElement.innerHTML = '<option value="">输入 API 信息后获取模型</option>';
      if (selectedModel) {
        const option = document.createElement('option');
        option.value = selectedModel;
        option.textContent = decorateModelName('custom', selectedModel) + ' (自定义)';
        option.selected = true;
        selectElement.appendChild(option);
      }
      renderModelSelectWithIcons('custom', selectElement);
      return;
    }

    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = decorateModelName('custom', model.name || model.id);
      if (model.id === selectedModel) {
        option.selected = true;
      }
      selectElement.appendChild(option);
    });
    renderModelSelectWithIcons('custom', selectElement);
  }

  function renderModels(service, selectElement, models, selectedModel) {
    selectElement.innerHTML = '';
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      const base = decorateModelName(service, model.name || model.id);
      option.textContent = model.deprecated ? `${base}（已弃用）` : base;
      if (model.id === selectedModel) {
        option.selected = true;
      }
      selectElement.appendChild(option);
    });

    if (selectedModel && !models.some(m => m.id === selectedModel)) {
      const option = document.createElement('option');
      option.value = selectedModel;
      option.textContent = decorateModelName(service, selectedModel) + ' (自定义)';
      option.selected = true;
      selectElement.appendChild(option);
    }
    renderModelSelectWithIcons(service, selectElement);
  }

  async function fetchModelsViaBackground(service, apiKey, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('background getModels timeout')), timeoutMs);
      chrome.runtime.sendMessage({ action: 'getModels', service, apiKey }, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(Array.isArray(response?.models) ? response.models : []);
      });
    });
  }

  async function fetchRemoteModelsWithFallback(service, apiKey) {
    if (!apiKey || !apiKey.trim()) {
      return [];
    }

    // Background fetch first
    try {
      const fromBg = await fetchModelsViaBackground(service, apiKey);
      if (fromBg.length > 0) return fromBg;
    } catch (e) {
      console.warn(`background 获取 ${service} 模型失败，回退前端直连:`, e?.message || e);
    }

    try {
      const fetchFunctions = {
        openai: fetchOpenAIModels,
        openrouter: fetchOpenRouterModels,
        kimi: fetchKimiModels,
        deepseek: fetchDeepSeekModels,
        aliyun: fetchAliyunModels,
        zhipu: fetchZhipuModels,
        gemini: fetchGeminiModels,
        claude: fetchClaudeModels
      };

      const fetchFunc = fetchFunctions[service];
      if (!fetchFunc) {
        console.warn(`未知服务: ${service}`);
        return [];
      }

      return await fetchFunc(apiKey);
    } catch (error) {
      console.error(`获取 ${service} 模型列表失败:`, error);
      return [];
    }
  }

  async function fetchRemoteModels(service, selectElement, apiKey, selectedModel) {
    const models = await fetchRemoteModelsWithFallback(service, apiKey);

    if (models.length > 0) {
      const mergedModels = [...(DEFAULT_MODELS[service] || [])];
      models.forEach(remoteModel => {
        if (!mergedModels.some(m => m.id === remoteModel.id)) {
          mergedModels.push(remoteModel);
        }
      });
      renderModels(service, selectElement, mergedModels, selectedModel);
      return true;
    }
    return false;
  }

  async function fetchCustomModels(apiBaseUrl, apiKey, mode) {
    try {
      if (mode === 'anthropic') {
        return await fetchAnthropicModels(apiBaseUrl, apiKey);
      } else {
        return await fetchGenericOpenAIModels(apiBaseUrl, apiKey);
      }
    } catch (error) {
      console.error('获取自定义服务模型失败:', error);
      return [];
    }
  }

  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
      }
      return response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchGenericOpenAIModels(apiBaseUrl, apiKey) {
    const baseUrl = apiBaseUrl.trim().replace(/\/$/, '');
    const data = await fetchJsonWithTimeout(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    return (data.data || [])
      .map(m => ({ id: m.id, name: m.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async function fetchAnthropicModels(apiBaseUrl, apiKey) {
    const baseUrl = apiBaseUrl.trim().replace(/\/$/, '');
    const data = await fetchJsonWithTimeout(`${baseUrl}/models`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    });
    const list = Array.isArray(data?.data)
      ? data.data
      : (Array.isArray(data?.models) ? data.models : []);
    return list
      .map(m => ({ id: m.id, name: m.display_name || m.name || m.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function isTranslationSuitableModel(id) {
    if (!id) return false;
    const lower = String(id).toLowerCase();
    const exclude = [
      'embed', 'embedding', 'bge-', 'gte-',
      'tts', 'whisper', 'audio', 'speech',
      'dall-e', 'imagen', 'veo', 'lyria', 'cogview', 'cogvideox',
      'moderation', 'aqa', 'robotics',
      'codegeex',
      '-image-', 'flash-image', 'image-', 'pro-image',
      'native-audio', 'preview-tts', 'flash-live',
      'computer-use', 'deep-research',
    ];
    return !exclude.some(k => lower.includes(k));
  }

  async function fetchOpenAIModels(apiKey) {
    try {
      const data = await fetchJsonWithTimeout('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      return data.data
        .filter(m => m.id.includes('gpt') && isTranslationSuitableModel(m.id))
        .map(m => ({ id: m.id, name: m.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (error) {
      console.error('OpenAI API 错误:', error);
      return [];
    }
  }

  async function fetchOpenRouterModels(apiKey) {
    try {
      const data = await fetchJsonWithTimeout('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      return data.data
        .filter(m => isTranslationSuitableModel(m.id))
        .map(m => ({ id: m.id, name: m.name || m.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (error) {
      console.error('OpenRouter API 错误:', error);
      return [];
    }
  }

  async function fetchKimiModels(apiKey) {
    try {
      const data = await fetchJsonWithTimeout('https://api.moonshot.cn/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (!data.data || !Array.isArray(data.data)) return [];
      return data.data
        .filter(m => isTranslationSuitableModel(m.id))
        .map(m => ({ id: m.id, name: m.id || m.name }));
    } catch (error) {
      console.error('Kimi API 错误:', error);
      return [];
    }
  }

  async function fetchDeepSeekModels(apiKey) {
    try {
      const data = await fetchJsonWithTimeout('https://api.deepseek.com/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      return data.data
        .filter(m => isTranslationSuitableModel(m.id))
        .map(m => ({ id: m.id, name: m.id }));
    } catch (error) {
      console.error('DeepSeek API 错误:', error);
      return [];
    }
  }

  async function fetchAliyunModels(apiKey) {
    try {
      const data = await fetchJsonWithTimeout('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      return data.data
        .filter(m => (m.id.startsWith('qwen') || m.id.startsWith('deepseek')) && isTranslationSuitableModel(m.id))
        .map(m => ({ id: m.id, name: m.id }));
    } catch (error) {
      console.error('阿里云百炼 API 错误:', error);
      return [];
    }
  }

  async function fetchZhipuModels(apiKey) {
    try {
      const data = await fetchJsonWithTimeout('https://open.bigmodel.cn/api/paas/v4/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      return (data.data || [])
        .filter(m => isTranslationSuitableModel(m.id))
        .map(m => ({ id: m.id, name: m.id }));
    } catch (error) {
      console.error('智谱清言 API 错误:', error);
      return [];
    }
  }

  async function fetchGeminiModels(apiKey) {
    try {
      const data = await fetchJsonWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      );
      return (data.models || [])
        .filter(m => m.name && m.supportedGenerationMethods?.includes('generateContent') && isTranslationSuitableModel(m.name))
        .map(m => {
          const id = m.name.replace('models/', '');
          return { id, name: m.displayName || id };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (error) {
      console.error('Gemini API 错误:', error);
      return [];
    }
  }

  // Claude: static model list (Anthropic has no public models list API)
  async function fetchClaudeModels(_apiKey) {
    return DEFAULT_MODELS.claude;
  }

  function getServiceName(service) {
    const names = {
      'microsoft-free': 'Microsoft 免费翻译',
      'google-free': 'Google 免费翻译',
      kimi: 'Kimi',
      zhipu: '智谱清言',
      aliyun: '阿里百炼',
      deepseek: 'DeepSeek',
      openai: 'OpenAI',
      openrouter: 'OpenRouter',
      gemini: 'Google Gemini',
      claude: 'Claude',
      deepl: 'DeepL'
    };
    return names[service] || service;
  }

  function loadConfig() {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        console.warn('loadConfig timed out, returning empty config');
        resolve({});
      }, 1000);

      try {
        chrome.runtime.sendMessage({ action: 'getConfig' }, (config) => {
          clearTimeout(timeoutId);
          if (chrome.runtime.lastError) {
            console.error('加载配置失败:', chrome.runtime.lastError);
            resolve({});
          } else {
            resolve(config || {});
          }
        });
      } catch (e) {
        clearTimeout(timeoutId);
        console.error('loadConfig execution error:', e);
        resolve({});
      }
    });
  }

  function saveConfig(config) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'saveConfig',
        config: config
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.success === false) {
          reject(new Error(response.error || '保存失败'));
          return;
        }
        resolve();
      });
    });
  }

  function showStatus(text, type) {
    const status = document.getElementById('saveStatus');
    status.textContent = text;
    status.className = type;
    setTimeout(() => {
      status.textContent = '';
      status.className = '';
    }, 5000);
  }
});
