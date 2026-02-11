// ZDFTranslate - Popup Script
// 处理弹出窗口的交互逻辑

document.addEventListener('DOMContentLoaded', async () => {
  // 获取DOM元素
  const sourceLang = document.getElementById('sourceLang');
  const targetLang = document.getElementById('targetLang');
  const displayMode = document.getElementById('displayMode');
  const translationService = document.getElementById('translationService');
  const translateBtn = document.getElementById('translateBtn');
  const btnText = document.getElementById('btnText');
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
  
  // 获取当前标签页
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;
  
  // 优先检查 content script 的实际状态（基于页面DOM）
  try {
    isTranslated = await checkTranslationStatus(currentTabId);
    await setTabStatusInBackground(currentTabId, isTranslated);
  } catch (e) {
    isTranslated = await getTabStatusFromBackground(currentTabId);
  }
  updateButtonState();
  
  // 初始化UI
  sourceLang.value = config.sourceLang || 'auto';
  targetLang.value = config.targetLang;
  displayMode.value = config.displayMode;
  translationService.value = config.translationService;

  // 事件监听（其他）
  sourceLang.addEventListener('change', async () => {
    await updateConfig({ sourceLang: sourceLang.value });
    showToast('源语言已更新');
  });

  targetLang.addEventListener('change', async () => {
    await updateConfig({ targetLang: targetLang.value });
    showToast('目标语言已更新');
  });

  displayMode.addEventListener('change', async () => {
    await updateConfig({ displayMode: displayMode.value });
    showToast('显示模式已更新');
  });

  translationService.addEventListener('change', async () => {
    await updateConfig({ translationService: translationService.value });
    showToast('翻译服务已切换');
  });

  // 主按钮点击 - 翻译/恢复切换
  translateBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        showToast('无法获取当前标签页');
        return;
      }
      
      currentTabId = tab.id;
      translateBtn.disabled = true;
      
      if (!isTranslated) {
        showToast('正在翻译...');
        
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'startTranslation' });
          isTranslated = true;
          await setTabStatusInBackground(tab.id, true);
          updateButtonState();
          showToast('翻译完成');
        } catch (error) {
          // 如果 content script 未加载，尝试注入
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['lib/dom-parser.js', 'lib/translator.js', 'content.js']
            });
            
            await new Promise(resolve => setTimeout(resolve, 500));
            await chrome.tabs.sendMessage(tab.id, { action: 'startTranslation' });
            isTranslated = true;
            await setTabStatusInBackground(tab.id, true);
            updateButtonState();
            showToast('翻译完成');
          } catch (injectError) {
            showToast('无法访问此页面');
            console.error('注入失败:', injectError);
          }
        }
      } else {
        // 恢复原文
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'restoreOriginal' });
          isTranslated = false;
          await setTabStatusInBackground(tab.id, false);
          updateButtonState();
          showToast('已恢复原文');
        } catch (error) {
          showToast('恢复失败');
          console.error('恢复失败:', error);
        }
      }
    } catch (error) {
      showToast('操作失败');
      console.error('操作失败:', error);
    } finally {
      translateBtn.disabled = false;
    }
  });

  // 更新按钮状态
  function updateButtonState() {
    if (isTranslated) {
      btnText.textContent = '恢复原文';
      translateBtn.classList.add('translated');
    } else {
      btnText.textContent = '翻译';
      translateBtn.classList.remove('translated');
    }
  }

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
      return response && response.isTranslated;
    } catch (error) {
      return false;
    }
  }

  // 加载配置
  function loadConfig() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getConfig' }, (config) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
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
        }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('更新配置失败:', error);
      throw error;
    }
  }

  // 显示 Toast 提示
  function showToast(text) {
    statusToast.textContent = text;
    statusToast.classList.add('show');
    setTimeout(() => {
      statusToast.classList.remove('show');
    }, 2000);
  }
});
