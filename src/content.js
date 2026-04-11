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
    translationService: 'microsoft-free',
    enableAIContentAware: false,
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

  let configReady = false;

  // 从存储加载配置
  chrome.storage.sync.get(['zdfConfig'], (result) => {
    if (result.zdfConfig) {
      config = { ...config, ...result.zdfConfig };
    }
    configReady = true;
    setTimeout(() => {
      updateFloatingButtonState();
    }, 0);
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
  let lastKnownTabId = 0;

  function getActualTranslationStatus() {
    const hasTranslationInDOM = document.querySelectorAll('[data-zdf-translated="true"]').length > 0;
    return translationActive || hasTranslationInDOM;
  }

  async function getSafeCurrentTabId() {
    const runtimeTabId = await getCurrentTabId();
    if (runtimeTabId) {
      lastKnownTabId = runtimeTabId;
      return runtimeTabId;
    }
    return lastKnownTabId || 0;
  }

  async function syncTabTranslationStatus(status = getActualTranslationStatus(), tabIdHint = 0) {
    try {
      const tabId = tabIdHint || await getSafeCurrentTabId();
      if (!tabId) return;
      chrome.runtime.sendMessage({
        action: 'setTabStatus',
        tabId,
        isTranslated: !!status
      }, () => { /* ignore lastError */ });
    } catch (e) {
      // 忽略同步失败，避免影响页面功能
    }
  }

  async function notifyTranslationStatusChanged(status = getActualTranslationStatus(), tabIdHint = 0) {
    try {
      const tabId = tabIdHint || await getSafeCurrentTabId();
      if (!tabId) return;
      chrome.runtime.sendMessage({
        action: 'translationStatusChanged',
        tabId,
        isTranslated: !!status
      }, () => { /* ignore lastError */ });
    } catch (e) {
      // 忽略通知失败，避免影响页面功能
    }
  }

  async function syncAndNotifyTranslationStatus(status = getActualTranslationStatus(), tabIdHint = 0) {
    await syncTabTranslationStatus(status, tabIdHint);
    await notifyTranslationStatusChanged(status, tabIdHint);
  }

  // 监听配置更新
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (sender?.tab?.id) {
      lastKnownTabId = sender.tab.id;
    }

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
      setTimeout(() => {
        updateFloatingButtonState();
      }, 0);
    } else if (request.action === 'translateSelection') {
      translateText(request.text).then(sendResponse);
      return true;
    } else if (request.action === 'getSelectionSegments') {
      sendResponse({ segments: getSelectionSegments() });
      return true;
    } else if (request.action === 'getTranslationStatus') {
      sendResponse({ isTranslated: getActualTranslationStatus() });
    } else if (request.action === 'startTranslation') {
      (async () => {
        await startTranslation();
        await syncAndNotifyTranslationStatus(true, sender?.tab?.id || 0);
        sendResponse({ success: true, isTranslated: getActualTranslationStatus() });
      })().catch((error) => {
        sendResponse({ success: false, error: error?.message || 'startTranslation failed' });
      });
      return true;
    } else if (request.action === 'restoreOriginal') {
      restoreOriginal();
      syncAndNotifyTranslationStatus(false, sender?.tab?.id || 0);
      sendResponse({ success: true, isTranslated: false });
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

    // 补充：如果已经在翻译状态，直接翻译游离标题（如 Bloomberg）
    if (translationActive) translateStandaloneHeadings();
  }

  // 直接翻译游离在内容块之外的 h1/h2 标题（兼容 Bloomberg 等站点）
  async function translateStandaloneHeadings() {
    const allH1 = Array.from(document.querySelectorAll('h1, h2'));
    // 常见导航/栏目标签，不翻译
    const SKIP_HEADINGS = /^(most read|trending|top stories|related|newsletter|sign up|subscribe|watch|listen|more from|latest|breaking|editors? pick|popular|sponsored|advertisement|also read|read more|see also|up next)$/i;
    const headings = allH1.filter(h => {
      if (h.dataset?.zdfTranslated) return false;
      const text = (h.innerText || '').trim();
      if (!text || text.length < 10 || isTargetLanguage(text)) return false;
      if (SKIP_HEADINGS.test(text)) return false;
      const rect = h.getBoundingClientRect();
      if (!rect || rect.width < 100 || rect.height < 8) return false;
      // 只处理视口附近的标题（首屏或稍微往下）
      if (rect.top > window.innerHeight * 2.5 || rect.bottom < -80) return false;
      const style = window.getComputedStyle(h);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) return false;
      return true;
    });
    for (const h of headings) {
      if (!translationActive) break;
      if (h.dataset?.zdfTranslated) continue;
      await translateParagraph(h);
    }
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
      if (score > 3000) {
        return bestElement;
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

  function findExternalHeadlineForBlock(element) {
    // Bloomberg 等站点常把主标题放在 article/main 外层，这里补一个就近兜底
    const hasLocalHeadline = !!element.querySelector('h1, h2');
    if (hasLocalHeadline) return null;

    const rootRect = element.getBoundingClientRect();
    const candidates = Array.from(document.querySelectorAll('h1, h2'))
      .filter((h) => {
        if (!h || h.dataset?.zdfTranslated) return false;
        if (element.contains(h)) return false;
        if (!shouldTranslate(h)) return false;

        const r = h.getBoundingClientRect();
        if (!r || r.width < 120 || r.height < 18) return false;

        // 只取离正文块较近的标题
        const nearTop = Math.abs(r.top - rootRect.top) < 520;
        const horizontalOverlap = !(r.right < rootRect.left || r.left > rootRect.right);
        return nearTop && horizontalOverlap;
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const ad = Math.abs(ar.top - rootRect.top);
        const bd = Math.abs(br.top - rootRect.top);
        if (ad !== bd) return ad - bd;
        return (br.width * br.height) - (ar.width * ar.height);
      });

    return candidates[0] || null;
  }

  // 处理元素内容 - 批量翻译提高速度
  async function processElement(element) {
    if (!translationActive) {
      return;
    }

    const paragraphs = element.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, dt, dd');
    const toTranslate = Array.from(paragraphs).filter(shouldTranslate);

    // 补充：查找直接包含文本的 div/section（不含子段落的文本容器）
    const textDivs = element.querySelectorAll('div, section');
    Array.from(textDivs).forEach(div => {
      if (div.dataset.zdfTranslated === 'true') return;
      // 跳过包含子段落的容器（避免重复翻译）
      if (div.querySelector('p, h1, h2, h3, h4, h5, h6, li, blockquote')) return;
      // 只取直接包含有意义文本的叶子 div
      const directText = Array.from(div.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim())
        .join('');
      if (directText.length >= 10 && shouldTranslate(div)) {
        toTranslate.push(div);
      }
    });

    const externalHeadline = findExternalHeadlineForBlock(element);
    if (externalHeadline) {
      toTranslate.unshift(externalHeadline);
    }

    if (!toTranslate.length) return;

    // 使用批量翻译提高速度（按服务动态调优）
    const tuning = getBatchTuning(config.translationService);
    await translateWithConcurrency(toTranslate, tuning.batchSize, tuning.concurrency);
  }

  // 根据翻译服务动态设置并发参数
  function getBatchTuning(service) {
    // 所有服务统一改为低并发、顺序翻译，营造"从上到下"的渐进感
    if (['microsoft-free', 'google-free'].includes(service)) {
      return { batchSize: 1, concurrency: 1 };
    }
    if (service === 'aliyun') {
      return { batchSize: 1, concurrency: 1 };
    }
    if (service === 'kimi') {
      return { batchSize: 2, concurrency: 1 };
    }
    if (['zhipu', 'openai', 'deepseek', 'openrouter', 'google', 'deepl'].includes(service) || String(service || '').startsWith('custom_')) {
      return { batchSize: 1, concurrency: 1 };
    }
    return { batchSize: 1, concurrency: 1 };
  }

  // 按文档顺序收集所有待翻译候选
  function collectTranslationCandidates() {
    const seen = new Set();
    const add = (el) => {
      if (el && !seen.has(el)) {
        seen.add(el);
        return true;
      }
      return false;
    };

    const candidates = [];

    // 1. 标题优先
    document.querySelectorAll('h1, h2').forEach(el => {
      if (shouldTranslate(el) && add(el)) candidates.push(el);
    });

    // 2. 正文段落、列表、引用等
    document.querySelectorAll('p, h3, h4, h5, h6, li, blockquote, figcaption, td, th, dt, dd').forEach(el => {
      if (shouldTranslate(el) && add(el)) candidates.push(el);
    });

    // 3. 叶子 div/section（直接包含文本但不含子段落）
    document.querySelectorAll('div, section').forEach(div => {
      if (div.querySelector('p, h1, h2, h3, h4, h5, h6, li, blockquote')) return;
      const directText = Array.from(div.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim())
        .join('');
      if (directText.length >= 10 && shouldTranslate(div) && add(div)) candidates.push(div);
    });

    return candidates;
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

    elements.forEach(el => el.classList.add('zdf-translating'));

    try {
      // 批量翻译多个段落
      const texts = elements.map(el => el.innerText.trim());
      const separator = self.ZDF_CONSTANTS?.PARA_BREAK || '\n\n---PARA_BREAK---\n\n';
      const combinedText = texts.join(separator);

      // 标记所有元素为已翻译（防止重复）
      elements.forEach(el => el.dataset.zdfTranslated = 'true');

      const translatedCombined = await translateText(combinedText);

      // 检查是否已取消
      if (!translationActive) {
        return;
      }

      const translatedParts = translatedCombined.split(separator);

      // 若返回段落数不匹配，说明 API 未能原样保留分隔符，回退单条翻译防止错乱/漏译
      if (translatedParts.length !== elements.length) {
        throw new Error(`批量翻译分隔符丢失：期望 ${elements.length} 段，实际 ${translatedParts.length} 段`);
      }

      // 立即显示每个翻译结果（流水线）
      elements.forEach((el, index) => {
        if (!translationActive) return;

        const originalText = texts[index];
        const translatedText = translatedParts[index].trim();

        if (translatedText) {
          if (config.displayMode === 'replace') {
            insertReplaceMode(el, originalText, translatedText);
          } else {
            insertBilingual(el, originalText, translatedText);
          }
        }
      });
    } catch (error) {
      console.error(`[ZDFTranslate] 批次 ${batchIndex} 失败:`, error.message);
      showInlineErrorToast(error?.message || '批量翻译失败');
      // 批量失败时回退到单段落翻译
      elements.forEach(el => {
        el.dataset.zdfTranslated = '';
      });
      for (const el of elements) {
        if (!translationActive) break;
        await translateParagraph(el);
        await sleep(80);
      }
    } finally {
      elements.forEach(el => el.classList.remove('zdf-translating'));
    }
  }

  // 辅助函数：延迟
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  let lastErrorToastAt = 0;
  function showInlineErrorToast(message) {
    const now = Date.now();
    if (now - lastErrorToastAt < 3000) return;
    lastErrorToastAt = now;

    let toast = document.getElementById('zdf-inline-error-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'zdf-inline-error-toast';
      toast.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#ef4444;color:#fff;padding:10px 12px;border-radius:10px;font-size:13px;max-width:320px;box-shadow:0 8px 24px rgba(0,0,0,.24);';
      document.documentElement.appendChild(toast);
    }
    toast.textContent = `翻译失败：${message || '请检查 API 服务设置'}`;
    toast.style.display = 'block';
    clearTimeout(showInlineErrorToast._timer);
    showInlineErrorToast._timer = setTimeout(() => {
      if (toast) toast.style.display = 'none';
    }, 3500);
  }

  // 判断是否应该翻译
  function shouldTranslate(element) {
    // 已翻译的跳过
    if (element.dataset.zdfTranslated === 'true') return false;

    // 导航/页眉/页脚/侧栏等区域不翻译，避免版式错位
    // 例外：h1/h2 元素本身就是标题，不可能是导航，直接跳过容器检查
    const isHeadingEl = /^h[12]$/i.test(element.tagName);
    if (!isHeadingEl) {
      const closestHeader = element.closest('nav, header, footer, aside, [role="navigation"], [role="banner"], .nav, .navbar, .menu, .breadcrumb, .toolbar');
      if (closestHeader) {
        const tagName = closestHeader.tagName?.toLowerCase();
        // 如果是 header/footer 标签且位于 article 或 main 内，允许翻译（文章级，非页面级）
        if ((tagName === 'header' || tagName === 'footer') && closestHeader.closest('article, main, [role="main"]')) {
          // 允许通过
        } else {
          return false;
        }
      }
    }

    // 代码块不翻译
    if (element.closest('pre, code')) return false;

    const text = element.innerText?.trim();

    // 文本太短不翻译
    if (!text || text.length < 10) return false;

    // 常见栏目标签/kicker 不翻译（仅按 class 判断，避免误伤正文标题）
    const cls = `${element.className || ''}`.toLowerCase();
    if (/(kicker|eyebrow|overline|label|tag|section-name|category)/.test(cls)) {
      return false;
    }

    // 检测是否已经是目标语言（简化版，可用 franc 库改进）
    if (isTargetLanguage(text)) return false;

    return true;
  }

  // 简单语言检测
  function isTargetLanguage(text) {
    // 日文假名、韩文 Hangul 需优先排除，避免误判为中文而跳过翻译
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return false;
    if (/[\uac00-\ud7af]/.test(text)) return false;
    // 如果包含大量中文字符，认为是中文
    const chineseChars = text.match(/[\u4e00-\u9fa5]/g);
    return chineseChars && chineseChars.length > text.length * 0.3;
  }

  // 翻译段落
  async function translateParagraph(element) {
    const originalText = element.innerText?.trim();
    if (!originalText) {
      element.classList.remove('zdf-translating');
      return;
    }
    if (element.dataset.zdfTranslated === 'true') return;

    element.classList.add('zdf-translating');
    element.dataset.zdfTranslated = 'true';

    try {
      const translatedText = await translateText(originalText);

      if (!translationActive) {
        element.classList.remove('zdf-translating');
        return;
      }

      if (config.displayMode === 'replace') {
        insertReplaceMode(element, originalText, translatedText);
      } else {
        insertBilingual(element, originalText, translatedText);
      }
    } catch (error) {
      console.error('ZDFTranslate: 翻译失败 -', error.message);
      showInlineErrorToast(error?.message || '段落翻译失败');
      element.dataset.zdfTranslated = '';
    } finally {
      element.classList.remove('zdf-translating');
    }
  }

  function safeRestoreHtml(element, htmlString) {
    if (!htmlString) {
      element.innerHTML = '';
      return;
    }
    const temp = document.createElement('div');
    temp.innerHTML = htmlString;
    temp.querySelectorAll('script').forEach((s) => s.remove());
    temp.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        if (attr.name.toLowerCase().startsWith('on')) {
          el.removeAttribute(attr.name);
        }
      });
    });
    element.innerHTML = '';
    while (temp.firstChild) {
      element.appendChild(temp.firstChild);
    }
  }

  function cleanupExistingTranslation(element) {
    // 移除同一节点内历史翻译容器，避免重试时重复插入
    element.querySelectorAll(':scope > .zdf-translation-container').forEach((node) => node.remove());

    // 若节点内容已被翻译容器包裹，先恢复原始 HTML 再重新插入
    if (element.dataset.zdfOriginalHtml) {
      const hasWrapped = element.querySelector('.zdf-translation-container');
      if (hasWrapped) {
        safeRestoreHtml(element, element.dataset.zdfOriginalHtml);
      }
    }
  }

  // 纯译文模式
  function insertReplaceMode(element, original, translated) {
    cleanupExistingTranslation(element);
    // 保存原始HTML - 确保只保存一次
    if (!element.dataset.zdfOriginalHtml) {
      element.dataset.zdfOriginalHtml = element.innerHTML;
      element.dataset.zdfOriginalText = original;
    }

    // <p> 不能嵌套 <div>，改用 <span display:block>
    const wrapperTag = element.tagName === 'P' ? 'span' : 'div';
    const container = document.createElement(wrapperTag);
    container.className = 'zdf-translation-container zdf-mode-replace';
    container.style.display = 'block';
    container.style.width = '100%';

    // 隐藏原文（不删除，以便恢复或对比）
    const originalDiv = document.createElement(wrapperTag === 'span' ? 'span' : 'div');
    originalDiv.className = 'zdf-original';
    safeRestoreHtml(originalDiv, element.dataset.zdfOriginalHtml);
    originalDiv.style.display = 'none'; // 关键：隐藏原文

    // 译文显示优化：字号稍大，行高舒适，仿书页效果
    const translatedDiv = document.createElement(wrapperTag === 'span' ? 'span' : 'div');
    translatedDiv.className = 'zdf-translated';
    translatedDiv.textContent = translated;

    // 动态样式：使用系统字体栈，不硬编码颜色以免与暗黑模式冲突
    translatedDiv.style.cssText = `
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 1.1em;
      line-height: 1.8;
      letter-spacing: 0.02em;
      text-align: justify;
      margin-bottom: 0.8em;
      color: inherit;
      display: block;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      box-sizing: border-box;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    `;
    translatedDiv.title = '双击或切换模式可查看原文';

    container.appendChild(originalDiv);
    container.appendChild(translatedDiv);

    element.innerHTML = '';
    element.appendChild(container);

    // 记录翻译的元素
    translatedElements.add(element);
  }

  // 双语对照模式
  function insertBilingual(element, original, translated) {
    cleanupExistingTranslation(element);
    // 保存原始HTML - 确保只保存一次
    if (!element.dataset.zdfOriginalHtml) {
      element.dataset.zdfOriginalHtml = element.innerHTML;
      element.dataset.zdfOriginalText = original;
    }

    // <p> 不能嵌套 <div>，改用 <span display:block>
    const wrapperTag = element.tagName === 'P' ? 'span' : 'div';
    const container = document.createElement(wrapperTag);
    container.className = 'zdf-translation-container';
    container.style.display = 'block';
    container.style.width = '100%';

    const originalDiv = document.createElement(wrapperTag === 'span' ? 'span' : 'div');
    originalDiv.className = 'zdf-original';
    safeRestoreHtml(originalDiv, element.dataset.zdfOriginalHtml);

    const translatedDiv = document.createElement(wrapperTag === 'span' ? 'span' : 'div');
    translatedDiv.className = 'zdf-translated';
    translatedDiv.textContent = translated;
    translatedDiv.style.cssText = `
      color: ${config.style.translationColor};
      font-size: ${config.style.translationSize};
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px dashed rgba(120,120,120,0.18);
      line-height: ${config.style.lineSpacing};
      transition: opacity 0.3s ease;
      display: block;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      box-sizing: border-box;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    `;

    container.appendChild(originalDiv);
    container.appendChild(translatedDiv);

    element.innerHTML = '';
    element.appendChild(container);

    // 记录翻译的元素
    translatedElements.add(element);
  }

  function getSelectedModelForService(serviceName) {
    return config?.selectedModels?.[serviceName] || '';
  }

  let articleContextCache = null;
  let articleContextCacheTime = 0;
  const ARTICLE_CONTEXT_TTL = 5000;

  function getArticleContext() {
    if (!config.enableAIContentAware) {
      return { articleTitle: '', articleSummary: '' };
    }
    const now = Date.now();
    if (articleContextCache && (now - articleContextCacheTime) < ARTICLE_CONTEXT_TTL) {
      return articleContextCache;
    }

    const title = (document.title || '').trim();
    const main = document.querySelector('article, main, [role="main"], .post-content, .entry-content, .article-body') || document.body;
    const raw = (main?.innerText || '').replace(/\s+/g, ' ').trim();
    const summary = raw.slice(0, 800);

    articleContextCache = {
      articleTitle: title,
      articleSummary: summary,
    };
    articleContextCacheTime = now;
    return articleContextCache;
  }

  // 调用翻译API（统一入口）
  async function translateText(text) {
    return new Promise((resolve, reject) => {
      if (!text || !text.trim()) {
        reject(new Error('空文本'));
        return;
      }

      const service = config.translationService;
      const model = getSelectedModelForService(service);
      const { articleTitle, articleSummary } = getArticleContext();

      chrome.runtime.sendMessage({
        action: 'translate',
        text: text,
        targetLang: config.targetLang,
        sourceLang: config.sourceLang,
        service,
        model,
        enableAIContentAware: !!config.enableAIContentAware,
        articleTitle,
        articleSummary,
        promptVersion: self.ZDF_CONSTANTS?.PROMPT_VERSION || 'v6-p1'
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && Object.prototype.hasOwnProperty.call(response, 'translatedText')) {
          resolve(response.translatedText || '');
        } else {
          reject(new Error(response?.error || '翻译失败'));
        }
      });
    });
  }

  // 移除所有翻译
  function removeTranslations() {
    document.querySelectorAll('[data-zdf-translated="true"]').forEach(el => {
      // 恢复原始内容
      if (el.dataset.zdfOriginalHtml) {
        safeRestoreHtml(el, el.dataset.zdfOriginalHtml);
      }
      // 清除所有标记
      el.dataset.zdfTranslated = '';
      el.dataset.zdfOriginalHtml = '';
      el.dataset.zdfOriginalText = '';
    });
    translatedElements.clear();
  }

  // 检查是否在排除列表
  function isExcludedSite() {
    const hostname = window.location.hostname;
    return config.excludedSites.some(site => hostname.includes(site));
  }

  function collectTopHeadlineCandidates() {
    const host = window.location.hostname || '';
    const isBloomberg = /(^|\.)bloomberg\.com$/i.test(host);

    const selectors = isBloomberg
      ? [
          // Bloomberg 常见标题节点（优先）
          'h1[data-testid*="headline"]',
          'h1[class*="headline"]',
          'h1[class*="Headline"]',
          '[data-testid="headline"] h1',
          '[data-testid*="story"] h1',
          '[data-testid*="headline"] [role="heading"]',
          '[role="heading"][aria-level="1"]',
          'article h1',
          'main h1',
          'h1'
        ]
      : [
          'h1',
          '[data-testid*="headline"]',
          '[data-testid*="Heading"]',
          '[class*="headline"]',
          '[class*="Headline"]',
          '[role="heading"][aria-level="1"]',
          '[role="heading"][aria-level="2"]'
        ];

    const pool = new Set();
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => pool.add(el));
    });

    const topViewport = window.innerHeight * (isBloomberg ? 1.8 : 1.2);

    return Array.from(pool)
      .filter((el) => {
        if (!el || !el.isConnected) return false;
        if (el.dataset?.zdfTranslated) return false;
        const closestExcluded = el.closest('nav, header, footer, aside, [class*="menu"], [class*="breadcrumb"]');
        if (closestExcluded) {
          const tagName = closestExcluded.tagName?.toLowerCase();
          // article/main 内部的 header 属于文章标题区，允许翻译（如 Bloomberg）
          if (!(tagName === 'header' && closestExcluded.closest('article, main'))) return false;
        }

        const text = (el.innerText || '').trim();
        if (!text || text.length < 8) return false;
        if (isTargetLanguage(text)) return false;

        const rect = el.getBoundingClientRect();
        if (!rect || rect.width < 140 || rect.height < 20) return false;
        if (rect.top > topViewport || rect.bottom < -40) return false;

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) return false;

        return true;
      })
      .sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();

        // 越靠上越优先
        if (Math.abs(ra.top - rb.top) > 4) return ra.top - rb.top;

        // 同高度下，字体更大/面积更大优先
        const sa = window.getComputedStyle(a);
        const sb = window.getComputedStyle(b);
        const fa = parseFloat(sa.fontSize || '0');
        const fb = parseFloat(sb.fontSize || '0');
        if (Math.abs(fa - fb) > 0.5) return fb - fa;

        return (rb.width * rb.height) - (ra.width * ra.height);
      })
      .slice(0, 3);
  }

  async function translateTopHeadlinesIfNeeded() {
    const candidates = collectTopHeadlineCandidates();
    if (!candidates.length) return;

    // 顺序翻译更稳，避免标题区抖动
    for (const el of candidates) {
      if (!translationActive) break;
      if (el.dataset?.zdfTranslated) continue;
      await translateParagraph(el);
    }
  }

  // 开始翻译（手动触发）
  async function startTranslation() {
    if (isExcludedSite()) return;

    // 重新加载最新配置
    await reloadConfig();

    // 检查是否需要重新翻译（服务或目标语言变化）
    const currentSettings = `${config.translationService}_${config.targetLang}_${config.displayMode}`;
    const lastSettings = document.body.dataset.zdfLastSettings;
    if (lastSettings && lastSettings !== currentSettings) {
      restoreOriginal();
    }
    document.body.dataset.zdfLastSettings = currentSettings;

    // 标记翻译状态
    translationActive = true;
    document.body.dataset.zdfActive = 'true';

    // 收集所有候选并按文档顺序排序（标题 → 正文 → 叶子容器）
    const candidates = collectTranslationCandidates();
    candidates.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });

    if (!candidates.length) {
      await syncAndNotifyTranslationStatus(true);
      return;
    }

    // 区分可见区域与待滚动区域
    const viewportMargin = 400;
    const immediate = [];
    const delayed = [];
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight + viewportMargin && rect.bottom > -viewportMargin) {
        immediate.push(el);
      } else {
        delayed.push(el);
      }
    }

    const tuning = getBatchTuning(config.translationService);

    // 先翻译可见区域，营造"从上到下"的渐进感
    await translateWithConcurrency(immediate, tuning.batchSize, tuning.concurrency);

    // 对下方内容懒加载：进入视口后继续按顺序翻译
    if (delayed.length && translationActive) {
      const observer = new IntersectionObserver((entries) => {
        const hit = entries
          .filter(e => e.isIntersecting)
          .map(e => e.target);

        if (hit.length && translationActive) {
          // 保持文档顺序继续翻译
          hit.sort((a, b) => {
            const pos = a.compareDocumentPosition(b);
            return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
          });
          translateWithConcurrency(hit, tuning.batchSize, tuning.concurrency);
        }

        entries.forEach(e => {
          if (e.isIntersecting) observer.unobserve(e.target);
        });
      }, { rootMargin: '300px' });

      delayed.forEach(el => observer.observe(el));
      lazyLoadObservers.push(observer);
    }

    await syncAndNotifyTranslationStatus(true);
  }

  // 恢复原文
  function restoreOriginal() {
    translationActive = false;
    document.body.dataset.zdfActive = '';

    // 移除所有翻译内容
    document.querySelectorAll('[data-zdf-translated="true"]').forEach(el => {
      // 恢复原始内容
      if (el.dataset.zdfOriginalHtml) {
        safeRestoreHtml(el, el.dataset.zdfOriginalHtml);
      }
      // 清除所有标记
      el.dataset.zdfTranslated = '';
      el.dataset.zdfOriginalHtml = '';
      el.dataset.zdfOriginalText = '';
    });

    // 同时清理所有翻译容器（以防万一）
    document.querySelectorAll('.zdf-translation-container').forEach(container => {
      const parent = container.parentElement;
      if (parent && parent.dataset.zdfOriginalHtml) {
        safeRestoreHtml(parent, parent.dataset.zdfOriginalHtml);
        parent.dataset.zdfTranslated = '';
        parent.dataset.zdfOriginalHtml = '';
        parent.dataset.zdfOriginalText = '';
      }
    });

    translatedElements.clear();

    // 断开所有懒加载 observers
    lazyLoadObservers.forEach(observer => observer.disconnect());
    lazyLoadObservers = [];

    syncAndNotifyTranslationStatus(false);
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
  let popupStreamSkip = null;
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

      footerLeft.appendChild(copyBtn);
      footer.appendChild(footerLeft);

      popup.appendChild(header);
      popup.appendChild(content);
      popup.appendChild(footer);
      document.body.appendChild(popup);

      enablePopupDrag(popup, header);

      setTimeout(() => {
        document.addEventListener('click', handlePopupOutsideClick);
        document.addEventListener('keydown', handlePopupEsc);
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

    // 如果译文几乎没分段，按句子做温和分段，避免"一坨"
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

  function isReplaceDisplayMode() {
    return config.displayMode === 'replace';
  }
  function streamTextToElement(el, text, onDone) {
    if (popupStreamTimer) {
      clearInterval(popupStreamTimer);
      popupStreamTimer = null;
    }
    popupStreamSkip = null;

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

    popupStreamSkip = () => {
      if (popupStreamTimer) {
        clearInterval(popupStreamTimer);
        popupStreamTimer = null;
      }
      paragraphEls.forEach((p, idx) => {
        p.textContent = paragraphs[idx] || '';
      });
      popupStreamSkip = null;
      if (onDone) onDone();
    };

    popupStreamTimer = setInterval(() => {
      if (!document.body.contains(el)) {
        clearInterval(popupStreamTimer);
        popupStreamTimer = null;
        popupStreamSkip = null;
        return;
      }

      if (paraIdx >= paragraphs.length) {
        clearInterval(popupStreamTimer);
        popupStreamTimer = null;
        popupStreamSkip = null;
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
  function showTranslationPopup(originalText, translatedText, error, originalSegments = [], translatedSegments = []) {
    const popup = ensureTranslationPopup(originalText);
    const translatedDiv = popup.querySelector('.zdf-popup-translated');
    const footer = popup.querySelector('.zdf-popup-footer');

    if (!translatedDiv || !footer) return;

    const popupActions = footer.querySelectorAll('.zdf-popup-action');
    if (error) {
      if (popupStreamTimer) {
        clearInterval(popupStreamTimer);
        popupStreamTimer = null;
      }
      translatedDiv.innerHTML = '';
      const errSpan = document.createElement('span');
      errSpan.className = 'zdf-popup-error';
      errSpan.textContent = `翻译失败: ${error}`;
      translatedDiv.appendChild(errSpan);
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
      translatedDiv.innerHTML = '';
      const loadingSpan = document.createElement('span');
      loadingSpan.className = 'zdf-popup-loading';
      const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      spinner.setAttribute('class', 'zdf-popup-spinner');
      spinner.setAttribute('viewBox', '0 0 24 24');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '12');
      circle.setAttribute('cy', '12');
      circle.setAttribute('r', '10');
      circle.setAttribute('stroke', 'currentColor');
      circle.setAttribute('stroke-width', '3');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke-dasharray', '31.4 31.4');
      spinner.appendChild(circle);
      loadingSpan.appendChild(spinner);
      loadingSpan.appendChild(document.createTextNode(' 正在努力翻译中...'));
      translatedDiv.appendChild(loadingSpan);
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

  function handlePopupEsc(e) {
    if (e.key === 'Escape') {
      if (popupStreamSkip) {
        popupStreamSkip();
      } else {
        removeTranslationPopup();
      }
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
    popupStreamSkip = null;
    popupLatestTranslatedText = '';
    popupLatestOriginalSegments = [];
    popupLatestTranslatedSegments = [];
    document.removeEventListener('click', handlePopupOutsideClick);
    document.removeEventListener('keydown', handlePopupEsc);
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

  // 选中文本后的快捷翻译按钮（替代右键菜单路径）
  let selectionQuickBtn = null;
  let selectionQuickHideTimer = null;

  function ensureSelectionQuickButton() {
    if (selectionQuickBtn && document.body.contains(selectionQuickBtn)) return selectionQuickBtn;

    const btn = document.createElement('button');
    btn.id = 'zdf-selection-quick-btn';
    btn.className = 'zdf-selection-quick-btn';
    btn.title = '翻译选中文本';
    btn.innerHTML = `<img src="${chrome.runtime.getURL('assets/float-icon-32.png')}" alt="ZDFTranslate">`;

    // 防止点击按钮时触发 selection 丢失
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const selectedText = (window.getSelection()?.toString() || '').trim();
      if (!selectedText) {
        hideSelectionQuickButton();
        return;
      }

      const originalSegments = getSelectionSegments();
      const textToTranslate = (originalSegments && originalSegments.length)
        ? originalSegments.join('\n\n')
        : selectedText;

      showTranslationPopup(selectedText, null, null, originalSegments);
      hideSelectionQuickButton();

      try {
        const translatedText = await translateText(textToTranslate);
        let translatedSegments = (translatedText || '')
          .split(/\n\s*\n+/)
          .map(s => s.trim())
          .filter(Boolean);

        if (translatedSegments.length <= 1) {
          translatedSegments = (translatedText || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
        }

        showTranslationPopup(selectedText, translatedText, null, originalSegments, translatedSegments);
      } catch (error) {
        showTranslationPopup(selectedText, null, error?.message || '翻译失败');
      }
    });

    document.body.appendChild(btn);
    selectionQuickBtn = btn;
    return btn;
  }

  function hideSelectionQuickButton() {
    if (!selectionQuickBtn) return;
    selectionQuickBtn.classList.remove('show');
  }

  function scheduleHideSelectionQuickButton(delay = 120) {
    if (selectionQuickHideTimer) clearTimeout(selectionQuickHideTimer);
    selectionQuickHideTimer = setTimeout(() => {
      hideSelectionQuickButton();
    }, delay);
  }

  function showSelectionQuickButtonNearSelection() {
    const sel = window.getSelection();
    const text = (sel?.toString() || '').trim();
    if (!sel || sel.rangeCount === 0 || !text) {
      hideSelectionQuickButton();
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      hideSelectionQuickButton();
      return;
    }

    const btn = ensureSelectionQuickButton();
    const btnW = 34;
    const btnH = 34;

    let left = window.scrollX + rect.right + 8;
    let top = window.scrollY + rect.bottom + 8;

    const maxLeft = window.scrollX + window.innerWidth - btnW - 8;
    const maxTop = window.scrollY + window.innerHeight - btnH - 8;

    left = Math.min(Math.max(window.scrollX + 8, left), maxLeft);
    top = Math.min(Math.max(window.scrollY + 8, top), maxTop);

    btn.style.left = `${left}px`;
    btn.style.top = `${top}px`;
    btn.classList.add('show');
  }

  function throttle(fn, wait) {
    let last = 0;
    return function (...args) {
      const now = Date.now();
      if (now - last >= wait) {
        last = now;
        fn.apply(this, args);
      }
    };
  }

  document.addEventListener('selectionchange', throttle(() => {
    const text = (window.getSelection()?.toString() || '').trim();
    if (text) {
      showSelectionQuickButtonNearSelection();
    } else {
      scheduleHideSelectionQuickButton(60);
    }
  }, 80));

  document.addEventListener('mousedown', (e) => {
    if (selectionQuickBtn && selectionQuickBtn.contains(e.target)) return;
    scheduleHideSelectionQuickButton(60);
  });

  window.addEventListener('scroll', () => hideSelectionQuickButton(), { passive: true });
  window.addEventListener('resize', () => {
    hideSelectionQuickButton();
    const btn = document.getElementById('zdf-floating-translate-btn');
    if (btn) {
      applyFloatingButtonPosition(btn);
    }
  });

  // SPA 路由切换兼容：清理翻译状态避免旧页面译文残留
  function onRouteChanged() {
    if (translationActive) {
      removeTranslations();
    }
  }
  window.addEventListener('popstate', onRouteChanged);
  window.addEventListener('hashchange', onRouteChanged);
  if (!history._zdfPatched) {
    history._zdfPatched = true;
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) {
      const r = origPush.apply(this, args);
      onRouteChanged();
      return r;
    };
    history.replaceState = function (...args) {
      const r = origReplace.apply(this, args);
      onRouteChanged();
      return r;
    };
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
  let floatingActionsHideTimer = null;
  let floatingActionsOpen = false;
  let floatingDragging = false;
  let suppressFloatingClick = false;

  async function saveFloatingButtonPosition(left, top) {
    try {
      await chrome.storage.local.set({
        floatingButtonPosition: {
          left: Math.round(left),
          top: Math.round(top)
        }
      });
    } catch (e) {
      // 忽略持久化失败，避免影响交互
    }
  }

  async function applyFloatingButtonPosition(btn) {
    if (!btn) return;

    let saved;
    try {
      const result = await chrome.storage.local.get(['floatingButtonPosition']);
      saved = result?.floatingButtonPosition;
    } catch (e) {
      saved = null;
    }
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      const maxLeft = Math.max(8, window.innerWidth - btn.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - btn.offsetHeight - 8);
      btn.style.left = `${Math.min(Math.max(8, saved.left), maxLeft)}px`;
      btn.style.top = `${Math.min(Math.max(8, saved.top), maxTop)}px`;
    } else {
      // 默认放在右下但给右侧图标预留安全空间
      btn.style.left = `${Math.max(8, window.innerWidth - 72)}px`;
      btn.style.top = `${Math.max(8, window.innerHeight - 196)}px`;
    }

    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
  }

  function openFloatingActions() {
    if (floatingDragging) return;

    floatingActionsOpen = true;
    if (floatingActionsHideTimer) {
      clearTimeout(floatingActionsHideTimer);
      floatingActionsHideTimer = null;
    }
  }

  function closeFloatingActions(delay = 140) {
    if (floatingActionsHideTimer) clearTimeout(floatingActionsHideTimer);
    floatingActionsHideTimer = setTimeout(() => {
      floatingActionsOpen = false;
    }, delay);
  }

  function bindFloatingButtonDrag(btn) {
    if (!btn) return;

    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let moved = false;
    let rafId = 0;
    let nextLeft = 0;
    let nextTop = 0;

    const applyDragFrame = () => {
      rafId = 0;
      btn.style.left = `${nextLeft}px`;
      btn.style.top = `${nextTop}px`;
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
      if (floatingActionsOpen) {
      }
    };

    const onPointerMove = (ev) => {
      if (pointerId === null || ev.pointerId !== pointerId) return;

      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      if (!floatingDragging && Math.hypot(dx, dy) > 2) {
        floatingDragging = true;
        moved = true;
        suppressFloatingClick = true;
        btn.classList.add('zdf-dragging');
        closeFloatingActions(0);
      }

      if (!floatingDragging) return;

      const maxLeft = Math.max(8, window.innerWidth - btn.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - btn.offsetHeight - 8);
      nextLeft = Math.min(Math.max(8, originLeft + dx), maxLeft);
      nextTop = Math.min(Math.max(8, originTop + dy), maxTop);

      if (!rafId) {
        rafId = requestAnimationFrame(applyDragFrame);
      }
      ev.preventDefault();
    };

    const endDrag = async (ev) => {
      if (pointerId === null || ev.pointerId !== pointerId) return;

      try { btn.releasePointerCapture(pointerId); } catch (_) {}
      pointerId = null;

      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', endDrag, true);
      window.removeEventListener('pointercancel', endDrag, true);

      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
        applyDragFrame();
      }

      btn.classList.remove('zdf-dragging');

      if (moved) {
        const rect2 = btn.getBoundingClientRect();
        await saveFloatingButtonPosition(rect2.left, rect2.top);
      }

      setTimeout(() => {
        floatingDragging = false;
      }, 0);
    };

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;

      pointerId = e.pointerId;
      moved = false;
      floatingDragging = false;
      startX = e.clientX;
      startY = e.clientY;

      const rect = btn.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      nextLeft = originLeft;
      nextTop = originTop;

      btn.setPointerCapture(pointerId);
      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', endDrag, true);
      window.addEventListener('pointercancel', endDrag, true);
      e.preventDefault();
    });
  }

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
    btn.addEventListener('mouseenter', () => openFloatingActions());
    btn.addEventListener('mouseleave', () => closeFloatingActions(180));

    document.body.appendChild(btn);
    applyFloatingButtonPosition(btn);
    bindFloatingButtonDrag(btn);

    // 更新按钮状态
    updateFloatingButtonState();
  }

  async function handleFloatingButtonClick() {
    const btn = document.getElementById('zdf-floating-translate-btn');
    if (!btn) return;
    if (floatingDragging || suppressFloatingClick) {
      suppressFloatingClick = false;
      return;
    }

    if (translationActive || isTranslating) {
      // 已翻译或翻译中 -> 恢复原文
      isTranslating = false;
      restoreOriginal();
      translationActive = false;
      btn.classList.remove('zdf-float-loading');
      updateFloatingButtonState();

      // 通知 background + popup 实时更新状态
      await syncAndNotifyTranslationStatus(false);
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

      // 通知 background + popup 实时更新状态
      await syncAndNotifyTranslationStatus(true);
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
        if (chrome.runtime.lastError) {
          resolve(lastKnownTabId || 0);
          return;
        }
        resolve(response?.tabId || lastKnownTabId || 0);
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
