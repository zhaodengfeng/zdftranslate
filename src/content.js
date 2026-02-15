// ZDFTranslate - Content Script
// 核心功能：识别页面主要内容并注入翻译

(function() {
  'use strict';

  // 防止重复注入
  if (window.zdfTranslateLoaded) {
    return;
  }
  window.zdfTranslateLoaded = true;

  // 配置状态
  let config = {
    enabled: true,
    targetLang: 'zh-CN',
    sourceLang: 'auto',
    displayMode: 'bilingual', // bilingual | replace | hover
    translationService: 'libretranslate',
    apiKeys: {
      google: '',
      deepl: '',
      openai: '',
      kimi: '',
      zhipu: '',
      aliyun: '',
      deepseek: ''
    },
    excludedSites: [],
    style: {
      translationColor: '#111111',
      translationSize: '0.95em',
      lineSpacing: '1.6',
      backgroundHighlight: false
    }
  };

  // 从存储加载配置
  chrome.storage.sync.get(['zdfConfig'], (result) => {
    if (result.zdfConfig) {
      config = { ...config, ...result.zdfConfig };
    }
  });
  
  // 重新加载配置
  async function reloadConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['zdfConfig'], (result) => {
        if (result.zdfConfig) {
          config = { ...config, ...result.zdfConfig };
        }
        resolve();
      });
    });
  }

  // 翻译状态跟踪
  let translationActive = false;
  let translatedElements = new Set();
  let lazyLoadObservers = []; // 保存懒加载 observers 以便清理

  // 监听配置更新
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleTranslation') {
      config.enabled = request.enabled;
      if (config.enabled) {
        init();
      } else {
        removeTranslations();
      }
    } else if (request.action === 'updateConfig') {
      config = { ...config, ...request.config };
      if (config.enabled) {
        removeTranslations();
        setTimeout(init, 100);
      }
    } else if (request.action === 'translateSelection') {
      translateText(request.text).then(sendResponse);
      return true;
    } else if (request.action === 'getSelectionSegments') {
      sendResponse({ segments: getSelectionSegments() });
      return true;
    } else if (request.action === 'getTranslationStatus') {
      // 检查变量状态和实际DOM内容，确保状态准确
      const hasTranslationInDOM = document.querySelectorAll('[data-zdf-translated="true"]').length > 0;
      const actualStatus = translationActive || hasTranslationInDOM;
      sendResponse({ isTranslated: actualStatus });
    } else if (request.action === 'startTranslation') {
      startTranslation();
      translationActive = true;
      sendResponse({ success: true });
    } else if (request.action === 'restoreOriginal') {
      restoreOriginal();
      translationActive = false;
      sendResponse({ success: true });
    } else if (request.action === 'toggleDisplayMode') {
      toggleDisplayMode();
    }
    return true;
  });

  function init() {
    if (isExcludedSite()) return;
    
    // 使用 Intersection Observer 实现懒加载翻译
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          processElement(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '100px' });

    // 查找主要内容区域
    const contentBlocks = findContentBlocks();
    contentBlocks.forEach(block => observer.observe(block));
  }

  // 智能识别页面主要内容块
  function findContentBlocks() {
    const candidates = [];
    const selectors = [
      'article',
      '[role="main"]',
      '.content',
      '.post-content',
      '.entry-content',
      'main',
      '.article-body'
    ];

    // 先尝试常见的内容选择器
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        if (getTextLength(el) > 200) {
          candidates.push(el);
        }
      });
    }

    // 如果没有找到，使用启发式算法找最大文本块
    if (candidates.length === 0) {
      const bestBlock = findLargestTextBlock();
      if (bestBlock) candidates.push(bestBlock);
    }

    return candidates;
  }

  // 启发式查找最大文本块
  function findLargestTextBlock() {
    let bestElement = null;
    let maxScore = 0;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      null,
      false
    );

    let node;
    while (node = walker.nextNode()) {
      const tag = node.tagName.toLowerCase();
      if (['script', 'style', 'nav', 'header', 'footer', 'aside'].includes(tag)) continue;
      
      const textLength = getTextLength(node);
      const linkDensity = getLinkDensity(node);
      const score = textLength * (1 - linkDensity);

      if (score > maxScore && textLength > 500) {
        maxScore = score;
        bestElement = node;
      }
    }

    return bestElement;
  }

  function getTextLength(element) {
    return element.innerText?.trim().length || 0;
  }

  function getLinkDensity(element) {
    const textLength = getTextLength(element);
    if (textLength === 0) return 0;
    
    const linkText = Array.from(element.querySelectorAll('a'))
      .reduce((sum, a) => sum + getTextLength(a), 0);
    
    return linkText / textLength;
  }

  // 处理元素内容 - 批量翻译提高速度
  async function processElement(element) {
    if (!translationActive) {
      return;
    }
    
    const paragraphs = element.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
    const toTranslate = Array.from(paragraphs).filter(shouldTranslate);
    
    if (!toTranslate.length) return;
    
    // 使用批量翻译提高速度（按服务动态调优）
    const tuning = getBatchTuning(config.translationService);
    await translateWithConcurrency(toTranslate, tuning.batchSize, tuning.concurrency);
  }

  // 根据翻译服务动态设置并发参数
  function getBatchTuning(service) {
    // 免费公共服务更容易限流，保守一点
    if (service === 'libretranslate') {
      return { batchSize: 3, concurrency: 2 };
    }
    // API Key 服务可稍微激进，提升速度
    return { batchSize: 4, concurrency: 3 };
  }
  
  // 带并发控制的批量翻译
  async function translateWithConcurrency(elements, batchSize, concurrency) {
    if (!elements.length) return;
    
    const batches = [];
    for (let i = 0; i < elements.length; i += batchSize) {
      batches.push(elements.slice(i, i + batchSize));
    }
    
    for (let i = 0; i < batches.length; i += concurrency) {
      if (!translationActive) {
        break;
      }
      
      const currentBatches = batches.slice(i, i + concurrency);
      await Promise.allSettled(currentBatches.map((batch, idx) => 
        translateBatchWithDisplay(batch, i + idx)
      ));
    }
  }
  
  // 批量翻译并立即显示结果（流水线模式）
  async function translateBatchWithDisplay(elements, batchIndex) {
    if (elements.length === 0) return;
    if (elements.length === 1) {
      return translateParagraph(elements[0]);
    }
    
    // 批量翻译多个段落
    const texts = elements.map(el => el.innerText.trim());
    const separator = '\n\n---PARA_BREAK---\n\n';
    const combinedText = texts.join(separator);
    
    // 标记所有元素为已翻译（防止重复）
    elements.forEach(el => el.dataset.zdfTranslated = 'true');
    
    try {
      const translatedCombined = await translateText(combinedText);
      
      // 检查是否已取消
      if (!translationActive) {
        return;
      }
      
      const translatedParts = translatedCombined.split(separator);
      
      // 立即显示每个翻译结果（流水线）
      elements.forEach((el, index) => {
        if (!translationActive) return;
        
        if (translatedParts[index]) {
          const originalText = texts[index];
          const translatedText = translatedParts[index].trim();
          
          if (config.displayMode === 'bilingual') {
            insertBilingual(el, originalText, translatedText);
          } else if (config.displayMode === 'replace') {
            el.innerText = translatedText;
          }
        }
      });
    } catch (error) {
      console.error(`[ZDFTranslate] 批次 ${batchIndex} 失败:`, error.message);
      // 批量失败时回退到单段落翻译
      elements.forEach(el => {
        el.dataset.zdfTranslated = '';
      });
      // 串行重试，避免触发限流
      for (const el of elements) {
        if (!translationActive) break;
        await translateParagraph(el);
        await sleep(100);
      }
    }
  }
  
  // 辅助函数：延迟
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // 判断是否应该翻译
  function shouldTranslate(element) {
    // 已翻译的跳过
    if (element.dataset.zdfTranslated) return false;
    
    // 代码块不翻译
    if (element.closest('pre, code')) return false;
    
    // 文本太短不翻译
    const text = element.innerText?.trim();
    if (!text || text.length < 10) return false;
    
    // 检测是否已经是目标语言（简化版，可用 franc 库改进）
    if (isTargetLanguage(text)) return false;
    
    return true;
  }

  // 简单语言检测
  function isTargetLanguage(text) {
    // 如果包含大量中文字符，认为是中文
    const chineseChars = text.match(/[\u4e00-\u9fa5]/g);
    return chineseChars && chineseChars.length > text.length * 0.3;
  }

  // 翻译段落
  async function translateParagraph(element) {
    const originalText = element.innerText?.trim();
    if (!originalText) return;

    element.dataset.zdfTranslated = 'true';

    try {
      const translatedText = await translateText(originalText);
      
      if (!translationActive) {
        return;
      }
      
      if (config.displayMode === 'bilingual') {
        insertBilingual(element, originalText, translatedText);
      } else if (config.displayMode === 'replace') {
        element.innerText = translatedText;
      }
    } catch (error) {
      console.error('ZDFTranslate: 翻译失败 -', error.message);
      element.dataset.zdfTranslated = '';
    }
  }

  // 双语对照模式
  function insertBilingual(element, original, translated) {
    // 保存原始HTML - 确保只保存一次
    if (!element.dataset.zdfOriginalHtml) {
      element.dataset.zdfOriginalHtml = element.innerHTML;
      element.dataset.zdfOriginalText = original;
    }
    
    const container = document.createElement('div');
    container.className = 'zdf-translation-container';
    
    const originalDiv = document.createElement('div');
    originalDiv.className = 'zdf-original';
    originalDiv.innerHTML = element.dataset.zdfOriginalHtml;
    
    const translatedDiv = document.createElement('div');
    translatedDiv.className = 'zdf-translated';
    translatedDiv.textContent = translated;
    translatedDiv.style.cssText = `
      color: ${config.style.translationColor};
      font-size: ${config.style.translationSize};
      margin-top: 8px;
      padding: 10px 0 10px 14px;
      border-left: 3px solid #3b82f6;
      background: linear-gradient(to right, rgba(59, 130, 246, 0.06), transparent);
      line-height: ${config.style.lineSpacing};
      transition: opacity 0.3s ease;
    `;

    container.appendChild(originalDiv);
    container.appendChild(translatedDiv);
    
    element.innerHTML = '';
    element.appendChild(container);
    
    // 记录翻译的元素
    translatedElements.add(element);
  }

  // 调用翻译API
  async function translateText(text) {
    return new Promise((resolve, reject) => {
      if (!text || !text.trim()) {
        reject(new Error('空文本'));
        return;
      }
      
      chrome.runtime.sendMessage({
        action: 'translate',
        text: text,
        targetLang: config.targetLang,
        sourceLang: config.sourceLang,
        service: config.translationService
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.translatedText) {
          resolve(response.translatedText);
        } else {
          reject(new Error(response?.error || '翻译失败'));
        }
      });
    });
  }

  // 移除所有翻译
  function removeTranslations() {
    document.querySelectorAll('[data-zdf-translated]').forEach(el => {
      // 恢复原始内容
      if (el.dataset.zdfOriginalHtml) {
        el.innerHTML = el.dataset.zdfOriginalHtml;
      }
      // 清除所有标记
      delete el.dataset.zdfTranslated;
      delete el.dataset.zdfOriginalHtml;
      delete el.dataset.zdfOriginalText;
    });
    translatedElements.clear();
  }

  // 检查是否在排除列表
  function isExcludedSite() {
    const hostname = window.location.hostname;
    return config.excludedSites.some(site => hostname.includes(site));
  }

  // 开始翻译（手动触发）
  async function startTranslation() {
    if (isExcludedSite()) return;
    
    // 重新加载最新配置
    await reloadConfig();
    
    // 检查是否需要重新翻译（服务或目标语言变化）
    const currentSettings = `${config.translationService}_${config.targetLang}`;
    const lastSettings = document.body.dataset.zdfLastSettings;
    if (lastSettings && lastSettings !== currentSettings) {
      restoreOriginal();
    }
    document.body.dataset.zdfLastSettings = currentSettings;
    
    // 标记翻译状态
    translationActive = true;
    document.body.dataset.zdfActive = 'true';
    
    // 立即翻译当前可见区域的内容
    const contentBlocks = findContentBlocks();
    
    const immediateTasks = [];

    for (const block of contentBlocks) {
      // 检查元素是否在视口内或附近
      const rect = block.getBoundingClientRect();
      const isInViewport = rect.top < window.innerHeight + 500 && rect.bottom > -500;

      if (isInViewport) {
        // 可见区域并行翻译，提升首屏速度
        immediateTasks.push(processElement(block));
      } else {
        // 对于不在视口内的内容，使用 Intersection Observer 懒加载
        const observer = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              // 检查是否仍处于翻译状态
              if (translationActive) {
                processElement(entry.target);
              }
              observer.unobserve(entry.target);
            }
          });
        }, { rootMargin: '200px' });
        observer.observe(block);
        lazyLoadObservers.push(observer); // 保存引用以便清理
      }
    }

    if (immediateTasks.length) {
      await Promise.allSettled(immediateTasks);
    }
  }

  // 恢复原文
  function restoreOriginal() {
    translationActive = false;
    delete document.body.dataset.zdfActive;
    
    // 移除所有翻译内容
    document.querySelectorAll('[data-zdf-translated]').forEach(el => {
      // 恢复原始内容
      if (el.dataset.zdfOriginalHtml) {
        el.innerHTML = el.dataset.zdfOriginalHtml;
      }
      // 清除所有标记
      delete el.dataset.zdfTranslated;
      delete el.dataset.zdfOriginalHtml;
      delete el.dataset.zdfOriginalText;
    });
    
    // 同时清理所有翻译容器（以防万一）
    document.querySelectorAll('.zdf-translation-container').forEach(container => {
      const parent = container.parentElement;
      if (parent && parent.dataset.zdfOriginalHtml) {
        parent.innerHTML = parent.dataset.zdfOriginalHtml;
        delete parent.dataset.zdfTranslated;
        delete parent.dataset.zdfOriginalHtml;
        delete parent.dataset.zdfOriginalText;
      }
    });
    
    translatedElements.clear();
    
    // 断开所有懒加载 observers
    lazyLoadObservers.forEach(observer => observer.disconnect());
    lazyLoadObservers = [];
  }

  // 切换显示模式
  function toggleDisplayMode() {
    const containers = document.querySelectorAll('.zdf-translation-container');
    containers.forEach(container => {
      const original = container.querySelector('.zdf-original');
      const translated = container.querySelector('.zdf-translated');
      
      if (original && translated) {
        if (translated.style.display === 'none') {
          translated.style.display = 'block';
          original.style.opacity = '0.7';
        } else {
          translated.style.display = 'none';
          original.style.opacity = '1';
        }
      }
    });
  }

  // ========== 右键菜单翻译弹窗 ==========
  
  // 显示翻译弹窗
  let popupStreamTimer = null;
  let popupLatestTranslatedText = '';
  let popupLatestOriginalSegments = [];
  let popupLatestTranslatedSegments = [];
  let popupDragState = null;

  function enablePopupDrag(popup, dragHandle) {
    if (!popup || !dragHandle) return;

    const onMouseDown = (e) => {
      // 点击按钮时不触发拖动
      if (e.target.closest('button')) return;

      const rect = popup.getBoundingClientRect();
      popup.style.left = `${rect.left}px`;
      popup.style.top = `${rect.top}px`;
      popup.style.transform = 'none';

      popupDragState = {
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!popupDragState) return;

      const nextLeft = e.clientX - popupDragState.offsetX;
      const nextTop = e.clientY - popupDragState.offsetY;

      const maxLeft = Math.max(0, window.innerWidth - popup.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - popup.offsetHeight);

      popup.style.left = `${Math.min(Math.max(0, nextLeft), maxLeft)}px`;
      popup.style.top = `${Math.min(Math.max(0, nextTop), maxTop)}px`;
    };

    const onMouseUp = () => {
      popupDragState = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    dragHandle.style.cursor = 'move';
    dragHandle.addEventListener('mousedown', onMouseDown);
  }

  function ensureTranslationPopup(originalText) {
    let popup = document.getElementById('zdf-translation-popup');
    if (!popup) {
      popup = document.createElement('div');
      popup.id = 'zdf-translation-popup';
      popup.className = 'zdf-popup';

      // 顶部栏
      const header = document.createElement('div');
      header.className = 'zdf-popup-header';

      const logo = document.createElement('div');
      logo.className = 'zdf-popup-logo';
      logo.innerHTML = `<img src="${chrome.runtime.getURL('icons/icon48.png')}" class="zdf-popup-logo-img" alt="ZDFTranslate">`;

      const toolbar = document.createElement('div');
      toolbar.className = 'zdf-popup-toolbar';

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'zdf-popup-tool';
      toggleBtn.title = '显示/隐藏原文';
      toggleBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 6h16M4 12h16M4 18h10"/>
      </svg>`;
      toggleBtn.onclick = () => {
        const orig = popup.querySelector('.zdf-popup-original');
        if (orig) orig.classList.toggle('zdf-popup-original-show');
      };

      const closeBtn = document.createElement('button');
      closeBtn.className = 'zdf-popup-tool zdf-popup-close';
      closeBtn.title = '关闭';
      closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>`;
      closeBtn.onclick = removeTranslationPopup;

      toolbar.appendChild(toggleBtn);
      toolbar.appendChild(closeBtn);
      header.appendChild(logo);
      header.appendChild(toolbar);

      const content = document.createElement('div');
      content.className = 'zdf-popup-content';

      const originalDiv = document.createElement('div');
      originalDiv.className = 'zdf-popup-original';

      const translatedDiv = document.createElement('div');
      translatedDiv.className = 'zdf-popup-translated';

      content.appendChild(originalDiv);
      content.appendChild(translatedDiv);

      const footer = document.createElement('div');
      footer.className = 'zdf-popup-footer';
      footer.style.display = 'none';

      const footerLeft = document.createElement('div');
      footerLeft.className = 'zdf-popup-footer-left';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'zdf-popup-action';
      copyBtn.title = '复制译文';
      copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2"/>
        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
      </svg>`;

      copyBtn.onclick = () => {
        if (!popupLatestTranslatedText) return;
        navigator.clipboard.writeText(popupLatestTranslatedText).then(() => {
          copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#37b24d" stroke-width="2">
            <path d="M5 13l4 4L19 7"/>
          </svg>`;
          setTimeout(() => {
            copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>`;
          }, 1200);
        });
      };

      const exportBtn = document.createElement('button');
      exportBtn.className = 'zdf-popup-action';
      exportBtn.title = '导出双语图片';
      exportBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>`;
      exportBtn.onclick = exportBilingualAsImage;

      footerLeft.appendChild(copyBtn);
      footerLeft.appendChild(exportBtn);
      footer.appendChild(footerLeft);

      popup.appendChild(header);
      popup.appendChild(content);
      popup.appendChild(footer);
      document.body.appendChild(popup);

      enablePopupDrag(popup, header);

      setTimeout(() => {
        document.addEventListener('click', handlePopupOutsideClick);
      }, 80);
    }

    const originalDiv = popup.querySelector('.zdf-popup-original');
    if (originalDiv) {
      const paras = normalizeTextToParagraphsStrict(originalText || '');
      originalDiv.innerHTML = '';
      if (paras.length > 0) {
        paras.forEach(t => {
          const p = document.createElement('p');
          p.textContent = t;
          originalDiv.appendChild(p);
        });
      } else {
        originalDiv.textContent = originalText || '';
      }
      originalDiv.classList.remove('zdf-popup-original-show');
    }

    return popup;
  }

  function normalizeTextToParagraphsStrict(text) {
    const raw = (text || '').replace(/\r\n/g, '\n').trim();
    if (!raw) return [];

    // 严格规则：双换行=段落边界；单换行=同段软换行（转空格）
    return raw
      .split(/\n\s*\n+/)
      .map(block => block.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function splitTranslatedParagraphs(text) {
    const raw = (text || '').trim();
    if (!raw) return [];

    let paragraphs = normalizeTextToParagraphsStrict(raw);

    // 如果译文几乎没分段，按句子做温和分段，避免“一坨”
    if (paragraphs.length <= 1) {
      const sentences = raw
        .split(/(?<=[。！？!?])/)
        .map(s => s.trim())
        .filter(Boolean);

      if (sentences.length > 2) {
        paragraphs = [];
        for (let i = 0; i < sentences.length; i += 2) {
          paragraphs.push((sentences[i] + (sentences[i + 1] || '')).trim());
        }
      }
    }

    return paragraphs;
  }

  function streamTextToElement(el, text, onDone) {
    if (popupStreamTimer) {
      clearInterval(popupStreamTimer);
      popupStreamTimer = null;
    }

    const paragraphs = splitTranslatedParagraphs(text);
    el.innerHTML = '';

    if (!paragraphs.length) {
      if (onDone) onDone();
      return;
    }

    const paragraphEls = paragraphs.map(() => {
      const p = document.createElement('p');
      p.textContent = '';
      el.appendChild(p);
      return p;
    });

    let paraIdx = 0;
    let charIdx = 0;

    popupStreamTimer = setInterval(() => {
      if (!document.body.contains(el)) {
        clearInterval(popupStreamTimer);
        popupStreamTimer = null;
        return;
      }

      if (paraIdx >= paragraphs.length) {
        clearInterval(popupStreamTimer);
        popupStreamTimer = null;
        if (onDone) onDone();
        return;
      }

      const current = paragraphs[paraIdx];
      const chunk = current.slice(charIdx, charIdx + 3);
      paragraphEls[paraIdx].textContent += chunk;
      charIdx += 3;

      if (charIdx >= current.length) {
        paraIdx += 1;
        charIdx = 0;
      }
    }, 14);
  }

  function getPageDisplayFontFamily() {
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        let node = range.startContainer;
        if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
        if (node && node.nodeType === Node.ELEMENT_NODE) {
          const ff = getComputedStyle(node).fontFamily;
          if (ff) return ff;
        }
      }
    } catch (e) {}

    try {
      const ff = getComputedStyle(document.body).fontFamily;
      if (ff) return ff;
    } catch (e) {}

    return '"PingFang SC", "SF Pro Text", "Inter", "Segoe UI", "Microsoft YaHei", sans-serif';
  }

  async function exportBilingualAsImage() {
    const originalSegs = popupLatestOriginalSegments?.length
      ? popupLatestOriginalSegments
      : [];
    const translatedSegs = popupLatestTranslatedSegments?.length
      ? popupLatestTranslatedSegments
      : splitTranslatedParagraphs(popupLatestTranslatedText);

    if (!originalSegs.length || !translatedSegs.length) return;

    const pairCount = Math.max(originalSegs.length, translatedSegs.length);
    const pairs = Array.from({ length: pairCount }).map((_, i) => ({
      original: (originalSegs[i] || '').trim(),
      translated: (translatedSegs[i] || '').trim()
    })).filter(p => p.original || p.translated);

    // ===== 高清导出参数（现代弹窗同款风格） =====
    const scale = 3;
    const baseWidth = 1242;
    const outerPadding = 56;
    const cardPaddingX = 44;
    const headerHeight = 0;
    const sectionGap = 26;
    const blockGap = 24;
    const textInsetX = 20;
    const contentWidth = baseWidth - outerPadding * 2 - cardPaddingX * 2 - textInsetX * 2;

    // ===== 字体跟随页面显示风格（按用户要求） =====
    const pageFontFamily = getPageDisplayFontFamily();
    const fontOriginal = `500 42px ${pageFontFamily}`;
    const fontTranslated = `400 42px ${pageFontFamily}`;

    const lineHeight = 62;
    const labelH = 34;
    const blockPadY = 22;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const wrapLines = (text, font) => {
      if (!text) return [];
      ctx.font = font;

      const tokenRe = /([A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*)|(\s+)|([^\sA-Za-z0-9])/g;
      const tokens = [];
      let m;
      while ((m = tokenRe.exec(text)) !== null) {
        tokens.push(m[0]);
      }

      const lines = [];
      let line = '';

      const pushLine = () => {
        const t = line.trim();
        if (t) lines.push(t);
        line = '';
      };

      for (const tk of tokens) {
        const isSpace = /^\s+$/.test(tk);

        // 行首不保留空白
        if (!line && isSpace) continue;

        const candidate = line + tk;
        if (ctx.measureText(candidate).width <= contentWidth) {
          line = candidate;
          continue;
        }

        // 放不下：先换行
        if (line) {
          pushLine();
          if (isSpace) continue;
          if (ctx.measureText(tk).width <= contentWidth) {
            line = tk;
            continue;
          }
        }

        // 极端长token兜底（超长URL/超长连续字符）
        let part = '';
        for (const ch of Array.from(tk)) {
          const t = part + ch;
          if (ctx.measureText(t).width > contentWidth && part) {
            lines.push(part);
            part = ch;
          } else {
            part = t;
          }
        }
        line = part;
      }

      if (line.trim()) lines.push(line.trim());
      return lines;
    };

    const blocks = pairs.map((p) => ({
      originalLines: wrapLines(p.original, fontOriginal),
      translatedLines: wrapLines(p.translated, fontTranslated)
    }));

    const blockHeights = blocks.map((b) => {
      const originalH = labelH + blockPadY + b.originalLines.length * lineHeight + blockPadY;
      const translatedH = labelH + blockPadY + b.translatedLines.length * lineHeight + blockPadY;
      return originalH + sectionGap + translatedH + blockGap;
    });

    const contentHeight = blockHeights.reduce((a, b) => a + b, 0);
    const cardHeight = headerHeight + 26 + contentHeight + 24;

    const showWatermark = config.style?.showWatermark !== false;
    const baseHeight = Math.max(980, outerPadding * 2 + cardHeight);

    canvas.width = Math.round(baseWidth * scale);
    canvas.height = Math.round(baseHeight * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.textBaseline = 'alphabetic';

    // 页面底色
    const g = ctx.createLinearGradient(0, 0, 0, baseHeight);
    g.addColorStop(0, '#f3f7ff');
    g.addColorStop(1, '#eef3fb');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, baseWidth, baseHeight);

    // 主卡片
    const cardX = outerPadding;
    const cardY = outerPadding;
    const cardW = baseWidth - outerPadding * 2;
    const cardH = baseHeight - outerPadding * 2;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, cardX, cardY, cardW, cardH, 24);
    ctx.fill();

    let y = cardY + 28;
    const blockX = cardX + cardPaddingX;
    const blockW = cardW - cardPaddingX * 2;

    const drawLabel = (text, x, yTop, bg, fg) => {
      ctx.fillStyle = bg;
      roundRect(ctx, x, yTop, 112, 34, 10);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.font = `600 20px ${pageFontFamily}`;
      ctx.fillText(text, x + 18, yTop + 24);
    };

    blocks.forEach((b) => {
      // 原文区块
      const originalBoxH = labelH + blockPadY + b.originalLines.length * lineHeight + blockPadY;
      ctx.fillStyle = '#f7faff';
      roundRect(ctx, blockX, y, blockW, originalBoxH, 14);
      ctx.fill();
      drawLabel('原文', blockX + 16, y + 14, '#e6f0ff', '#2052ad');

      ctx.fillStyle = '#2f3c54';
      ctx.font = fontOriginal;
      let ty = y + 14 + labelH + blockPadY + 40;
      b.originalLines.forEach(line => {
        ctx.fillText(line, blockX + textInsetX, ty);
        ty += lineHeight;
      });

      y += originalBoxH + sectionGap;

      // 译文区块
      const translatedBoxH = labelH + blockPadY + b.translatedLines.length * lineHeight + blockPadY;
      ctx.fillStyle = '#f5f8ff';
      roundRect(ctx, blockX, y, blockW, translatedBoxH, 14);
      ctx.fill();
      drawLabel('译文', blockX + 16, y + 14, '#dbeafe', '#1d4ed8');

      ctx.fillStyle = '#334155';
      ctx.font = fontTranslated;
      ty = y + 14 + labelH + blockPadY + 40;
      b.translatedLines.forEach(line => {
        ctx.fillText(line, blockX + textInsetX, ty);
        ty += lineHeight;
      });

      y += translatedBoxH + blockGap;
    });

    // 与网页截图一致：底部追加统一水印栏（品牌图 + 当前页面URL）
    let outputCanvas = canvas;
    if (showWatermark) {
      const watermarkHeight = 170 * scale;
      const totalCanvas = document.createElement('canvas');
      totalCanvas.width = canvas.width;
      totalCanvas.height = canvas.height + watermarkHeight;
      const totalCtx = totalCanvas.getContext('2d');
      totalCtx.drawImage(canvas, 0, 0);
      await drawWatermarkBar(totalCtx, totalCanvas.width, canvas.height, watermarkHeight);
      outputCanvas = totalCanvas;
    }

    await downloadOptimizedCanvas(outputCanvas, `zdftranslate-selection-modern-${Date.now()}`);
  }

  // 导出：极致清晰优先（默认 PNG），仅在 PNG 失败时回退 JPEG
  async function downloadOptimizedCanvas(sourceCanvas, baseName) {
    // 不做降采样，尽量保留原始像素细节
    const canvas = sourceCanvas;

    let blob = await canvasToBlob(canvas, 'image/png', 1);
    let ext = 'png';

    // 仅兜底
    if (!blob) {
      blob = await canvasToBlob(canvas, 'image/jpeg', 0.98);
      ext = 'jpg';
    }

    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
  }

  function buildArticleExportBaseName(title, mode) {
    const cleanTitle = (title || document.title || 'article')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);

    const modeText = mode === 'bilingual' ? 'BIL' : 'ORI';
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${cleanTitle || 'article'}-${modeText}-${rand}`;
  }

  function getSanitizedPageUrl() {
    try {
      const origin = location.origin || '';
      const path = decodeURIComponent(location.pathname || '/');
      return `${origin}${path}`;
    } catch (e) {
      return '';
    }
  }

  function fitTextToWidth(ctx, text, maxWidth) {
    if (!text) return '';
    if (ctx.measureText(text).width <= maxWidth) return text;
    let cut = 0;
    for (let i = 1; i <= text.length; i++) {
      if (ctx.measureText(text.slice(0, i)).width > maxWidth) break;
      cut = i;
    }
    return text.slice(0, Math.max(1, cut));
  }

  // 网址完整显示：自动最多 4 行，优先在 / 断行，不做省略号截断
  function wrapUrlLinesNoEllipsis(ctx, text, maxWidth, maxLines = 4) {
    if (!text) return [];
    if (ctx.measureText(text).width <= maxWidth) return [text];

    const lines = [];
    let rest = text;

    while (rest && lines.length < maxLines) {
      if (ctx.measureText(rest).width <= maxWidth) {
        lines.push(rest);
        rest = '';
        break;
      }

      let cut = 0;
      for (let i = 1; i <= rest.length; i++) {
        if (ctx.measureText(rest.slice(0, i)).width > maxWidth) break;
        cut = i;
      }
      if (cut <= 0) cut = 1;

      // 尽量回退到最近的 / 分割
      const slashPos = rest.slice(0, cut).lastIndexOf('/');
      if (slashPos > 8) cut = slashPos + 1;

      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }

    // 超过 4 行时，最后一行继续完整显示剩余（通过缩小字号解决，不做截断）
    if (rest) {
      lines[lines.length - 1] = lines[lines.length - 1] + rest;
    }

    return lines.filter(Boolean);
  }

  let _watermarkBrandImgPromise = null;
  function loadWatermarkBrandImage() {
    if (_watermarkBrandImgPromise) return _watermarkBrandImgPromise;
    _watermarkBrandImgPromise = new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = chrome.runtime.getURL('assets/watermark-brand.png');
      } catch (e) {
        resolve(null);
      }
    });
    return _watermarkBrandImgPromise;
  }

  let _uiLogoMarkPromise = null;
  function loadUiLogoMarkImage() {
    if (_uiLogoMarkPromise) return _uiLogoMarkPromise;
    _uiLogoMarkPromise = new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = chrome.runtime.getURL('icons/icon48.png');
      } catch (e) {
        resolve(null);
      }
    });
    return _uiLogoMarkPromise;
  }

  async function drawWatermarkBar(ctx, canvasWidth, startY, barHeight) {
    const bg = '#f7f7f7';
    const line = '#d8d8d8';
    ctx.fillStyle = bg;
    ctx.fillRect(0, startY, canvasWidth, barHeight);

    ctx.strokeStyle = line;
    ctx.lineWidth = Math.max(1, Math.round(canvasWidth / 1200));
    ctx.beginPath();
    ctx.moveTo(30, startY + 8);
    ctx.lineTo(canvasWidth - 30, startY + 8);
    ctx.stroke();

    const centerX = canvasWidth / 2;
    const brandImg = await loadWatermarkBrandImage();

    // 中间品牌（图标 + ZDFTranslate）
    const brandTop = startY + Math.max(14, Math.round(barHeight * 0.08));
    let brandBottomY = brandTop + 56;
    if (brandImg) {
      // 兼容高清导出（大像素）与普通截图（常规像素）：避免logo过小
      const targetH = Math.max(
        56,
        Math.min(
          Math.round(barHeight * 0.5),
          Math.round(canvasWidth * 0.09),
          180
        )
      );
      const targetW = Math.round(brandImg.width * (targetH / brandImg.height));
      const drawX = Math.round(centerX - targetW / 2);
      ctx.drawImage(brandImg, drawX, brandTop, targetW, targetH);
      brandBottomY = brandTop + targetH;
    } else {
      ctx.fillStyle = '#2563eb';
      ctx.font = `700 ${Math.max(24, Math.round(barHeight * 0.22))}px "Segoe UI", "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ZDFTranslate', centerX, brandTop + 26);
      brandBottomY = brandTop + 52;
    }

    // 网址放在品牌下方，居中，多行完整显示
    const urlText = getSanitizedPageUrl();
    if (urlText) {
      const maxTextWidth = Math.round(canvasWidth * 0.9);
      let fontSize = Math.max(13, Math.round(barHeight * 0.12));
      const minFontSize = 10;
      const lineGapRatio = 0.3;

      ctx.fillStyle = '#2f2f2f';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      let lines = [];
      while (fontSize >= minFontSize) {
        ctx.font = `500 ${fontSize}px "Inter", "Segoe UI", "PingFang SC", sans-serif`;
        lines = wrapUrlLinesNoEllipsis(ctx, urlText, maxTextWidth, 4);
        const lineGap = Math.max(3, Math.round(fontSize * lineGapRatio));
        const totalH = lines.length * fontSize + (lines.length - 1) * lineGap;
        const availableH = barHeight - 86;
        if (lines.length <= 4 && totalH <= availableH) break;
        fontSize -= 1;
      }

      const lineGap = Math.max(3, Math.round(fontSize * lineGapRatio));
      const totalH = lines.length * fontSize + (lines.length - 1) * lineGap;
      let y = brandBottomY + 14 + fontSize / 2;
      const maxY = startY + barHeight - totalH / 2 - 8;
      if (y > maxY) y = maxY;

      for (const line of lines) {
        ctx.fillText(line, centerX, y);
        y += fontSize + lineGap;
      }
      ctx.textAlign = 'left';
    }
  }

  function resizeCanvasIfNeeded(sourceCanvas, maxEdge = 6000, maxPixels = 16_000_000) {
    const { width, height } = sourceCanvas;
    if (!width || !height) return sourceCanvas;

    const edgeScale = Math.min(1, maxEdge / Math.max(width, height));
    const pixelScale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
    const scale = Math.min(edgeScale, pixelScale);

    if (scale >= 0.999) return sourceCanvas;

    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));
    const resized = document.createElement('canvas');
    resized.width = targetW;
    resized.height = targetH;
    const ctx = resized.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceCanvas, 0, 0, targetW, targetH);
    return resized;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function showTranslationPopup(originalText, translatedText, error, originalSegments = [], translatedSegments = []) {
    const popup = ensureTranslationPopup(originalText);
    const translatedDiv = popup.querySelector('.zdf-popup-translated');
    const footer = popup.querySelector('.zdf-popup-footer');

    if (!translatedDiv || !footer) return;

    if (error) {
      if (popupStreamTimer) {
        clearInterval(popupStreamTimer);
        popupStreamTimer = null;
      }
      translatedDiv.innerHTML = `<span class="zdf-popup-error">翻译失败: ${error}</span>`;
      footer.style.display = 'none';
      popupLatestTranslatedText = '';
      popupLatestOriginalSegments = [];
      popupLatestTranslatedSegments = [];
      return;
    }

    if (!translatedText) {
      if (popupStreamTimer) {
        clearInterval(popupStreamTimer);
        popupStreamTimer = null;
      }
      translatedDiv.innerHTML = `<span class="zdf-popup-loading">
        <svg class="zdf-popup-spinner" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="31.4 31.4"/></svg>
        正在努力翻译中...
      </span>`;
      footer.style.display = 'none';
      popupLatestTranslatedText = '';
      popupLatestOriginalSegments = [];
      popupLatestTranslatedSegments = [];
      return;
    }

    popupLatestTranslatedText = translatedText;
    popupLatestOriginalSegments = Array.isArray(originalSegments) && originalSegments.length
      ? originalSegments
      : (originalText ? normalizeTextToParagraphsStrict(originalText) : []);
    popupLatestTranslatedSegments = Array.isArray(translatedSegments) && translatedSegments.length
      ? translatedSegments
      : splitTranslatedParagraphs(translatedText);

    const originalDiv = popup.querySelector('.zdf-popup-original');
    if (originalDiv) {
      originalDiv.innerHTML = '';
      popupLatestOriginalSegments.forEach(seg => {
        const p = document.createElement('p');
        p.textContent = seg;
        originalDiv.appendChild(p);
      });
    }

    // 优先按段落数组流式渲染，避免末尾突变重排
    const renderText = popupLatestTranslatedSegments.join('\n\n') || translatedText;
    streamTextToElement(translatedDiv, renderText, () => {
      footer.style.display = 'flex';
    });
  }

  function handlePopupOutsideClick(e) {
    const popup = document.getElementById('zdf-translation-popup');
    if (popup && !popup.contains(e.target)) {
      removeTranslationPopup();
    }
  }

  function removeTranslationPopup() {
    const popup = document.getElementById('zdf-translation-popup');
    if (popup) {
      popup.remove();
    }
    if (popupStreamTimer) {
      clearInterval(popupStreamTimer);
      popupStreamTimer = null;
    }
    popupLatestTranslatedText = '';
    popupLatestOriginalSegments = [];
    popupLatestTranslatedSegments = [];
    document.removeEventListener('click', handlePopupOutsideClick);
  }


  // 提取当前选区的段落分段（用于右键翻译保持段落结构）
  function getSelectionSegments() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];

    const selectedText = selection.toString();
    if (!selectedText || selectedText.trim().length === 0) return [];

    const range = selection.getRangeAt(0);
    const blockSelector = 'p, li, div, blockquote, h1, h2, h3, h4, h5, h6';

    const normalizeParagraphs = (text) => {
      return normalizeTextToParagraphsStrict(text)
        .map(para => para.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    };

    const hasNestedBlocks = (el) => {
      if (!el || el.tagName !== 'DIV') return false;
      return Array.from(el.children || []).some(child => child.matches?.(blockSelector));
    };

    const walker = document.createTreeWalker(
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentNode
        : range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          try {
            if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
          } catch (_) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const parts = [];
    const seen = new Set();
    let n;
    while ((n = walker.nextNode())) {
      const block = n.parentElement?.closest(blockSelector) || n.parentElement;
      if (!block) continue;
      if (seen.has(block)) continue;
      if (hasNestedBlocks(block)) continue; // 避免容器 div 吞并相邻段落
      seen.add(block);

      const text = (block.innerText || '').trim();
      if (!text) continue;

      // 段内单换行合并为空格；块级元素之间保持独立 segment
      const paragraphs = normalizeParagraphs(text).filter(para => para.length >= 8);
      parts.push(...paragraphs);
    }

    // 去重：仅做严格归一化去重，避免误删合法相邻段落
    const uniq = [];
    const keySet = new Set();
    for (const t of parts) {
      const k = t.replace(/\s+/g, ' ').trim();
      if (!k || keySet.has(k)) continue;
      keySet.add(k);
      uniq.push(t);
    }

    return uniq;
  }

  // 监听来自 background 的弹窗消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'showTranslationPopup') {
      showTranslationPopup(
        request.originalText,
        request.translatedText,
        request.error,
        request.originalSegments,
        request.translatedSegments
      );
      sendResponse({ success: true });
    }
    return true;
  });

  // ========== 悬浮翻译按钮 ==========
  
  let isTranslating = false; // 翻译进行中标记
  
  function createFloatingButton() {
    // 检查是否已存在
    if (document.getElementById('zdf-floating-translate-btn')) return;
    
    const btn = document.createElement('div');
    btn.id = 'zdf-floating-translate-btn';
    btn.className = 'zdf-floating-btn';
    btn.title = '点击翻译页面';
    
    // 翻译图标 + 右上角绿勾徽章
    const floatIconUrl = chrome.runtime.getURL('assets/float-icon-32.png');
    btn.innerHTML = `
      <img class="zdf-float-icon-img" src="${floatIconUrl}" alt="ZDFTranslate">
      <div class="zdf-float-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <path d="M5 13l4 4L19 7"/>
        </svg>
      </div>
    `;
    
    btn.addEventListener('click', handleFloatingButtonClick);
    
    document.body.appendChild(btn);
    
    // 更新按钮状态
    updateFloatingButtonState();
  }
  
  async function handleFloatingButtonClick() {
    const btn = document.getElementById('zdf-floating-translate-btn');
    if (!btn) return;
    
    if (translationActive || isTranslating) {
      // 已翻译或翻译中 -> 恢复原文
      isTranslating = false;
      restoreOriginal();
      translationActive = false;
      btn.classList.remove('zdf-float-loading');
      updateFloatingButtonState();
      
      // 通知 background 更新状态
      chrome.runtime.sendMessage({
        action: 'setTabStatus',
        tabId: await getCurrentTabId(),
        isTranslated: false
      });
    } else {
      // 未翻译状态 -> 开始翻译
      isTranslating = true;
      btn.classList.add('zdf-float-loading');
      updateFloatingButtonState();
      
      await startTranslation();
      
      isTranslating = false;
      translationActive = true;
      btn.classList.remove('zdf-float-loading');
      updateFloatingButtonState();
      
      // 通知 background 更新状态
      chrome.runtime.sendMessage({
        action: 'setTabStatus',
        tabId: await getCurrentTabId(),
        isTranslated: true
      });
    }
  }
  
  function updateFloatingButtonState() {
    const btn = document.getElementById('zdf-floating-translate-btn');
    if (!btn) return;
    
    const badge = btn.querySelector('.zdf-float-badge');
    
    if (translationActive) {
      // 显示绿勾徽章
      btn.classList.add('zdf-float-translated');
      btn.title = '点击恢复原文';
      btn.setAttribute('data-tip', '恢复原文');
      if (badge) badge.style.display = 'flex';
    } else {
      // 隐藏绿勾徽章
      btn.classList.remove('zdf-float-translated');
      btn.title = isTranslating ? '翻译中...点击取消' : '点击翻译页面';
      btn.setAttribute('data-tip', isTranslating ? '' : '翻译页面');
      if (badge) badge.style.display = 'none';
    }
  }
  
  async function getCurrentTabId() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getCurrentTabId' }, (response) => {
        resolve(response?.tabId || 0);
      });
    });
  }
  
  // ========== 文章截图功能 ==========

  // 预处理跨域图片，尝试设置 crossOrigin 属性
  async function prepareImagesForCapture() {
    const images = document.querySelectorAll('img');
    const promises = [];
    
    images.forEach(img => {
      // 跳过已经是 data URL 或同源的图
      if (!img.src || img.src.startsWith('data:')) return;
      
      try {
        const imgUrl = new URL(img.src);
        if (imgUrl.origin === location.origin) return; // 同源，不需要处理
      } catch (e) {
        return; // URL 解析失败，跳过
      }
      
      // 尝试设置 crossOrigin
      if (img.crossOrigin !== 'anonymous') {
        img.crossOrigin = 'anonymous';
      }
      
      // 如果图片还没加载完，等待它加载
      if (!img.complete) {
        promises.push(new Promise((resolve) => {
          const onLoad = () => {
            img.removeEventListener('load', onLoad);
            img.removeEventListener('error', onLoad);
            resolve();
          };
          img.addEventListener('load', onLoad);
          img.addEventListener('error', onLoad);
          // 3 秒超时
          setTimeout(resolve, 3000);
        }));
      }
    });
    
    // 仅等待 img 标签的处理，不再扫描背景图以提升性能
    await Promise.all(promises);
    // 额外等待一小段时间让 CORS 设置生效
    await new Promise(r => setTimeout(r, 200));
  }

  async function buildArticleCaptureCanvas() {
    const articleElement = findArticleElement();
    if (!articleElement) {
      throw new Error('未找到文章内容区域');
    }

    await warmupArticleForCapture(articleElement);

    let bounds = getArticleCaptureBounds(articleElement);
    if (!bounds || bounds.width < 80 || bounds.height < 320) {
      await warmupArticleForCapture(articleElement, { deep: true });
      bounds = getArticleCaptureBounds(articleElement);
    }
    if (!bounds || bounds.width < 80 || bounds.height < 80) {
      throw new Error('未能识别有效的截图区域');
    }

    const area = Math.max(1, Math.ceil(bounds.width) * Math.ceil(bounds.height));
    const dprScale = Math.max(2, window.devicePixelRatio || 2);
    const maxOutputPixels = 18_000_000;
    const areaLimitedScale = Math.sqrt(maxOutputPixels / area);
    const captureScale = Math.max(1.8, Math.min(3, dprScale, areaLimitedScale));

    // 预处理跨域图片：尝试设置 crossOrigin 属性
    await prepareImagesForCapture();

    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      foreignObjectRendering: false,
      scale: captureScale,
      backgroundColor: '#ffffff',
      logging: false,
      x: Math.max(0, Math.floor(window.scrollX + bounds.left)),
      y: Math.max(0, Math.floor(window.scrollY + bounds.top)),
      width: Math.max(1, Math.ceil(bounds.width)),
      height: Math.max(1, Math.ceil(bounds.height)),
      windowWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      windowHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      onclone: (clonedDoc) => {
        // 在克隆的文档中也处理图片
        const images = clonedDoc.querySelectorAll('img');
        images.forEach(img => {
          if (img.crossOrigin !== 'anonymous') {
            img.crossOrigin = 'anonymous';
          }
        });
      }
    });

    // 检查 canvas 是否被污染
    try {
      canvas.getContext('2d').getImageData(0, 0, 1, 1);
    } catch (e) {
      throw new Error('CORS_ERROR: 页面包含跨域图片，无法导出。请尝试在浏览器设置中允许跨域图片，或使用系统截图工具。');
    }

    const showWatermark = config.style?.showWatermark !== false;
    const watermarkHeight = showWatermark ? 170 : 0;
    const totalCanvas = document.createElement('canvas');
    totalCanvas.width = canvas.width;
    totalCanvas.height = canvas.height + watermarkHeight;
    const totalCtx = totalCanvas.getContext('2d');

    totalCtx.drawImage(canvas, 0, 0);

    if (showWatermark) {
      await drawWatermarkBar(totalCtx, totalCanvas.width, canvas.height, watermarkHeight);
    }

    return totalCanvas;
  }

  async function captureArticleScreenshot() {
    const captureBtn = document.getElementById('zdf-capture-btn');

    if (captureBtn) {
      captureBtn.classList.add('zdf-capture-loading');
      captureBtn.title = '截图中...';
    }

    try {
      const totalCanvas = await buildArticleCaptureCanvas();
      const title = document.title;
      const mode = translationActive ? 'bilingual' : 'original';
      const baseName = buildArticleExportBaseName(title, mode);
      await downloadOptimizedCanvas(totalCanvas, baseName);
    } catch (error) {
      console.error('[ZDFTranslate] 截图失败:', error);
      handleExportError(error, 'screenshot');
    } finally {
      if (captureBtn) {
        captureBtn.classList.remove('zdf-capture-loading');
      }
      updateCaptureButtonState();
    }
  }

  // 处理导出错误，提供友好的错误信息
  function handleExportError(error, type) {
    const action = type === 'pdf' ? 'PDF导出' : '截图';
    let message = error.message || '未知错误';
    
    // 检测 CORS 相关错误
    if (message.includes('CORS_ERROR') || 
        message.includes('Tainted canvases') || 
        message.includes('tainted') ||
        message.includes('cross-origin') ||
        message.includes('getImageData')) {
      message = `${action}失败：页面包含跨域图片（CORS限制）\n\n解决方法：\n1. 使用浏览器扩展 Allow CORS 临时允许跨域\n2. 使用系统截图工具（Win+Shift+S / Cmd+Shift+4）\n3. 尝试打印为PDF（Ctrl+P / Cmd+P）\n\n技术原因：某些网站图片服务器未配置跨域访问权限。`;
    } else {
      message = `${action}失败: ${message}`;
    }
    
    alert(message);
  }

  async function exportArticlePdf() {
    const pdfBtn = document.getElementById('zdf-pdf-btn');

    if (pdfBtn) {
      pdfBtn.classList.add('zdf-capture-loading');
      pdfBtn.title = '导出PDF中...';
    }

    try {
      const totalCanvas = await buildArticleCaptureCanvas();
      const mode = translationActive ? 'bilingual' : 'original';
      const title = document.title;
      const baseName = buildArticleExportBaseName(title, mode);

      const jspdfNS = window.jspdf;
      if (!jspdfNS || !jspdfNS.jsPDF) {
        throw new Error('PDF模块未加载，请刷新页面后重试');
      }

      const { jsPDF } = jspdfNS;
      // 使用 A4 分页导出，避免长文（尤其双语）在单页自定义尺寸下被截断
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4',
        compress: true,
      });

      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();

      // 以整页宽度铺满，反推每页可容纳的 canvas 像素高度
      const sliceHeightPx = Math.max(1, Math.floor(totalCanvas.width * (pdfH / pdfW)));
      const sourceCtx = totalCanvas.getContext('2d', { willReadFrequently: true });

      const rowInkScore = (rowY) => {
        const ySafe = Math.max(0, Math.min(totalCanvas.height - 1, rowY));
        const row = sourceCtx.getImageData(0, ySafe, totalCanvas.width, 1).data;
        let ink = 0;
        const step = Math.max(2, Math.floor(totalCanvas.width / 900));
        for (let x = 0; x < totalCanvas.width; x += step) {
          const i = x * 4;
          const r = row[i], g = row[i + 1], b = row[i + 2], a = row[i + 3];
          if (a < 8) continue;
          // 背景近白视为空白行，其它视为有内容（文本/边框/图片）
          if (!(r > 247 && g > 247 && b > 247)) ink++;
        }
        return ink;
      };

      const pickSmartBreak = (fromY, idealBreakY) => {
        const minSlice = Math.floor(sliceHeightPx * 0.64);
        const minY = Math.max(fromY + minSlice, idealBreakY - 520);
        const maxY = Math.min(totalCanvas.height - 1, idealBreakY + 320);

        if (maxY <= minY) return Math.min(totalCanvas.height, idealBreakY);

        let bestY = Math.min(totalCanvas.height, idealBreakY);
        let bestScore = Infinity;

        for (let y = minY; y <= maxY; y += 2) {
          // 用更宽的竖向窗口找“段落间空带”，尽量避开正文行
          let s = 0;
          for (let k = -5; k <= 5; k++) s += rowInkScore(y + k);

          // 轻微偏好靠近理想分页点，避免过早分页
          const distancePenalty = Math.abs(y - idealBreakY) * 0.015;
          const score = s + distancePenalty;

          if (score < bestScore) {
            bestScore = score;
            bestY = y;
            if (s === 0) break;
          }
        }

        return Math.max(fromY + 160, Math.min(totalCanvas.height, bestY));
      };

      let y = 0;
      let pageIndex = 0;

      while (y < totalCanvas.height) {
        const remaining = totalCanvas.height - y;
        let currentSliceH;

        if (remaining <= sliceHeightPx) {
          currentSliceH = remaining;
        } else {
          const idealBreakY = y + sliceHeightPx;
          const smartBreakY = pickSmartBreak(y, idealBreakY);
          currentSliceH = Math.max(120, smartBreakY - y);
        }

        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = totalCanvas.width;
        pageCanvas.height = currentSliceH;
        const pageCtx = pageCanvas.getContext('2d');
        pageCtx.drawImage(
          totalCanvas,
          0, y, totalCanvas.width, currentSliceH,
          0, 0, totalCanvas.width, currentSliceH
        );

        const imgData = pageCanvas.toDataURL('image/jpeg', 0.95);
        const renderH = (currentSliceH * pdfW) / totalCanvas.width;

        if (pageIndex > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, renderH, undefined, 'FAST');

        // 不做页间重叠，避免同一句在前后两页重复出现
        y += currentSliceH;
        pageIndex++;
      }

      pdf.save(`${baseName}.pdf`);
    } catch (error) {
      console.error('[ZDFTranslate] PDF导出失败:', error);
      handleExportError(error, 'pdf');
    } finally {
      if (pdfBtn) {
        pdfBtn.classList.remove('zdf-capture-loading');
      }
      updatePdfButtonState();
    }
  }

  async function warmupArticleForCapture(articleElement, options = {}) {
    const { deep = false } = options;
    const originalX = window.scrollX;
    const originalY = window.scrollY;

    try {
      const docEl = document.documentElement;
      const body = document.body;
      const maxScrollY = Math.max(0,
        (docEl?.scrollHeight || 0),
        (body?.scrollHeight || 0)
      ) - window.innerHeight;

      const articleRect = articleElement.getBoundingClientRect();
      const articleTopAbs = Math.max(0, window.scrollY + articleRect.top);
      const articleBottomAbs = Math.max(articleTopAbs, window.scrollY + articleRect.bottom);

      const targetBottom = Math.min(maxScrollY, articleBottomAbs + (deep ? 2600 : 1500));
      const steps = deep ? 8 : 5;
      const startY = Math.min(window.scrollY, articleTopAbs);

      for (let i = 0; i <= steps; i++) {
        const y = Math.min(targetBottom, startY + (targetBottom - startY) * (i / steps));
        window.scrollTo(0, Math.max(0, Math.floor(y)));
        await new Promise(resolve => setTimeout(resolve, deep ? 180 : 130));
      }

      // 给懒加载图片/正文一点收尾时间
      await new Promise(resolve => setTimeout(resolve, deep ? 220 : 140));
    } catch (e) {
      console.warn('[ZDFTranslate] warmupArticleForCapture failed:', e);
    } finally {
      window.scrollTo(originalX, originalY);
      await new Promise(resolve => setTimeout(resolve, 80));
    }
  }

  function detectNextArticleBoundary(articleElement, startY, titleEl) {
    const rootRect = articleElement.getBoundingClientRect();
    const titleText = (titleEl?.innerText || '').trim().toLowerCase();
    const scanBottom = startY + 10000;

    const isDifferentFromCurrentTitle = (txt) => {
      const t = (txt || '').trim().toLowerCase();
      if (!t || t.length < 24) return false;
      if (!titleText) return true;
      return t !== titleText && !titleText.includes(t) && !t.includes(titleText);
    };

    let nextTop = Infinity;

    // 仅使用强信号，避免误判导致正文截断
    const h1Candidates = Array.from(document.querySelectorAll('h1')).map(el => ({ el, r: el.getBoundingClientRect() }));
    for (const { el, r } of h1Candidates) {
      if (!r || r.height < 24 || r.width < 200) continue;
      if (r.top <= startY + 1000 || r.top > scanBottom) continue;
      const centerX = r.left + r.width / 2;
      const xOverlap = centerX >= rootRect.left - 200 && centerX <= rootRect.right + 200;
      if (!xOverlap) continue;
      if (!isDifferentFromCurrentTitle(el.innerText)) continue;
      nextTop = Math.min(nextTop, r.top);
    }

    // 次强信号：明确的后续 article 块（且有标题结构）
    const siblingArticles = Array.from(document.querySelectorAll('article, [role="article"]')).map(el => ({ el, r: el.getBoundingClientRect() }));
    for (const { el, r } of siblingArticles) {
      if (!r || r.height < 260 || r.width < 300) continue;
      if (r.top <= startY + 1200 || r.top > scanBottom) continue;

      const textLen = (el.innerText || '').trim().length;
      const h1 = el.querySelector('h1');
      const h2 = el.querySelector('h2');
      const headingText = (h1?.innerText || h2?.innerText || '').trim();

      if ((h1 || h2) && textLen > 700 && isDifferentFromCurrentTitle(headingText)) {
        nextTop = Math.min(nextTop, r.top);
      }
    }

    return Number.isFinite(nextTop) ? nextTop : null;
  }

  // 计算截图区域：仅保留“标题开始 -> 文章结束”的纵向范围，保留原网页样式
  function getArticleCaptureBounds(articleElement) {
    const rootRect = articleElement.getBoundingClientRect();
    if (!rootRect || rootRect.width <= 0 || rootRect.height <= 0) return null;

    const translatedNodes = Array.from(
      articleElement.querySelectorAll('[data-zdf-translated], .zdf-translated, .zdf-translation-container')
    ).filter(el => {
      const r = el.getBoundingClientRect();
      return r && r.width > 8 && r.height > 8;
    });

    // 标题优先：支持 h1 在 article 外层（常见于新闻站）
    let titleEl = articleElement.querySelector('h1');
    if (!titleEl) {
      const h1Candidates = Array.from(document.querySelectorAll('h1')).filter(h1 => {
        const r = h1.getBoundingClientRect();
        if (!r || r.width < 120 || r.height < 20) return false;
        const centerX = r.left + r.width / 2;
        const overlapX = centerX >= rootRect.left - 120 && centerX <= rootRect.right + 120;
        const nearY = r.top <= rootRect.top + 220 && r.bottom >= rootRect.top - 520;
        return overlapX && nearY;
      });
      if (h1Candidates.length > 0) {
        titleEl = h1Candidates.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
      }
    }

    const titleTop = titleEl ? titleEl.getBoundingClientRect().top : rootRect.top;
    const startY = Math.min(rootRect.top, titleTop) - 28; // 给标题额外安全边距，避免截断

    // 结束位置：取正文节点真实底部，避免最后一段被截
    const contentNodes = Array.from(articleElement.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figure,img,video,table,ul,ol,.zdf-translated,[data-zdf-translated]'
    )).filter(el => {
      if (!el || el.closest('nav,header,footer,aside,.sidebar,.menu')) return false;
      const r = el.getBoundingClientRect();
      return r && r.width > 10 && r.height > 8;
    });

    // 结束位置：按“正文连续流”计算，避免把下篇文章截进来
    let endY = rootRect.bottom + 72;
    if (contentNodes.length > 0) {
      const titleRect = titleEl ? titleEl.getBoundingClientRect() : null;
      const flowCenterX = titleRect
        ? (titleRect.left + titleRect.right) / 2
        : (rootRect.left + rootRect.right) / 2;

      const flowNodes = contentNodes
        .map(el => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => {
          if (!r || r.bottom < startY || r.height < 8 || r.width < 16) return false;
          const overlapCenter = flowCenterX >= r.left - 40 && flowCenterX <= r.right + 40;
          const wideEnough = r.width >= Math.max(220, rootRect.width * 0.35);
          return overlapCenter || wideEnough;
        })
        .sort((a, b) => a.r.top - b.r.top);

      if (flowNodes.length > 0) {
        let lastBottom = flowNodes[0].r.bottom;
        let largeGapCount = 0;
        let largeGapStreak = 0;

        for (let i = 1; i < flowNodes.length; i++) {
          const r = flowNodes[i].r;
          const gap = r.top - lastBottom;

          // 大图新闻常见“头图后大空白”，单次大 gap 不应直接判定结束
          if (gap > 700) {
            largeGapCount++;
            largeGapStreak++;
          } else if (gap > 420) {
            largeGapCount++;
            largeGapStreak = 0;
          } else {
            largeGapStreak = 0;
          }

          // 仅在多次明显断层时才提前停止（防止只截到头图）
          if (largeGapStreak >= 2 || (largeGapCount >= 3 && gap > 520)) break;

          lastBottom = Math.max(lastBottom, r.bottom);
        }

        endY = lastBottom + 72;
      } else {
        endY = Math.max(...contentNodes.map(el => el.getBoundingClientRect().bottom)) + 72;
      }
    }

    // 双语模式下：最后翻译段通常更接近真实文末；只扩展不收缩，避免末尾被砍
    if (translatedNodes.length > 0) {
      const translatedBottom = Math.max(...translatedNodes.map(el => el.getBoundingClientRect().bottom));
      endY = Math.max(endY, translatedBottom + 80);
    }

    // 截断到“正文之后的分界块”之前（避免把相关文章/评论区截进来）
    const boundarySelectors = [
      '.related', '.related-posts', '.related-articles', '.recommend', '.recommendation',
      '.more-articles', '.also-read', '.read-more', '.read-next',
      '.comments', '.comment-section', '#comments', '#disqus_thread',
      '.footer', 'footer'
    ];

    let boundaryTop = Infinity;
    for (const sel of boundarySelectors) {
      articleElement.querySelectorAll(sel).forEach(el => {
        const r = el.getBoundingClientRect();
        if (!r || r.height < 20) return;
        if (r.top > startY + 120 && r.top < boundaryTop) boundaryTop = r.top;
      });
    }
    if (Number.isFinite(boundaryTop)) {
      endY = Math.min(endY, boundaryTop - 10);
    }

    // 检测“下一篇文章起点”并强制裁断，避免把下篇一起截进来（Bloomberg 等）
    const nextArticleTop = detectNextArticleBoundary(articleElement, startY, titleEl);
    if (nextArticleTop) {
      // 仅在“明显超出当前正文”时才裁断，防止误判把正文截短
      const candidateEnd = nextArticleTop - 28;
      if (candidateEnd > startY + 1000 && endY - candidateEnd > 260) {
        endY = Math.min(endY, candidateEnd);
      }
    }

    // 避免无限过长，但允许长文完整截图
    endY = Math.min(endY, rootRect.bottom + 12000);

    // 左右边界：按真实内容边界裁剪，删除外侧空白（保留少量边距）
    let left = Math.max(0, rootRect.left);
    let right = rootRect.right;

    const lrRects = contentNodes
      .map(el => el.getBoundingClientRect())
      .filter(r => r && r.bottom >= startY && r.top <= endY && r.width > 30 && r.height > 8);

    if (titleEl) {
      const tr = titleEl.getBoundingClientRect();
      if (tr && tr.width > 80 && tr.height > 16) lrRects.push(tr);
    }

    if (lrRects.length > 0) {
      const minLeft = Math.min(...lrRects.map(r => r.left));
      const maxRight = Math.max(...lrRects.map(r => r.right));
      const docRight = Math.max(document.documentElement.clientWidth, document.documentElement.scrollWidth);

      left = Math.max(0, minLeft - 16);
      right = Math.min(docRight, maxRight + 16);

      // 避免被异常节点压得太窄
      const minWidth = 420;
      if (right - left < minWidth) {
        const mid = (left + right) / 2;
        left = Math.max(0, mid - minWidth / 2);
        right = Math.min(docRight, mid + minWidth / 2);
      }
    }

    // 保底与边界修正
    const top = Math.max(0, Math.min(startY, endY - 50));
    if (endY <= top + 20) endY = top + Math.max(260, rootRect.height * 0.7);
    const width = Math.max(50, right - left);
    const height = Math.max(50, endY - top);

    return { left, top, width, height };
  }

  // 创建干净的文章容器（克隆文章内容，排除所有非文章元素）
  function createCleanArticleContainer(articleElement) {
    const container = document.createElement('div');
    container.id = 'zdf-capture-container';
    container.style.cssText = `
      position: fixed;
      left: -99999px;
      top: 0;
      width: 800px;
      max-width: 800px;
      background: #ffffff;
      padding: 40px 50px;
      font-family: -apple-system, "PingFang SC", "SF Pro Text", "Segoe UI", "Microsoft YaHei", sans-serif;
      line-height: 1.8;
      color: #333;
      z-index: -1;
      overflow: visible;
    `;

    // 1. 深克隆整个文章区域
    const clonedArticle = articleElement.cloneNode(true);

    // 2. 从克隆中移除所有不需要的内容

    // 2a. 移除明确的非文章区域
    const removeSelectors = [
      // 导航、侧边栏、页脚
      'nav', 'aside', 'footer', 'header',
      '.sidebar', '.side-bar', '.side_bar', '[class*="sidebar"]', '[id*="sidebar"]',
      '.nav', '.navigation', '.menu', '.breadcrumb',
      // 评论区
      '.comments', '.comment-section', '.comment-list', '#comments', '#disqus_thread',
      '[class*="comment"]', '[id*="comment"]',
      // 相关文章、推荐
      '.related', '.related-posts', '.related-articles', '.recommend',
      '.more-articles', '.also-read', '.read-more', '.read-next',
      '[class*="related"]', '[class*="recommend"]',
      // 分享、社交
      '.share', '.social', '.social-share', '.share-buttons', '.sharing',
      '[class*="share"]', '[class*="social"]',
      // 广告（全面覆盖）
      '.ad', '.ads', '.adsbygoogle', '.advertisement', '.advertorial',
      '.ad-container', '.ad-wrapper', '.ad-slot', '.ad-banner', '.ad-block',
      '.ad-placement', '.ad-unit', '.ad-zone', '.ad-box', '.ad-label',
      '[class*="ad-container"]', '[class*="ad-wrapper"]', '[class*="ad-slot"]',
      '[class*="ad-banner"]', '[class*="ad-block"]', '[class*="ad-placement"]',
      '[id*="ad-"]', '[id*="ad_"]', '[id*="ads-"]', '[id*="ads_"]',
      '[data-ad]', '[data-ads]', '[data-ad-slot]', '[data-ad-unit]',
      'ins.adsbygoogle', 'ins[class*="ads"]',
      '.dfp-ad', '.google-ad', '[class*="doubleclick"]',
      '.sponsored', '.sponsor', '.promotion', '.promo',
      '[class*="sponsor"]', '[class*="promo"]',
      // 订阅、Newsletter
      '.newsletter', '.subscribe', '.subscription', '.signup',
      '[class*="newsletter"]', '[class*="subscribe"]',
      // 其他非内容
      '.tags', '.tag-list', '.post-tags',
      '.author-bio', '.author-box', '.about-author',
      'script', 'style', 'iframe', 'noscript',
      // 固定定位的元素（悬浮条、cookie通知等）
      '[style*="position: fixed"]', '[style*="position:fixed"]',
    ];

    for (const sel of removeSelectors) {
      try {
        clonedArticle.querySelectorAll(sel).forEach(el => el.remove());
      } catch(e) { /* 选择器语法错误则跳过 */ }
    }

    // 2b. 通过启发式检测移除广告和非内容块
    clonedArticle.querySelectorAll('div, section, aside, ins, span').forEach(el => {
      if (isAdElement(el)) {
        el.remove();
        return;
      }
      // 检测「文中插入广告」：短文本 + 有链接 + 非文章段落特征
      if (el.tagName === 'DIV' || el.tagName === 'SECTION') {
        const text = (el.innerText || '').trim();
        const links = el.querySelectorAll('a');
        const hasTranslation = el.querySelector('[data-zdf-translated], .zdf-translation-container');
        // 没有被翻译的内容 + 短文本 + 多链接 = 可能是广告/推广
        if (!hasTranslation && text.length < 300 && links.length >= 2) {
          const linkTextRatio = Array.from(links).reduce((s, a) => s + (a.textContent || '').length, 0) / Math.max(text.length, 1);
          if (linkTextRatio > 0.5) {
            el.remove();
            return;
          }
        }
      }
    });

    // 2c. 移除追踪像素和广告图片
    clonedArticle.querySelectorAll('img').forEach(img => {
      const src = img.src || img.dataset.src || '';
      const w = parseInt(img.getAttribute('width')) || img.naturalWidth || 0;
      const h = parseInt(img.getAttribute('height')) || img.naturalHeight || 0;
      if ((w <= 2 && h <= 2) ||
          src.includes('pixel') || src.includes('tracker') || src.includes('beacon') ||
          src.includes('doubleclick') || src.includes('googlesyndication') ||
          src.includes('facebook.com/tr') || src.includes('analytics')) {
        img.remove();
      }
    });

    // 3. 确定文章正文的上下边界
    //    上边界：第一个 h1 或第一个被翻译的元素
    //    下边界：最后一个被翻译的元素之后，允许再包含紧邻的少量同级元素（同段落收尾），
    //            但在遇到明显的分界元素时停止

    // 提取 h1 标题
    const h1 = clonedArticle.querySelector('h1');

    // 提取元信息
    const metaInfo = extractArticleMeta(articleElement);
    if (h1) {
      const titleClone = document.createElement('h1');
      titleClone.textContent = h1.textContent;
      titleClone.style.cssText = `
        font-size: 28px;
        font-weight: 700;
        color: #1a1a1a;
        margin: 0 0 8px 0;
        line-height: 1.4;
      `;
      container.appendChild(titleClone);
    }

    if (metaInfo) {
      const metaDiv = document.createElement('div');
      metaDiv.style.cssText = `
        font-size: 13px;
        color: #888;
        margin: 0 0 24px 0;
        line-height: 1.6;
        padding-bottom: 16px;
        border-bottom: 1px solid #eee;
      `;
      metaDiv.textContent = metaInfo;
      container.appendChild(metaDiv);
    }

    // 4. 收集正文内容节点
    //    遍历克隆后的文章，只保留从标题到最后翻译元素之间的内容
    const allNodes = clonedArticle.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, ol, ul, blockquote, figure, img, pre, table, .zdf-translation-container, [data-zdf-translated]');
    
    // 找到第一个和最后一个翻译元素在克隆DOM中的位置
    const translatedInClone = clonedArticle.querySelectorAll('[data-zdf-translated]');
    const firstTranslated = translatedInClone.length > 0 ? translatedInClone[0] : null;
    const lastTranslated = translatedInClone.length > 0 ? translatedInClone[translatedInClone.length - 1] : null;

    const seen = new Set();
    let reachedStart = !firstTranslated; // 如果没有翻译元素，从头开始
    let passedEnd = false;
    let trailingCount = 0; // 最后翻译元素之后允许的尾部元素数
    const MAX_TRAILING = 2; // 最多允许2个紧跟的段落（可能是同段落的收尾）

    for (const el of allNodes) {
      // 跳过 h1（已单独处理）
      if (el.tagName === 'H1') {
        reachedStart = true;
        continue;
      }

      // 等待到达文章起始位置
      if (!reachedStart) {
        if (el === firstTranslated || el.contains(firstTranslated) || (firstTranslated && firstTranslated.contains(el))) {
          reachedStart = true;
        } else {
          continue;
        }
      }

      // 检查是否已过文章末尾
      if (passedEnd) {
        trailingCount++;
        if (trailingCount > MAX_TRAILING) break;
        // 尾部元素必须有实质内容且已被翻译，否则停止
        const hasTranslation = el.hasAttribute('data-zdf-translated') || el.querySelector('[data-zdf-translated]');
        if (!hasTranslation) break;
      }

      // 标记是否到达末尾
      if (lastTranslated && (el === lastTranslated || el.contains(lastTranslated) || lastTranslated.contains(el))) {
        passedEnd = true;
      }

      // 避免重复
      let isDuplicate = false;
      for (const s of seen) {
        if (s.contains(el) || el.contains(s)) {
          isDuplicate = true;
          break;
        }
      }
      if (isDuplicate) continue;

      // 跳过空元素
      const text = (el.innerText || '').trim();
      if (!text && !el.querySelector('img')) continue;

      // 再次检查广告
      if (isAdElement(el)) continue;

      const clone = el.cloneNode(true);

      // 清理克隆内的残余垃圾
      clone.querySelectorAll('script, style, iframe, noscript, ins.adsbygoogle').forEach(j => j.remove());

      // 图片样式
      clone.querySelectorAll('img').forEach(img => {
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
        img.style.margin = '16px auto';
        img.style.borderRadius = '8px';
        if (img.dataset.src && (!img.src || !img.src.startsWith('http'))) img.src = img.dataset.src;
        if (img.dataset.originalSrc) img.src = img.dataset.originalSrc;
      });

      // 翻译样式
      clone.querySelectorAll('.zdf-translated').forEach(t => {
        t.style.cssText = `
          color: ${config.style.translationColor};
          font-size: ${config.style.translationSize};
          margin-top: 8px;
          padding: 10px 0 10px 14px;
          border-left: 3px solid #3b82f6;
          background: linear-gradient(to right, rgba(59, 130, 246, 0.06), transparent);
          line-height: ${config.style.lineSpacing};
        `;
      });

      // 标题样式
      const tag = el.tagName.toLowerCase();
      if (['h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
        clone.style.fontSize = ({ h2: '24px', h3: '20px', h4: '18px', h5: '16px', h6: '15px' })[tag];
        clone.style.fontWeight = '600';
        clone.style.color = '#1a1a1a';
        clone.style.margin = '28px 0 12px 0';
      }
      if (tag === 'p') {
        clone.style.margin = '12px 0';
        clone.style.lineHeight = '1.8';
      }

      container.appendChild(clone);
      seen.add(el);
    }

    document.body.appendChild(container);
    return { container, cleanup: () => container.remove() };
  }

  // 提取文章元信息（作者、发布时间、编辑时间）
  function extractArticleMeta(articleElement) {
    const parts = [];
    const seen = new Set();

    // 从原始页面搜索元信息（不是克隆的，避免被清理掉）
    const metaSelectors = [
      '[rel="author"]', '.author', '.byline', '.by-author', '[itemprop="author"]',
      '.post-author', '.entry-author', '.article-author',
      'time', '[datetime]', '.date', '.publish-date', '.post-date', '.entry-date',
      '.article-date', '[itemprop="datePublished"]', '.created-date',
      '[itemprop="dateModified"]', '.modified-date', '.updated-date', '.update-time', '.last-modified',
    ];

    // 搜索范围：文章内 + 文章的父容器（元信息有时在文章标签外面）
    const searchRoots = [articleElement];
    if (articleElement.parentElement && articleElement.parentElement !== document.body) {
      searchRoots.push(articleElement.parentElement);
    }

    // 也查找 h1 附近
    const h1 = articleElement.querySelector('h1') || document.querySelector('h1');
    if (h1 && h1.parentElement) {
      searchRoots.push(h1.parentElement);
    }

    for (const root of searchRoots) {
      for (const sel of metaSelectors) {
        try {
          root.querySelectorAll(sel).forEach(el => {
            if (el.closest('nav, aside, .comments, .sidebar')) return;
            const text = (el.textContent || '').trim();
            if (text && text.length > 0 && text.length < 200 && !seen.has(text)) {
              seen.add(text);
              parts.push(text);
            }
          });
        } catch(e) {}
      }
    }

    // 兜底：h1后面的短文本兄弟
    if (parts.length === 0 && h1) {
      let sibling = h1.nextElementSibling;
      for (let i = 0; i < 3 && sibling; i++) {
        const text = (sibling.textContent || '').trim();
        const tag = sibling.tagName.toLowerCase();
        if (text.length > 0 && text.length < 150 && !['p', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
          if (/\d{4}[-/]\d{1,2}[-/]\d{1,2}|author|by\s|编辑|作者|发布|更新|modified|published|ago|前|date|time/i.test(text)) {
            parts.push(text);
            break;
          }
        }
        sibling = sibling.nextElementSibling;
      }
    }

    return parts.length > 0 ? parts.join('  ·  ') : null;
  }

  // 检测是否为广告元素（向上检查5层祖先）
  function isAdElement(el) {
    // 检查元素本身及其祖先（最多5层）
    let node = el;
    for (let depth = 0; depth < 5 && node && node !== document.body; depth++) {
      const id = (node.id || '').toLowerCase();
      const cls = (node.className || '').toString().toLowerCase();
      const tag = node.tagName.toLowerCase();

      // 广告关键词匹配
      const adKeywords = [
        'adsbygoogle', 'ad-container', 'ad-wrapper', 'ad-slot', 'ad-banner',
        'ad-block', 'ad-placement', 'ad-unit', 'ad-zone', 'ad-box', 'ad-label',
        'advertisement', 'advertorial', 'sponsored', 'sponsor',
        'promo', 'promotion', 'dfp-ad', 'google-ad', 'doubleclick',
        'outbrain', 'taboola', 'mgid', 'revcontent', 'content-ad',
      ];
      for (const kw of adKeywords) {
        if (id.includes(kw) || cls.includes(kw)) return true;
      }

      // data-ad 属性
      if (node.hasAttribute && (node.hasAttribute('data-ad') || node.hasAttribute('data-ad-slot') ||
          node.hasAttribute('data-ad-unit') || node.hasAttribute('data-ads'))) {
        return true;
      }

      // ins 标签（AdSense）
      if (tag === 'ins' && (cls.includes('ads') || node.hasAttribute('data-ad-client'))) return true;

      node = node.parentElement;
    }

    return false;
  }

  // 查找文章主体元素（兼容：已翻译双语页 + 未翻译原文页）
  function findArticleElement() {
    // 先尝试：基于翻译标记定位（双语模式更准）
    const translatedEls = Array.from(document.querySelectorAll('[data-zdf-translated], .zdf-translation-container, .zdf-translated')).filter(el => {
      if (!el || el.closest('nav,header,footer,aside,[role="navigation"],.sidebar,.menu')) return false;
      const rect = el.getBoundingClientRect();
      if (!rect || rect.width < 50 || rect.height < 14) return false;
      const text = (el.innerText || '').trim();
      return text.length >= 10;
    });

    if (translatedEls.length > 0) {
      // 先按页面位置锁定“第一篇正文”的翻译节点（修复彭博同页多篇时命中最后一篇）
      const sortedTranslated = translatedEls
        .slice()
        .sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return ar.top - br.top;
        });

      const firstTranslatedEl = sortedTranslated[0];
      const strictContainer = firstTranslatedEl.closest(
        'article, [role="article"], .article-content, .article-body, .post-content, .entry-content, .story-body, .post-body'
      );
      if (strictContainer && strictContainer !== document.body && strictContainer !== document.documentElement) {
        return strictContainer;
      }

      // 回退：在常见容器中找与首个翻译节点最近的容器
      const containerSelector = 'article, main, [role="main"], .post-content, .entry-content, .article-content, .article-body, .post-body, .story-body, .content-body, .content, #content, section';
      const candidateSet = new Set();
      sortedTranslated.forEach(el => {
        const c = el.closest(containerSelector);
        if (c && c !== document.body && c !== document.documentElement) candidateSet.add(c);
      });

      const anchorRect = firstTranslatedEl.getBoundingClientRect();
      const anchorTop = anchorRect.top;
      const anchorCenterX = anchorRect.left + anchorRect.width / 2;

      let bestContainer = null;
      let bestScore = -1;
      candidateSet.forEach(c => {
        const rect = c.getBoundingClientRect();
        if (!rect || rect.width < 220 || rect.height < 220) return;

        const translatedCount = c.querySelectorAll('[data-zdf-translated], .zdf-translated, .zdf-translation-container').length;
        const paraCount = c.querySelectorAll('p').length;
        const textLen = Math.min((c.innerText || '').trim().length, 12000);
        const areaPenalty = Math.max(0, (rect.width * rect.height - 1_400_000) / 140000);

        const topDistancePenalty = Math.abs(rect.top - anchorTop) * 0.5;
        const centerX = rect.left + rect.width / 2;
        const xDistancePenalty = Math.abs(centerX - anchorCenterX) * 0.15;

        const score = translatedCount * 22 + paraCount * 8 + textLen / 50 - areaPenalty - topDistancePenalty - xDistancePenalty;
        if (score > bestScore) {
          bestScore = score;
          bestContainer = c;
        }
      });

      if (bestContainer) return bestContainer;

      if (translatedEls.length === 1) {
        return translatedEls[0].closest('article, main, [role="main"], .content, section') || translatedEls[0].parentElement;
      }
    }

    // 再尝试：通用文章容器（原文模式）
    const selectors = [
      'article',
      '[role="article"]',
      '.post-content', '.entry-content', '.article-content', '.article-body',
      '.post-body', '.story-body', '.content-body',
      'main', '[role="main"]',
      '.content', '#content',
    ];

    const scoreElement = (el) => {
      if (!el || el.closest('nav,header,footer,aside')) return -1;
      const rect = el.getBoundingClientRect();
      if (!rect || rect.width < 200 || rect.height < 200) return -1;
      const text = (el.innerText || '').trim();
      const pCount = el.querySelectorAll('p').length;
      const headingCount = el.querySelectorAll('h1,h2,h3').length;
      const textScore = Math.min(text.length, 6000) / 20;
      return textScore + pCount * 18 + headingCount * 12 + rect.height * 0.08;
    };

    let best = null;
    let bestScore = -1;
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const score = scoreElement(el);
        if (score > bestScore) {
          best = el;
          bestScore = score;
        }
      }
    }

    if (best) return best;

    // 最后兜底：body 下文本最多的可见子容器
    const candidates = Array.from(document.body.children).filter(el => {
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'nav', 'header', 'footer', 'aside'].includes(tag)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 200 && rect.height > 200;
    });

    if (candidates.length === 0) return null;
    return candidates.reduce((bestEl, el) => {
      const bestLen = (bestEl?.innerText || '').length;
      const len = (el.innerText || '').length;
      return len > bestLen ? el : bestEl;
    }, candidates[0]);
  }

  // 找两个元素的最小公共祖先
  function findCommonAncestor(el1, el2) {
    const ancestors = new Set();
    let node = el1;
    while (node) {
      ancestors.add(node);
      node = node.parentElement;
    }
    node = el2;
    while (node) {
      if (ancestors.has(node)) return node;
      node = node.parentElement;
    }
    return document.body;
  }

  // 创建截图按钮（支持：未翻译截原文 / 已翻译截双语）
  function createCaptureButton() {
    if (document.getElementById('zdf-capture-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'zdf-capture-btn';
    btn.className = 'zdf-capture-btn';
    btn.innerHTML = `
      <svg class="zdf-capture-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 7.5h3l1.2-2h7.6l1.2 2H20a1.8 1.8 0 0 1 1.8 1.8v8.7A1.8 1.8 0 0 1 20 19.8H4A1.8 1.8 0 0 1 2.2 18V9.3A1.8 1.8 0 0 1 4 7.5Z"/>
        <circle cx="12" cy="13" r="3.6"/>
      </svg>
    `;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      captureArticleScreenshot();
    });

    document.body.appendChild(btn);
    updateCaptureButtonState();
  }

  function createPdfButton() {
    if (document.getElementById('zdf-pdf-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'zdf-pdf-btn';
    btn.className = 'zdf-capture-btn zdf-pdf-btn';
    btn.innerHTML = `
      <svg class="zdf-capture-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 3 14 8 19 8"/>
        <path d="M8 13h8M8 17h6"/>
      </svg>
    `;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportArticlePdf();
    });

    document.body.appendChild(btn);
    updatePdfButtonState();
  }

  function updateCaptureButtonState() {
    const btn = document.getElementById('zdf-capture-btn');
    if (!btn || btn.classList.contains('zdf-capture-loading')) return;
    const tip = translationActive ? '截图双语' : '截图原文';
    btn.title = translationActive ? '截图双语文章' : '截图原文文章';
    btn.setAttribute('data-tip', tip);
  }

  function updatePdfButtonState() {
    const btn = document.getElementById('zdf-pdf-btn');
    if (!btn || btn.classList.contains('zdf-capture-loading')) return;
    const tip = translationActive ? '导出双语PDF' : '导出原文PDF';
    btn.title = translationActive ? '导出双语PDF' : '导出原文PDF';
    btn.setAttribute('data-tip', tip);
  }

  // 修改 updateFloatingButtonState：始终显示截图/导出按钮，按状态动态切换模式
  const _originalUpdateState = updateFloatingButtonState;
  updateFloatingButtonState = function() {
    _originalUpdateState();
    createCaptureButton();
    createPdfButton();
    updateCaptureButtonState();
    updatePdfButtonState();
  };

  // 页面加载完成后创建悬浮按钮
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingButton);
  } else {
    createFloatingButton();
  }

})();
