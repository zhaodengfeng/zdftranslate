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

  // 加载配置和状态
  const config = await loadConfig();
  
  // 动态加载自定义服务选项（直接追加到下拉列表末尾）
  if (config.customServices?.length > 0) {
    config.customServices.forEach(service => {
      const option = document.createElement('option');
      option.value = service.id;
      option.textContent = service.name || '未命名服务';
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
  }, 1200);

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

  const serviceValue = config.translationService || 'libretranslate';
  if (translationService.querySelector(`option[value="${serviceValue}"]`)) {
    translationService.value = serviceValue;
  } else {
    translationService.value = 'libretranslate';
    await updateConfig({ translationService: 'libretranslate' });
  }

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
