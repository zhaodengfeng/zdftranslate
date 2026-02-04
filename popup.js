// ZDFTranslate - Popup Script
// 处理弹出窗口的交互逻辑

document.addEventListener('DOMContentLoaded', async () => {
  // 获取DOM元素
  const targetLang = document.getElementById('targetLang');
  const displayMode = document.getElementById('displayMode');
  const translationService = document.getElementById('translationService');
  const translateToggleBtn = document.getElementById('translateToggleBtn');
  const btnText = document.getElementById('btnText');
  const statusText = document.getElementById('statusText');
  const openOptions = document.getElementById('openOptions');

  // 当前页面翻译状态
  let isTranslated = false;
  let currentTabId = null;

  // 加载配置和状态
  const config = await loadConfig();
  
  // 获取当前标签页
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;
  
  // 优先检查 content script 的实际状态（基于页面DOM）
  try {
    isTranslated = await checkTranslationStatus(currentTabId);
    // 同步到 background
    await setTabStatusInBackground(currentTabId, isTranslated);
  } catch (e) {
    // content script 未加载，从 background 获取状态
    isTranslated = await getTabStatusFromBackground(currentTabId);
  }
  updateButtonState();
  
  // 初始化UI
  targetLang.value = config.targetLang;
  displayMode.value = config.displayMode;
  translationService.value = config.translationService;

  // 事件监听
  targetLang.addEventListener('change', async () => {
    await updateConfig({ targetLang: targetLang.value });
    showStatus('目标语言已更新');
  });

  displayMode.addEventListener('change', async () => {
    await updateConfig({ displayMode: displayMode.value });
    showStatus('显示模式已更新');
  });

  translationService.addEventListener('change', async () => {
    await updateConfig({ translationService: translationService.value });
    showStatus('翻译服务已切换');
  });

  // 主按钮点击 - 翻译/恢复切换
  translateToggleBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id;
    
    if (!isTranslated) {
      // 执行翻译
      showStatus('正在翻译...');
      translateToggleBtn.disabled = true;
      
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'startTranslation' });
        isTranslated = true;
        await setTabStatusInBackground(tab.id, true);
        updateButtonState();
        showStatus('翻译完成');
      } catch (error) {
        // 如果 content script 未加载，尝试注入
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['lib/dom-parser.js', 'lib/translator.js', 'content.js']
          });
          // 等待脚本加载后再次发送消息
          setTimeout(async () => {
            await chrome.tabs.sendMessage(tab.id, { action: 'startTranslation' });
            isTranslated = true;
            await setTabStatusInBackground(tab.id, true);
            updateButtonState();
            showStatus('翻译完成');
          }, 500);
        } catch (injectError) {
          showStatus('翻译失败: 无法访问页面');
        }
      }
      
      translateToggleBtn.disabled = false;
    } else {
      // 恢复原文
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'restoreOriginal' });
        isTranslated = false;
        await setTabStatusInBackground(tab.id, false);
        updateButtonState();
        showStatus('已恢复原文');
      } catch (error) {
        showStatus('恢复失败');
      }
    }
  });

  openOptions.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // 更新按钮状态
  function updateButtonState() {
    if (isTranslated) {
      btnText.textContent = '切换原文显示';
      translateToggleBtn.classList.add('restored');
    } else {
      btnText.textContent = '翻译当前页面';
      translateToggleBtn.classList.remove('restored');
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
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getConfig' }, (config) => {
        resolve(config);
      });
    });
  }

  // 更新配置
  async function updateConfig(updates) {
    const currentConfig = await loadConfig();
    const newConfig = { ...currentConfig, ...updates };
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'saveConfig',
        config: newConfig
      }, () => resolve());
    });
  }

  // 显示状态信息
  function showStatus(text) {
    statusText.textContent = text;
    statusText.classList.add('show');
    setTimeout(() => {
      statusText.classList.remove('show');
    }, 2500);
  }
});
