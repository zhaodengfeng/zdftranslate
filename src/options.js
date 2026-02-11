// ZDFTranslate - Options Script
// 处理设置页面的逻辑

document.addEventListener('DOMContentLoaded', async () => {
  // 显示真实版本号
  const appVersionEl = document.getElementById('appVersion');
  if (appVersionEl && chrome?.runtime?.getManifest) {
    appVersionEl.textContent = chrome.runtime.getManifest().version;
  }

  // 加载当前配置
  const config = await loadConfig();
  
  // 模型选择器映射
  const modelSelectors = {
    kimi: document.getElementById('kimiModel'),
    zhipu: document.getElementById('zhipuModel'),
    aliyun: document.getElementById('aliyunModel'),
    deepseek: document.getElementById('deepseekModel'),
    openai: document.getElementById('openaiModel')
  };
  
  // 自定义模型输入映射
  const customModelInputs = {
    kimi: document.getElementById('kimiModelCustom'),
    zhipu: document.getElementById('zhipuModelCustom'),
    aliyun: document.getElementById('aliyunModelCustom'),
    deepseek: document.getElementById('deepseekModelCustom'),
    openai: document.getElementById('openaiModelCustom')
  };
  
  // API Key 输入框映射
  const apiKeyInputs = {
    kimi: document.getElementById('kimiApiKey'),
    zhipu: document.getElementById('zhipuApiKey'),
    aliyun: document.getElementById('aliyunApiKey'),
    deepseek: document.getElementById('deepseekApiKey'),
    openai: document.getElementById('openaiApiKey')
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
    ]
  };
  
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
  
  // 外观设置
  document.getElementById('translationColor').value = config.style?.translationColor || '#111111';
  document.getElementById('translationSize').value = config.style?.translationSize || '0.95em';
  document.getElementById('lineSpacing').value = config.style?.lineSpacing || '1.6';
  document.getElementById('backgroundHighlight').checked = config.style?.backgroundHighlight || false;
  document.getElementById('excludedSites').value = (config.excludedSites || []).join('\n');

  // 初始化所有模型选择器
  for (const [service, select] of Object.entries(modelSelectors)) {
    if (select) {
      renderModels(service, select, DEFAULT_MODELS[service], config.selectedModels?.[service]);
      
      // 如果有 API Key，尝试获取远程模型列表（但不覆盖默认模型）
      const apiKey = apiKeyInputs[service]?.value;
      if (apiKey) {
        try {
          const models = await fetchRemoteModelsWithFallback(service, apiKey);
          if (models.length > 0) {
            // 合并远程模型和默认模型，避免重复
            const mergedModels = [...DEFAULT_MODELS[service]];
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
      const isCustom = !DEFAULT_MODELS[service].some(m => m.id === config.selectedModels[service]);
      if (isCustom) {
        input.value = config.selectedModels[service];
      }
    }
  }

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
          openai: apiKeyInputs.openai.value.trim()
        },
        selectedModels: selectedModels,
        style: {
          translationColor: document.getElementById('translationColor').value,
          translationSize: document.getElementById('translationSize').value,
          lineSpacing: document.getElementById('lineSpacing').value,
          backgroundHighlight: document.getElementById('backgroundHighlight').checked
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
        translationService: 'kimi',
        autoTranslateYouTube: true, // 默认开启
        autoEnableYouTubeCC: true, // 默认开启
        selectedModels: {
          kimi: 'moonshot-v1-8k',
          zhipu: 'glm-4-flash',
          aliyun: 'qwen-turbo',
          deepseek: 'deepseek-chat',
          openai: 'gpt-3.5-turbo'
        },
        apiKeys: { 
          kimi: '', zhipu: '', aliyun: '', deepseek: '',
          google: '', deepl: '', openai: '' 
        },
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
      const mergedModels = [...DEFAULT_MODELS[service]];
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

  // OpenAI 模型列表
  async function fetchOpenAIModels(apiKey) {
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
      console.error('OpenAI API 错误:', error);
      return [];
    }
  }

  // Kimi 模型列表
  async function fetchKimiModels(apiKey) {
    try {
      const response = await fetch('https://api.moonshot.cn/v1/models', {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }
      
      const data = await response.json();
      
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
      const response = await fetch('https://api.deepseek.com/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      
      if (!response.ok) throw new Error('Failed to fetch models');
      
      const data = await response.json();
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
      const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      
      if (!response.ok) throw new Error('Failed to fetch models');
      
      const data = await response.json();
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
      const response = await fetch('https://open.bigmodel.cn/api/paas/v4/models', {
        headers: { 'Authorization': apiKey }
      });
      
      if (!response.ok) throw new Error('Failed to fetch models');
      
      const data = await response.json();
      return data.data.map(m => ({ id: m.id, name: m.id }));
    } catch (error) {
      console.error('智谱清言 API 错误:', error);
      return [];
    }
  }

  // 获取服务显示名称
  function getServiceName(service) {
    const names = {
      kimi: 'Kimi',
      zhipu: '智谱清言',
      aliyun: '阿里云',
      deepseek: 'DeepSeek',
      openai: 'OpenAI'
    };
    return names[service] || service;
  }

  // 加载配置
  function loadConfig() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getConfig' }, (config) => {
        if (chrome.runtime.lastError) {
          console.error('加载配置失败:', chrome.runtime.lastError);
          resolve({});
        } else {
          resolve(config || {});
        }
      });
    });
  }

  // 保存配置
  function saveConfig(config) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'saveConfig',
        config: config
      }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
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
