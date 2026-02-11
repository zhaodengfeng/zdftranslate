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
      logo.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"/>
      </svg>`;

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
      originalDiv.textContent = originalText || '';
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

    // ===== 高清导出参数（解决模糊） =====
    const scale = 3;
    const baseWidth = 1242;
    const outerPadding = 84;
    const contentWidth = baseWidth - outerPadding * 2;

    // ===== 偏锤子便签的极简字体排版 =====
    const fontOriginal = '500 50px "PingFang SC", "SF Pro Display", "Inter", "Segoe UI", "Microsoft YaHei", sans-serif';
    const fontTranslated = '380 48px "PingFang SC", "SF Pro Text", "Inter", "Segoe UI", "Microsoft YaHei", sans-serif';
    const fontBrand = '380 38px "PingFang SC", "SF Pro Text", "Inter", "Segoe UI", "Microsoft YaHei", sans-serif';

    const lineHeight = 76;
    const topSpace = 112;
    const blockGap = 74;
    const paraInnerGap = 30;
    const footerArea = 220;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const wrapLines = (text, font) => {
      if (!text) return [];
      ctx.font = font;
      const chars = Array.from(text);
      const lines = [];
      let line = '';
      for (const ch of chars) {
        const test = line + ch;
        if (ctx.measureText(test).width > contentWidth && line) {
          lines.push(line);
          line = ch;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      return lines;
    };

    const blocks = pairs.map((p) => ({
      originalLines: wrapLines(p.original, fontOriginal),
      translatedLines: wrapLines(p.translated, fontTranslated)
    }));

    let contentHeight = topSpace;
    blocks.forEach((b) => {
      contentHeight += b.originalLines.length * lineHeight;
      contentHeight += paraInnerGap;
      contentHeight += b.translatedLines.length * lineHeight;
      contentHeight += blockGap;
    });

    const baseHeight = Math.max(1050, contentHeight + footerArea + 32);

    // 先按高清像素创建，再缩放绘制（抗锯齿更好）
    canvas.width = Math.round(baseWidth * scale);
    canvas.height = Math.round(baseHeight * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.textBaseline = 'alphabetic';

    // ===== 便签背景（极简纸感） =====
    ctx.fillStyle = '#f7f6f3';
    ctx.fillRect(0, 0, baseWidth, baseHeight);

    let y = topSpace;
    blocks.forEach((b) => {
      // 原文（上）
      ctx.fillStyle = '#343230';
      ctx.font = fontOriginal;
      b.originalLines.forEach(line => {
        ctx.fillText(line, outerPadding, y);
        y += lineHeight;
      });

      y += paraInnerGap;

      // 译文（下）
      ctx.fillStyle = '#4f4d4b';
      ctx.font = fontTranslated;
      b.translatedLines.forEach(line => {
        ctx.fillText(line, outerPadding, y);
        y += lineHeight;
      });

      y += blockGap;
    });

    // 底部分割线 + 品牌
    const lineY = baseHeight - 198;
    ctx.strokeStyle = '#beb9b2';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(outerPadding, lineY);
    ctx.lineTo(baseWidth - outerPadding, lineY);
    ctx.stroke();

    ctx.fillStyle = '#5a5753';
    ctx.font = fontBrand;
    const brand = 'ZDFTranslate';
    const textWidth = ctx.measureText(brand).width;
    const brandY = baseHeight - 104;
    ctx.fillText(brand, (baseWidth - textWidth) / 2, brandY);

    // 方案A：品牌名下方居中短链
    const shortUrl = '下载插件：bit.ly/40094t1';
    ctx.fillStyle = '#8b8781';
    ctx.font = '380 26px "PingFang SC", "SF Pro Text", "Inter", "Segoe UI", "Microsoft YaHei", sans-serif';
    const linkWidth = ctx.measureText(shortUrl).width;
    ctx.fillText(shortUrl, (baseWidth - linkWidth) / 2, brandY + 42);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 1));
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zdftranslate-bilingual-note-hd-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      : (originalText ? originalText.split(/\n+/).map(s => s.trim()).filter(Boolean) : []);
    popupLatestTranslatedSegments = Array.isArray(translatedSegments) && translatedSegments.length
      ? translatedSegments
      : splitTranslatedParagraphs(translatedText);

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
    btn.innerHTML = `
      <svg class="zdf-float-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"/>
      </svg>
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
      if (badge) badge.style.display = 'flex';
    } else {
      // 隐藏绿勾徽章
      btn.classList.remove('zdf-float-translated');
      btn.title = isTranslating ? '翻译中...点击取消' : '点击翻译页面';
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
  
  // 页面加载完成后创建悬浮按钮
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingButton);
  } else {
    createFloatingButton();
  }

})();
