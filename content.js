// ZDFTranslate - Content Script
// 核心功能：识别页面主要内容并注入翻译

(function() {
  'use strict';

  console.log('[ZDFTranslate] Content script 开始加载...');

  // 防止重复注入
  if (window.zdfTranslateLoaded) {
    console.log('[ZDFTranslate] 已加载，跳过');
    return;
  }
  window.zdfTranslateLoaded = true;
  
  console.log('[ZDFTranslate] Content script 已加载，当前页面:', window.location.href);

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
      translationColor: '#666666',
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
    // 不再自动翻译，只加载配置
    console.log('[ZDFTranslate] 配置加载完成，等待用户触发翻译');
  });
  
  // 重新加载配置
  async function reloadConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['zdfConfig'], (result) => {
        if (result.zdfConfig) {
          config = { ...config, ...result.zdfConfig };
          console.log('配置已更新:', { targetLang: config.targetLang, service: config.translationService });
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
    // 检查是否仍处于翻译状态
    if (!translationActive) {
      console.log('[ZDFTranslate] 翻译已取消，跳过 processElement');
      return;
    }
    
    const paragraphs = element.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
    const toTranslate = [];
    
    // 收集需要翻译的段落
    for (const p of paragraphs) {
      if (shouldTranslate(p)) {
        toTranslate.push(p);
      }
    }
    
    // 使用批量翻译提高速度（每批3个，并发2个批次）
    await translateWithConcurrency(toTranslate, 3, 2);
  }
  
  // 带并发控制的批量翻译
  async function translateWithConcurrency(elements, batchSize, concurrency) {
    const batches = [];
    
    // 将元素分组
    for (let i = 0; i < elements.length; i += batchSize) {
      batches.push(elements.slice(i, i + batchSize));
    }
    
    console.log(`[ZDFTranslate] 开始批量翻译: ${elements.length} 个段落, ${batches.length} 批, 并发 ${concurrency}`);
    
    // 并发处理批次
    const results = [];
    for (let i = 0; i < batches.length; i += concurrency) {
      // 检查是否已取消
      if (!translationActive) {
        console.log('[ZDFTranslate] 翻译已取消，停止后续批次');
        break;
      }
      
      // 并发执行当前批次的翻译
      const currentBatches = batches.slice(i, i + concurrency);
      const batchPromises = currentBatches.map((batch, idx) => 
        translateBatchWithDisplay(batch, i + idx)
      );
      
      // 等待当前并发批次完成
      await Promise.all(batchPromises);
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
        console.log('[ZDFTranslate] 翻译已取消，跳过显示批次', batchIndex);
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
      
      console.log(`[ZDFTranslate] 批次 ${batchIndex} 完成: ${elements.length} 个段落`);
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
    const originalText = element.innerText.trim();
    if (!originalText) return;

    element.dataset.zdfTranslated = 'true';

    try {
      const translatedText = await translateText(originalText);
      
      // API 返回后再次检查翻译状态，如果已取消则不插入翻译结果
      if (!translationActive) {
        console.log('[ZDFTranslate] 翻译已取消，跳过插入结果');
        return;
      }
      
      if (config.displayMode === 'bilingual') {
        insertBilingual(element, originalText, translatedText);
      } else if (config.displayMode === 'replace') {
        element.innerText = translatedText;
      }
    } catch (error) {
      const errorMsg = error?.message || error?.toString() || '未知错误';
      console.error('ZDFTranslate: Translation failed -', errorMsg, error);
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
      border-left: 3px solid #e03131;
      background: linear-gradient(to right, rgba(224, 49, 49, 0.03), transparent);
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
    console.log('[ZDFTranslate] 翻译请求:', {
      service: config.translationService,
      targetLang: config.targetLang,
      sourceLang: config.sourceLang,
      textPreview: text.slice(0, 50)
    });
    
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'translate',
        text: text,
        targetLang: config.targetLang,
        sourceLang: config.sourceLang,
        service: config.translationService
      }, (response) => {
        if (response && response.translatedText) {
          resolve(response.translatedText);
        } else {
          reject(new Error(response?.error || 'Translation failed'));
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
      console.log('[ZDFTranslate] 检测到配置变化，重新翻译:', lastSettings, '->', currentSettings);
      restoreOriginal();
    }
    document.body.dataset.zdfLastSettings = currentSettings;
    
    // 标记翻译状态
    translationActive = true;
    document.body.dataset.zdfActive = 'true';
    
    // 立即翻译当前可见区域的内容
    const contentBlocks = findContentBlocks();
    
    for (const block of contentBlocks) {
      // 检查元素是否在视口内或附近
      const rect = block.getBoundingClientRect();
      const isInViewport = rect.top < window.innerHeight + 500 && rect.bottom > -500;
      
      if (isInViewport) {
        await processElement(block);
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
  }

  // 恢复原文
  function restoreOriginal() {
    translationActive = false;
    delete document.body.dataset.zdfActive;
    
    console.log('[ZDFTranslate] 开始恢复原文，找到', document.querySelectorAll('[data-zdf-translated]').length, '个翻译元素');
    
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
    
    console.log('[ZDFTranslate] 原文恢复完成');
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

})();
