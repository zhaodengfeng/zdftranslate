// ZDFTranslate - Popup Script
// 处理弹出窗口的交互逻辑

document.addEventListener('DOMContentLoaded', async () => {
  // 获取DOM元素
  const sourceLang = document.getElementById('sourceLang');
  const targetLang = document.getElementById('targetLang');
  const translationService = document.getElementById('translationService');
  const statusToast = document.getElementById('statusToast');
  const openOptions = document.getElementById('openOptions');
  const popupVersion = document.getElementById('popupVersion');

  if (popupVersion && chrome?.runtime?.getManifest) {
    popupVersion.textContent = `v${chrome.runtime.getManifest().version}`;
  }

  // 当前页面翻译状态
  let isTranslated = false;
  let currentTabId = null;

  // 事件监听 - 提前绑定设置按钮，防止卡死
  if (openOptions) {
    openOptions.addEventListener('click', (e) => {
      e.preventDefault();
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('options.html'));
      }
    });
  }

  const SERVICE_ICON_PATHS = {
    'microsoft-free': 'assets/providers/microsoft.svg',
    'google-free': 'assets/providers/google.png',
    aliyun: 'assets/providers/aliyun.png',
    kimi: 'assets/providers/kimi.png',
    zhipu: 'assets/providers/zhipu.png',
    deepseek: 'assets/providers/deepseek.png',
    gemini: 'assets/providers/google.png',
    claude: 'assets/providers/openai.png',
    deepl: 'assets/providers/deepl.svg',
    openai: 'assets/providers/openai.png',
    openrouter: 'assets/providers/openrouter.png',
    custom: 'assets/providers/custom.png',
  };

  function serviceIcon(serviceId) {
    if (String(serviceId || '').startsWith('custom_')) return SERVICE_ICON_PATHS.custom;
    return SERVICE_ICON_PATHS[serviceId] || SERVICE_ICON_PATHS.custom;
  }

  function renderServiceSelectWithIcons() {
    const card = translationService?.closest('.service-card');
    if (!card) return;

    let rich = card.querySelector('.service-select-rich');
    if (!rich) {
      rich = document.createElement('div');
      rich.className = 'service-select-rich';
      rich.innerHTML = '<button type="button" class="service-select-trigger"></button><div class="service-select-menu"></div>';
      card.appendChild(rich);

      document.addEventListener('click', (e) => {
        if (!rich.contains(e.target)) rich.classList.remove('open');
      });
    }

    const trigger = rich.querySelector('.service-select-trigger');
    const menu = rich.querySelector('.service-select-menu');
    const options = Array.from(translationService.options || []);
    const selected = options.find(o => o.value === translationService.value) || options[0];

    if (selected) {
      trigger.innerHTML = `<img src="${serviceIcon(selected.value)}" class="service-icon" alt=""><span class="service-text">${selected.textContent || ''}</span><span class="service-caret">▾</span>`;
    }

    menu.innerHTML = '';
    options.forEach((opt) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'service-select-item';
      if (opt.disabled) item.classList.add('disabled');
      if (opt.value === translationService.value) item.classList.add('active');
      item.innerHTML = `<img src="${serviceIcon(opt.value)}" class="service-icon" alt=""><span class="service-text">${opt.textContent || ''}</span>`;
      item.addEventListener('click', async () => {
        if (opt.disabled) return;
        translationService.value = opt.value;
        translationService.dispatchEvent(new Event('change', { bubbles: true }));
        rich.classList.remove('open');
        renderServiceSelectWithIcons();
      });
      menu.appendChild(item);
    });

    trigger.onclick = () => {
      const willOpen = !rich.classList.contains('open');
      rich.classList.toggle('open');
      if (willOpen) {
        const triggerRect = trigger.getBoundingClientRect();
        const spaceBelow = window.innerHeight - triggerRect.bottom;
        const spaceAbove = triggerRect.top;
        const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
        rich.classList.toggle('open-up', openUp);
        const available = Math.max(120, Math.min(240, (openUp ? spaceAbove : spaceBelow) - 12));
        menu.style.maxHeight = `${available}px`;
      }
    };
    translationService.style.display = 'none';
  }

  function validateCustomServiceRequired(service) {
    const name = (service?.name || '').trim();
    const apiBaseUrl = (service?.apiBaseUrl || '').trim();
    const apiKey = (service?.apiKey || '').trim();
    const selectedModel = (service?.selectedModel || '').trim();

    if (!name || !apiBaseUrl || !apiKey || !selectedModel) return false;

    try {
      const u = new URL(apiBaseUrl);
      if (!/^https?:$/.test(u.protocol)) return false;
    } catch (e) {
      return false;
    }

    return true;
  }

  function hasApiKey(config, serviceId) {
    if (serviceId === 'microsoft-free' || serviceId === 'google-free') return true;

    const apiMap = {
      kimi: 'kimi',
      zhipu: 'zhipu',
      aliyun: 'aliyun',
      deepseek: 'deepseek',
      gemini: 'gemini',
      claude: 'claude',
      deepl: 'deepl',
      openai: 'openai',
      openrouter: 'openrouter'
    };

    const keyField = apiMap[serviceId];
    if (!keyField) return false;
    return !!(config?.apiKeys?.[keyField] || '').trim();
  }

  function applyServiceAvailability(config) {
    const options = Array.from(translationService.options || []);
    options.forEach((option) => {
      const serviceId = option.value;
      const enabled = hasApiKey(config, serviceId);
      option.disabled = !enabled;
    });

    const selectedOption = translationService.options[translationService.selectedIndex];
    if (selectedOption?.disabled) {
      translationService.value = 'microsoft-free';
    }
  }

  // 加载配置和状态
  const config = await loadConfig();
  
  // 动态加载自定义服务选项（只追加有效服务，避免“未命名服务”）
  if (config.customServices?.length > 0) {
    config.customServices
      .filter(validateCustomServiceRequired)
      .forEach(service => {
        const option = document.createElement('option');
        option.value = service.id;
        option.textContent = service.name;
        translationService.appendChild(option);
      });
  }
  
  // 获取当前标签页并刷新状态（优先读 content script，失败再回退 background）
  await refreshTranslationStatus();

  // content script 主动推送状态变更（实时同步）
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.action !== 'translationStatusChanged') return;
    if (!currentTabId || message.tabId !== currentTabId) return;

    isTranslated = !!message.isTranslated;
  });

  // 短轮询兜底：避免极端情况下消息丢失导致状态不同步
  const statusPollingTimer = setInterval(() => {
    refreshTranslationStatus().catch(() => {});
  }, 3000);

  window.addEventListener('unload', () => {
    clearInterval(statusPollingTimer);
  });
  
  // 初始化UI
  sourceLang.value = sourceLang.querySelector(`option[value="${config.sourceLang}"]`) ? config.sourceLang : 'auto';
  targetLang.value = targetLang.querySelector(`option[value="${config.targetLang}"]`) ? config.targetLang : 'zh-CN';
  
  // 初始化显示模式 Radio Group
  const normalizeDisplayMode = (mode) => {
    if (mode === 'replace' || mode === 'bilingual') return mode;
    // 兼容历史值
    if (mode === 'translationOnly' || mode === 'translated-only' || mode === 'single') return 'replace';
    return 'bilingual';
  };

  const currentMode = normalizeDisplayMode(config.displayMode);
  const targetRadio = document.querySelector(`input[name="displayMode"][value="${currentMode}"]`);
  if (targetRadio) {
    targetRadio.checked = true;
  } else {
    const fallbackRadio = document.querySelector('input[name="displayMode"][value="bilingual"]');
    if (fallbackRadio) fallbackRadio.checked = true;
  }

  if (currentMode !== (config.displayMode || 'bilingual')) {
    await updateConfig({ displayMode: currentMode });
  }

  const serviceValue = config.translationService || 'microsoft-free';
  if (translationService.querySelector(`option[value="${serviceValue}"]`)) {
    translationService.value = serviceValue;
  } else {
    translationService.value = 'microsoft-free';
    await updateConfig({ translationService: 'microsoft-free' });
  }

  applyServiceAvailability(config);

  if (translationService.options[translationService.selectedIndex]?.disabled) {
    translationService.value = 'microsoft-free';
    await updateConfig({ translationService: 'microsoft-free' });
  }

  renderServiceSelectWithIcons();

  // 事件监听（其他）
  sourceLang.addEventListener('change', async () => {
    await updateConfig({ sourceLang: sourceLang.value });
    showToast('源语言已更新');
  });

  targetLang.addEventListener('change', async () => {
    await updateConfig({ targetLang: targetLang.value });
    showToast('目标语言已更新');
  });

  // 显示模式切换逻辑
  document.querySelectorAll('input[name="displayMode"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      if (e.target.checked) {
        const newValue = e.target.value;
        await updateConfig({ displayMode: newValue });
        showToast(newValue === 'bilingual' ? '已切换至双语对照' : '已切换至纯译文模式');
      }
    });
  });

  translationService.addEventListener('change', async () => {
    await updateConfig({ translationService: translationService.value });
    renderServiceSelectWithIcons();
    showToast('翻译服务已切换');
  });

  // 说明：翻译/恢复由页面右下角悬浮按钮控制，popup 不再直接触发。

  async function refreshTranslationStatus() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      return;
    }

    currentTabId = tab.id;

    const contentStatus = await checkTranslationStatus(currentTabId);
    if (typeof contentStatus === 'boolean') {
      isTranslated = contentStatus;
      await setTabStatusInBackground(currentTabId, isTranslated);
    } else {
      isTranslated = await getTabStatusFromBackground(currentTabId);
    }

  }


  // 轻量级状态自愈：弹窗重新可见/聚焦时刷新
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      await refreshTranslationStatus();
    }
  });

  window.addEventListener('focus', async () => {
    await refreshTranslationStatus();
  });

  // 从 background 获取标签页状态
  async function getTabStatusFromBackground(tabId) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getTabStatus', tabId }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(response?.isTranslated || false);
      });
    });
  }

  // 设置标签页状态到 background
  async function setTabStatusInBackground(tabId, status) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'setTabStatus', tabId, isTranslated: status }, () => {
        resolve();
      });
    });
  }

  // 检查页面翻译状态（从 content script）
  async function checkTranslationStatus(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: 'getTranslationStatus' });
      if (typeof response?.isTranslated === 'boolean') {
        return response.isTranslated;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  // 加载配置
  function loadConfig() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getConfig' }, (config) => {
        if (chrome.runtime.lastError) {
          console.warn('loadConfig failed:', chrome.runtime.lastError.message);
          resolve({});
        } else {
          resolve(config || {});
        }
      });
    });
  }

  // 更新配置
  async function updateConfig(updates) {
    try {
      const currentConfig = await loadConfig();
      const newConfig = { ...currentConfig, ...updates };
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'saveConfig',
          config: newConfig
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
    } catch (error) {
      console.error('更新配置失败:', error);
      throw error;
    }
  }

  // 显示 Toast 提示
  function showToast(text) {
    if (!statusToast) return;
    statusToast.textContent = text;
    statusToast.classList.add('show');
    setTimeout(() => {
      statusToast.classList.remove('show');
    }, 2000);
  }
});
