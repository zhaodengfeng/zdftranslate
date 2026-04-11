// ZDFTranslate - Options Script (Slim Edition)

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

document.addEventListener('DOMContentLoaded', async () => {
  let customServices = [];

  const ADD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

  const BRAND_ICON_PATHS = {
    openai: 'assets/providers/openai.png',
    openrouter: 'assets/providers/openrouter.png',
    kimi: 'assets/providers/kimi.png',
    deepseek: 'assets/providers/deepseek.png',
    zhipu: 'assets/providers/zhipu.png',
    aliyun: 'assets/providers/aliyun.png',
    gemini: 'assets/providers/google.png',
    claude: 'assets/providers/openai.png',
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
    const secGlobal = document.getElementById('sec-global');

    const freeServices = new Set(['microsoft-free', 'google-free']);
    if (freeServices.has(service)) {
      if (secCn) secCn.style.display = 'none';
      if (secGlobal) secGlobal.style.display = 'none';
      return;
    }

    const cnServices = new Set(['kimi', 'zhipu', 'aliyun', 'deepseek']);
    const globalServices = new Set(['deepl', 'gemini', 'openai', 'claude', 'openrouter']);

    if (secCn) secCn.style.display = cnServices.has(service) ? '' : 'none';
    if (secGlobal) secGlobal.style.display = globalServices.has(service) ? '' : 'none';
    // custom-service-divider is a standalone section, handled by groups['custom'] above
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
      { id: 'moonshot-v1-8k', name: 'Moonshot v1 (8K)' },
      { id: 'moonshot-v1-32k', name: 'Moonshot v1 (32K)' },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 (128K)' }
    ],
    zhipu: [
      { id: 'glm-4-flash', name: 'GLM-4 Flash (免费)' },
      { id: 'glm-4', name: 'GLM-4' },
      { id: 'glm-4-plus', name: 'GLM-4 Plus' },
      { id: 'glm-4-air', name: 'GLM-4 Air' },
      { id: 'glm-4v', name: 'GLM-4V' },
      { id: 'glm-4.5', name: 'GLM-4.5' },
      { id: 'glm-4.6', name: 'GLM-4.6' },
      { id: 'glm-4.7', name: 'GLM-4.7' }
    ],
    aliyun: [
      { id: 'qwen-turbo', name: '通义千问 Turbo' },
      { id: 'qwen-plus', name: '通义千问 Plus' },
      { id: 'qwen-max', name: '通义千问 Max' },
      { id: 'qwen-max-latest', name: '通义千问 Max (最新)' },
      { id: 'qwen-coder-plus', name: '通义千问 Coder Plus' },
      { id: 'qwen-long', name: '通义千问 Long' }
    ],
    deepseek: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat' },
      { id: 'deepseek-coder', name: 'DeepSeek Coder' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' }
    ],
    openai: [
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
      { id: 'gpt-4', name: 'GPT-4' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' }
    ],
    openrouter: [
      { id: 'openai/gpt-4o', name: 'GPT-4o (OpenAI)' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (OpenAI)' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
      { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus' },
      { id: 'google/gemini-pro', name: 'Gemini Pro' },
      { id: 'meta-llama/llama-3-70b-instruct', name: 'Llama 3 70B' },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' }
    ],
    gemini: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' }
    ],
    claude: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
      { id: 'claude-haiku-4-20250514', name: 'Claude Haiku 4' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' }
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
  document.getElementById('translationColor').value = config.style?.translationColor || '#111111';
  document.getElementById('translationSize').value = config.style?.translationSize || '0.95em';
  document.getElementById('lineSpacing').value = config.style?.lineSpacing || '1.6';
  document.getElementById('backgroundHighlight').checked = config.style?.backgroundHighlight || false;

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

  // Sidebar removed in new design — no-op

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
          translationColor: document.getElementById('translationColor').value,
          translationSize: document.getElementById('translationSize').value,
          lineSpacing: document.getElementById('lineSpacing').value,
          backgroundHighlight: document.getElementById('backgroundHighlight').checked
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
          kimi: 'moonshot-v1-8k',
          zhipu: 'glm-4-flash',
          aliyun: 'qwen-turbo',
          deepseek: 'deepseek-chat',
          openai: 'gpt-3.5-turbo',
          openrouter: 'openai/gpt-4o-mini',
          gemini: 'gemini-2.0-flash',
          claude: 'claude-sonnet-4-20250514'
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
          backgroundHighlight: false
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
      option.textContent = decorateModelName(service, model.name || model.id);
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

  async function fetchOpenAIModels(apiKey) {
    try {
      const data = await fetchJsonWithTimeout('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      return data.data
        .filter(m => m.id.includes('gpt'))
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
      return data.data.map(m => ({ id: m.id, name: m.id || m.name }));
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
      return data.data.map(m => ({ id: m.id, name: m.id }));
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
        .filter(m => m.id.startsWith('qwen') || m.id.startsWith('deepseek'))
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
      return (data.data || []).map(m => ({ id: m.id, name: m.id }));
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
        .filter(m => m.name && m.supportedGenerationMethods?.includes('generateContent'))
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
