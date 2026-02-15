// ZDFTranslate - Options Script
// 处理设置页面的逻辑

// 辅助函数：生成唯一 ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

document.addEventListener('DOMContentLoaded', async () => {
  // 定义全局状态
  let customServices = [];
  
  // 提前绑定添加按钮事件
  const addBtn = document.getElementById('addCustomServiceBtn');
  if (addBtn) {
    addBtn.disabled = true; // 加载期间禁用
    addBtn.textContent = '加载配置中...';
    
    addBtn.addEventListener('click', () => {
      console.log('Adding custom service...');
      try {
        const newService = {
          id: 'custom_' + generateId(),
          name: '自定义服务',
          apiBaseUrl: '',
          apiKey: '',
          mode: 'openai',
          selectedModel: ''
        };
        customServices.push(newService);
        renderCustomServices();
        showStatus('已添加自定义服务，请配置详细信息', 'success');
      } catch (e) {
        console.error('Error adding custom service:', e);
        showStatus('添加服务出错: ' + e.message, 'error');
      }
    });
  } else {
    console.error('Add Custom Service button not found!');
  }

  // 显示真实版本号
  const appVersionEl = document.getElementById('appVersion');
  if (appVersionEl && chrome?.runtime?.getManifest) {
    appVersionEl.textContent = chrome.runtime.getManifest().version;
  }

  // 加载当前配置（兜底，避免页面卡死）
  let config = {};
  try {
    config = await loadConfig();
  } catch (e) {
    console.error('loadConfig failed:', e);
    config = {};
  } finally {
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.textContent = '➕ 添加自定义服务';
    }
  }
  
  // 更新 customServices
  if (Array.isArray(config.customServices)) {
    customServices = config.customServices;
  }
  
  // 模型选择器映射
  
  // 模型选择器映射
  const modelSelectors = {
    kimi: document.getElementById('kimiModel'),
    zhipu: document.getElementById('zhipuModel'),
    aliyun: document.getElementById('aliyunModel'),
    deepseek: document.getElementById('deepseekModel'),
    openai: document.getElementById('openaiModel'),
    openrouter: document.getElementById('openrouterModel')
  };
  
  // 自定义模型输入映射
  const customModelInputs = {
    kimi: document.getElementById('kimiModelCustom'),
    zhipu: document.getElementById('zhipuModelCustom'),
    aliyun: document.getElementById('aliyunModelCustom'),
    deepseek: document.getElementById('deepseekModelCustom'),
    openai: document.getElementById('openaiModelCustom'),
    openrouter: document.getElementById('openrouterModelCustom')
  };
  
  // API Key 输入框映射
  const apiKeyInputs = {
    kimi: document.getElementById('kimiApiKey'),
    zhipu: document.getElementById('zhipuApiKey'),
    aliyun: document.getElementById('aliyunApiKey'),
    deepseek: document.getElementById('deepseekApiKey'),
    openai: document.getElementById('openaiApiKey'),
    openrouter: document.getElementById('openrouterApiKey')
  };
  
  // 默认模型列表（保底用）
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
    ]
  };
  
  // 自定义服务列表（运行时动态维护）
  // let customServices = config.customServices || [];
  
  // 兼容旧版本：把历史默认黑灰色迁移成现代蓝默认值
  const oldDefaultColors = ['#666', '#666666', '#000', '#000000', 'rgb(102, 102, 102)', '#3b82f6'];
  const currentColor = (config.style?.translationColor || '').toLowerCase();
  if (!currentColor || oldDefaultColors.includes(currentColor)) {
    config.style = {
      ...(config.style || {}),
      translationColor: '#111111'
    };
    // 自动保存迁移后的配置，避免下次仍显示旧默认色
    await saveConfig(config);
  }

  // 填充视频翻译设置
  const autoTranslateYouTubeEl = document.getElementById('autoTranslateYouTube');
  if (autoTranslateYouTubeEl) {
    autoTranslateYouTubeEl.checked = config.autoTranslateYouTube !== false; // 默认为 true
  }
  
  const autoEnableYouTubeCCEl = document.getElementById('autoEnableYouTubeCC');
  if (autoEnableYouTubeCCEl) {
    autoEnableYouTubeCCEl.checked = config.autoEnableYouTubeCC !== false; // 默认为 true
  }

  // 填充表单 - API Keys
  apiKeyInputs.kimi.value = config.apiKeys?.kimi || '';
  apiKeyInputs.zhipu.value = config.apiKeys?.zhipu || '';
  apiKeyInputs.aliyun.value = config.apiKeys?.aliyun || '';
  apiKeyInputs.deepseek.value = config.apiKeys?.deepseek || '';
  document.getElementById('googleApiKey').value = config.apiKeys?.google || '';
  document.getElementById('deeplApiKey').value = config.apiKeys?.deepl || '';
  apiKeyInputs.openai.value = config.apiKeys?.openai || '';
  if (apiKeyInputs.openrouter) {
    apiKeyInputs.openrouter.value = config.apiKeys?.openrouter || '';
  }
  
  // 外观设置
  document.getElementById('translationColor').value = config.style?.translationColor || '#111111';
  document.getElementById('translationSize').value = config.style?.translationSize || '0.95em';
  document.getElementById('lineSpacing').value = config.style?.lineSpacing || '1.6';
  document.getElementById('backgroundHighlight').checked = config.style?.backgroundHighlight || false;
  document.getElementById('showWatermark').checked = config.style?.showWatermark !== false; // 默认开启
  document.getElementById('excludedSites').value = (config.excludedSites || []).join('\n');

  // 初始化所有模型选择器
  for (const [service, select] of Object.entries(modelSelectors)) {
    if (select) {
      renderModels(service, select, DEFAULT_MODELS[service] || [], config.selectedModels?.[service]);
      
      // 如果有 API Key，尝试获取远程模型列表（但不覆盖默认模型）
      const apiKey = apiKeyInputs[service]?.value;
      if (apiKey) {
        try {
          const models = await fetchRemoteModelsWithFallback(service, apiKey);
          if (models.length > 0) {
            // 合并远程模型和默认模型，避免重复
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
  
  // 初始化自定义模型输入
  for (const [service, input] of Object.entries(customModelInputs)) {
    if (input && config.selectedModels?.[service]) {
      // 如果当前选择的模型不在默认列表中，显示在自定义输入框
      const defaultModels = DEFAULT_MODELS[service] || [];
      const isCustom = !defaultModels.some(m => m.id === config.selectedModels[service]);
      if (isCustom) {
        input.value = config.selectedModels[service];
      }
    }
  }
  
  // 初始化自定义服务列表
  renderCustomServices();

  // 刷新模型按钮事件
  document.querySelectorAll('.refresh-models').forEach(btn => {
    btn.addEventListener('click', async () => {
      const service = btn.dataset.service;
      const select = modelSelectors[service];
      const apiKey = apiKeyInputs[service]?.value;
      const statusEl = document.getElementById(`${service}Status`);
      
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = '获取中...';
      
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
        btn.textContent = originalText;
        return;
      }
      
      const success = await fetchRemoteModels(service, select, apiKey, select.value);
      
      btn.disabled = false;
      btn.textContent = originalText;
      
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
  
  // 自定义模型切换按钮事件
  document.querySelectorAll('.toggle-custom-model').forEach(btn => {
    btn.addEventListener('click', () => {
      const service = btn.dataset.service;
      const select = modelSelectors[service];
      const input = customModelInputs[service];
      
      if (!input) return;
      
      if (input.style.display === 'none') {
        // 切换到自定义输入
        select.style.display = 'none';
        input.style.display = 'block';
        btn.textContent = '📋 选择列表';
        input.focus();
      } else {
        // 切换到选择列表
        select.style.display = 'block';
        input.style.display = 'none';
        btn.textContent = '✏️ 自定义';
        
        // 如果输入框有值，添加到选择列表并选中
        if (input.value.trim()) {
          const customModel = input.value.trim();
          const exists = Array.from(select.options).some(opt => opt.value === customModel);
          if (!exists) {
            const option = document.createElement('option');
            option.value = customModel;
            option.textContent = customModel + ' (自定义)';
            select.appendChild(option);
          }
          select.value = customModel;
        }
      }
    });
  });
  
  // 添加自定义服务按钮事件 (已移至顶部)

  // 保存按钮
  document.getElementById('saveBtn').addEventListener('click', async () => {
    try {
      // 收集选中的模型
      const selectedModels = {};
      for (const [service, select] of Object.entries(modelSelectors)) {
        if (select) {
          const input = customModelInputs[service];
          // 优先使用自定义输入的值（如果可见）
          if (input && input.style.display !== 'none' && input.value.trim()) {
            selectedModels[service] = input.value.trim();
          } else {
            selectedModels[service] = select.value;
          }
        }
      }
      
      // 收集自定义服务的模型选择
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
      
      // 获取视频翻译设置
      const autoTranslateYouTubeEl = document.getElementById('autoTranslateYouTube');
      const autoEnableYouTubeCCEl = document.getElementById('autoEnableYouTubeCC');
      
      const newConfig = {
        ...config,
        autoTranslateYouTube: autoTranslateYouTubeEl ? autoTranslateYouTubeEl.checked : true,
        autoEnableYouTubeCC: autoEnableYouTubeCCEl ? autoEnableYouTubeCCEl.checked : true,
        apiKeys: {
          kimi: apiKeyInputs.kimi.value.trim(),
          zhipu: apiKeyInputs.zhipu.value.trim(),
          aliyun: apiKeyInputs.aliyun.value.trim(),
          deepseek: apiKeyInputs.deepseek.value.trim(),
          google: document.getElementById('googleApiKey').value.trim(),
          deepl: document.getElementById('deeplApiKey').value.trim(),
          openai: apiKeyInputs.openai.value.trim(),
          openrouter: apiKeyInputs.openrouter ? apiKeyInputs.openrouter.value.trim() : ''
        },
        selectedModels: selectedModels,
        customServices: customServices,
        style: {
          translationColor: document.getElementById('translationColor').value,
          translationSize: document.getElementById('translationSize').value,
          lineSpacing: document.getElementById('lineSpacing').value,
          backgroundHighlight: document.getElementById('backgroundHighlight').checked,
          showWatermark: document.getElementById('showWatermark').checked
        },
        excludedSites: document.getElementById('excludedSites').value
          .split('\n')
          .map(s => s.trim())
          .filter(s => s.length > 0)
      };

      await saveConfig(newConfig);
      showStatus('设置已保存！', 'success');
    } catch (error) {
      console.error('保存失败:', error);
      showStatus('保存失败：' + error.message, 'error');
    }
  });

  // 重置按钮
  document.getElementById('resetBtn').addEventListener('click', async () => {
    if (confirm('确定要恢复默认设置吗？')) {
      const defaultConfig = {
        enabled: true,
        targetLang: 'zh-CN',
        sourceLang: 'auto',
        displayMode: 'bilingual',
        translationService: 'libretranslate',
        autoTranslateYouTube: true, // 默认开启
        autoEnableYouTubeCC: true, // 默认开启
        selectedModels: {
          kimi: 'moonshot-v1-8k',
          zhipu: 'glm-4-flash',
          aliyun: 'qwen-turbo',
          deepseek: 'deepseek-chat',
          openai: 'gpt-3.5-turbo',
          openrouter: 'openai/gpt-4o-mini'
        },
        apiKeys: { 
          kimi: '', zhipu: '', aliyun: '', deepseek: '',
          google: '', deepl: '', openai: '', openrouter: '' 
        },
        customServices: [],
        excludedSites: [],
        style: {
          translationColor: '#111111',
          translationSize: '0.95em',
          lineSpacing: '1.6',
          backgroundHighlight: false,
          showWatermark: true
        }
      };
      
      await saveConfig(defaultConfig);
      location.reload();
    }
  });
  
  // 渲染自定义服务列表
  function renderCustomServices() {
    const container = document.getElementById('customServicesContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    customServices.forEach(service => {
      const template = document.getElementById('customServiceTemplate');
      if (!template) return;
      
      const clone = template.firstElementChild.cloneNode(true);
      clone.dataset.serviceId = service.id;
      
      // 填充数据
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
      
      // 渲染模型列表
      renderCustomServiceModels(modelSelect, service.selectedModel);
      
      // 如果是自定义模型，显示在输入框
      if (service.selectedModel && modelSelect.querySelector(`option[value="${service.selectedModel}"]`)?.textContent?.includes('(自定义)')) {
        modelSelect.style.display = 'none';
        modelInput.style.display = 'block';
        modelInput.value = service.selectedModel;
        clone.querySelector('.toggle-custom-model-custom').textContent = '📋 选择列表';
      }
      
      // 绑定事件
      nameInput.addEventListener('change', () => {
        service.name = nameInput.value;
      });
      
      baseUrlInput.addEventListener('change', () => {
        service.apiBaseUrl = baseUrlInput.value;
      });
      
      apiKeyInput.addEventListener('change', () => {
        service.apiKey = apiKeyInput.value;
      });
      
      modeSelect.addEventListener('change', () => {
        service.mode = modeSelect.value;
      });
      
      modelSelect.addEventListener('change', () => {
        service.selectedModel = modelSelect.value;
      });
      
      modelInput.addEventListener('change', () => {
        service.selectedModel = modelInput.value;
      });
      
      // 删除按钮
      clone.querySelector('.delete-custom-service').addEventListener('click', () => {
        if (confirm(`确定要删除自定义服务 "${service.name}" 吗？`)) {
          customServices = customServices.filter(s => s.id !== service.id);
          renderCustomServices();
          showStatus('已删除自定义服务', 'success');
        }
      });
      
      // 获取模型按钮
      clone.querySelector('.refresh-custom-models').addEventListener('click', async () => {
        const btn = clone.querySelector('.refresh-custom-models');
        const statusEl = clone.querySelector('.custom-service-status');
        
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = '获取中...';
        
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
          btn.textContent = originalText;
          return;
        }
        
        const models = await fetchCustomModels(service.apiBaseUrl, service.apiKey, service.mode);
        
        btn.disabled = false;
        btn.textContent = originalText;
        
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
      
      // 自定义模型切换按钮
      clone.querySelector('.toggle-custom-model-custom').addEventListener('click', () => {
        const btn = clone.querySelector('.toggle-custom-model-custom');
        
        if (modelInput.style.display === 'none') {
          modelSelect.style.display = 'none';
          modelInput.style.display = 'block';
          btn.textContent = '📋 选择列表';
          modelInput.focus();
        } else {
          modelSelect.style.display = 'block';
          modelInput.style.display = 'none';
          btn.textContent = '✏️ 自定义';
          
          if (modelInput.value.trim()) {
            const customModel = modelInput.value.trim();
            const exists = Array.from(modelSelect.options).some(opt => opt.value === customModel);
            if (!exists) {
              const option = document.createElement('option');
              option.value = customModel;
              option.textContent = customModel + ' (自定义)';
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
  
  // 渲染自定义服务模型列表
  function renderCustomServiceModels(selectElement, selectedModel, models = []) {
    selectElement.innerHTML = '';
    
    if (models.length === 0) {
      selectElement.innerHTML = '<option value="">输入 API 信息后获取模型</option>';
      if (selectedModel) {
        const option = document.createElement('option');
        option.value = selectedModel;
        option.textContent = selectedModel + ' (自定义)';
        option.selected = true;
        selectElement.appendChild(option);
      }
      return;
    }
    
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name;
      if (model.id === selectedModel) {
        option.selected = true;
      }
      selectElement.appendChild(option);
    });
  }

  // 渲染模型列表
  function renderModels(service, selectElement, models, selectedModel) {
    selectElement.innerHTML = '';
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name;
      if (model.id === selectedModel) {
        option.selected = true;
      }
      selectElement.appendChild(option);
    });
    
    // 如果当前选中的模型不在列表中，添加它（兼容自定义模型）
    if (selectedModel && !models.some(m => m.id === selectedModel)) {
      const option = document.createElement('option');
      option.value = selectedModel;
      option.textContent = selectedModel + ' (自定义)';
      option.selected = true;
      selectElement.appendChild(option);
    }
  }

  // 从远程获取模型列表（返回模型数组，不直接渲染）
  async function fetchRemoteModelsWithFallback(service, apiKey) {
    if (!apiKey || !apiKey.trim()) {
      return [];
    }
    
    try {
      const fetchFunctions = {
        openai: fetchOpenAIModels,
        openrouter: fetchOpenRouterModels,
        kimi: fetchKimiModels,
        deepseek: fetchDeepSeekModels,
        aliyun: fetchAliyunModels,
        zhipu: fetchZhipuModels
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
  
  // 从远程获取模型列表并渲染（用于按钮点击）
  async function fetchRemoteModels(service, selectElement, apiKey, selectedModel) {
    const models = await fetchRemoteModelsWithFallback(service, apiKey);
    
    if (models.length > 0) {
      // 合并远程模型和默认模型
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
  
  // 获取自定义服务模型列表
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
  
  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 12000) {
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

  // 通用 OpenAI 格式模型获取
  async function fetchGenericOpenAIModels(apiBaseUrl, apiKey) {
    const baseUrl = apiBaseUrl.trim().replace(/\/$/, '');
    const data = await fetchJsonWithTimeout(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    return (data.data || [])
      .map(m => ({ id: m.id, name: m.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  
  // Anthropic 格式模型获取
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

  // OpenAI 模型列表
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
  
  // OpenRouter 模型列表
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

  // Kimi 模型列表
  async function fetchKimiModels(apiKey) {
    try {
      const data = await fetchJsonWithTimeout('https://api.moonshot.cn/v1/models', {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!data.data || !Array.isArray(data.data)) {
        console.error('Kimi API 返回格式错误:', data);
        return [];
      }
      
      return data.data.map(m => ({ id: m.id, name: m.id || m.name }));
    } catch (error) {
      console.error('Kimi API 错误:', error);
      return [];
    }
  }

  // DeepSeek 模型列表
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

  // 阿里云百炼模型列表
  async function fetchAliyunModels(apiKey) {
    try {
      // 阿里云百炼兼容 OpenAI API 格式
      const data = await fetchJsonWithTimeout('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      // 过滤出支持的模型
      return data.data
        .filter(m => m.id.startsWith('qwen') || m.id.startsWith('deepseek'))
        .map(m => ({ id: m.id, name: m.id }));
    } catch (error) {
      console.error('阿里云百炼 API 错误:', error);
      return [];
    }
  }

  // 智谱清言模型列表
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
  
  // 生成唯一 ID (已移至顶部)
  // 获取服务显示名称
  function getServiceName(service) {
    const names = {
      kimi: 'Kimi',
      zhipu: '智谱清言',
      aliyun: '阿里云',
      deepseek: 'DeepSeek',
      openai: 'OpenAI',
      openrouter: 'OpenRouter'
    };
    return names[service] || service;
  }

  // 加载配置
  function loadConfig() {
    return new Promise((resolve, reject) => {
      // 增加超时处理，防止 background script 无响应导致死锁
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

  // 保存配置
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

  // 显示状态
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