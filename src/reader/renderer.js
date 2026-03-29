// ZDFTranslate - Reader Renderer
// 干净的阅读视图渲染：全屏 overlay，纯数据驱动，零广告

(function () {
  'use strict';

  let readerOverlay = null;
  let currentArticle = null;
  let currentTranslations = null;
  let translationInProgress = false;
  let displayMode = 'bilingual'; // bilingual | translated-only | original

  /**
   * 渲染阅读视图
   * @param {ArticleData} article - 适配器提取的文章数据
   * @param {Function} onTranslate - 翻译回调，接收段落文本数组，返回翻译数组
   * @param {Function} onExportImage - 导出图片回调
   * @param {Function} onExportPdf - 导出 PDF 回调
   */
  function renderReader(article, callbacks) {
    if (readerOverlay) destroyReader();

    currentArticle = article;
    currentTranslations = null;
    translationInProgress = false;

    const overlay = document.createElement('div');
    overlay.id = 'zdf-reader-overlay';
    overlay.innerHTML = buildReaderHTML(article);

    readerOverlay = overlay;
    document.body.appendChild(overlay);

    // 绑定事件
    bindReaderEvents(callbacks);

    // 阻止原页面滚动
    document.body.style.overflow = 'hidden';

    // 渐入动画
    requestAnimationFrame(() => {
      overlay.classList.add('zdf-reader-visible');
    });
  }

  function buildReaderHTML(article) {
    const { source, sourceIcon, title, subtitle, author, publishTime, coverImage, paragraphs } = article;

    // 格式化时间
    const timeStr = formatPublishTime(publishTime);

    // 段落 HTML
    const paragraphsHTML = paragraphs
      .map((p, i) => {
        if (p.type === 'image') {
          return buildImageBlock(p, i);
        }
        return buildTextBlock(p, i);
      })
      .join('');

    return `
      <div class="zdf-reader-container" id="zdf-reader-container">
        <!-- 顶部工具栏 -->
        <div class="zdf-reader-toolbar">
          <div class="zdf-reader-toolbar-left">
            <span class="zdf-reader-source-badge" style="background:${sourceIcon}">${source}</span>
            <span class="zdf-reader-toolbar-sep">|</span>
            <button class="zdf-reader-btn zdf-reader-btn-mode" data-mode="bilingual" title="双语对照">双语</button>
            <button class="zdf-reader-btn zdf-reader-btn-mode" data-mode="translated-only" title="仅译文">译文</button>
            <button class="zdf-reader-btn zdf-reader-btn-mode" data-mode="original" title="仅原文">原文</button>
          </div>
          <div class="zdf-reader-toolbar-right">
            <button class="zdf-reader-btn zdf-reader-btn-translate" id="zdf-reader-translate-btn" title="翻译全文">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 5h5M6 7h3M2 3h1M2 9h1M4 3v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <path d="M8 11l2-2 2 2M10 9v4M13 7h-1M13 11h-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
              翻译
            </button>
            <button class="zdf-reader-btn zdf-reader-btn-export" id="zdf-reader-export-img" title="导出图片">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.3"/>
                <circle cx="5.5" cy="5.5" r="1.5" stroke="currentColor" stroke-width="1"/>
                <path d="M2 11l3-3 2 2 2-2 5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              图片
            </button>
            <button class="zdf-reader-btn zdf-reader-btn-export" id="zdf-reader-export-pdf" title="导出PDF">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="3" y="1" width="10" height="14" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
                <path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
              </svg>
              PDF
            </button>
            <button class="zdf-reader-btn zdf-reader-btn-close" id="zdf-reader-close" title="关闭阅读模式">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- 文章主体 -->
        <div class="zdf-reader-body" id="zdf-reader-body">
          <article class="zdf-reader-article">
            <header class="zdf-reader-header">
              ${timeStr ? `<time class="zdf-reader-time">${timeStr}</time>` : ''}
              <h1 class="zdf-reader-title">${escapeHTML(title)}</h1>
              ${subtitle ? `<p class="zdf-reader-subtitle">${escapeHTML(subtitle)}</p>` : ''}
              ${author ? `<div class="zdf-reader-author">${escapeHTML(author)}</div>` : ''}
            </header>
            ${coverImage ? `
              <figure class="zdf-reader-cover">
                <img src="${escapeAttr(coverImage)}" alt="${escapeAttr(title)}" crossorigin="anonymous" />
              </figure>
            ` : ''}
            <div class="zdf-reader-content" id="zdf-reader-content">
              ${paragraphsHTML}
            </div>
          </article>
          <footer class="zdf-reader-footer">
            <span class="zdf-reader-footer-source">原文链接：<a href="${escapeAttr(article.url)}" target="_blank">${escapeHTML(source)}</a></span>
          </footer>
        </div>
      </div>
    `;
  }

  function buildTextBlock(p, index) {
    return `
      <div class="zdf-reader-paragraph" data-index="${index}">
        <p class="zdf-reader-original">${escapeHTML(p.content)}</p>
        <p class="zdf-reader-translated" data-index="${index}" style="display:none;"></p>
      </div>
    `;
  }

  function buildImageBlock(img, index) {
    return `
      <figure class="zdf-reader-inline-image" data-index="${index}">
        <img src="${escapeAttr(img.src)}" alt="${escapeAttr(img.alt || img.caption || '')}" crossorigin="anonymous" />
        ${img.caption ? `<figcaption>${escapeHTML(img.caption)}</figcaption>` : ''}
      </figure>
    `;
  }

  // --- 翻译结果注入 ---
  function applyTranslations(translations) {
    currentTranslations = translations;
    const paragraphs = readerOverlay.querySelectorAll('.zdf-reader-paragraph');

    // 将配图插入到段落流中的正确位置
    const articleImages = currentArticle.images;
    if (articleImages && articleImages.length > 0) {
      insertImagesIntoContent(articleImages);
    }

    paragraphs.forEach((el, i) => {
      const translatedEl = el.querySelector('.zdf-reader-translated');
      if (translatedEl && translations[i]) {
        translatedEl.textContent = translations[i];
      }
    });

    // 应用当前显示模式
    applyDisplayMode(displayMode);
  }

  // 在段落流中均匀插入配图
  function insertImagesIntoContent(images) {
    const contentEl = readerOverlay.querySelector('#zdf-reader-content');
    if (!contentEl || !images.length) return;

    const paragraphs = contentEl.querySelectorAll('.zdf-reader-paragraph');
    const interval = Math.max(1, Math.floor(paragraphs.length / (images.length + 1)));

    images.forEach((img, i) => {
      const insertAfter = paragraphs[interval * (i + 1) - 1];
      if (insertAfter && isValidImageUrl(img.src)) {
        const figure = document.createElement('figure');
        figure.className = 'zdf-reader-inline-image';
        figure.innerHTML = `
          <img src="${escapeAttr(img.src)}" alt="${escapeAttr(img.alt || img.caption || '')}" crossorigin="anonymous" />
          ${img.caption ? `<figcaption>${escapeHTML(img.caption)}</figcaption>` : ''}
        `;
        insertAfter.insertAdjacentElement('afterend', figure);
      }
    });
  }

  function isValidImageUrl(url) {
    if (!url) return false;
    if (url.startsWith('data:')) return false;
    return true;
  }

  function setTranslating(progress) {
    translationInProgress = progress;
    const btn = readerOverlay?.querySelector('#zdf-reader-translate-btn');
    if (btn) {
      if (progress) {
        btn.classList.add('zdf-reader-btn-loading');
        btn.innerHTML = `
          <span class="zdf-reader-spinner"></span>
          翻译中...
        `;
      } else {
        btn.classList.remove('zdf-reader-btn-loading');
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 5h5M6 7h3M2 3h1M2 9h1M4 3v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M8 11l2-2 2 2M10 9v4M13 7h-1M13 11h-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
          翻译
        `;
      }
    }
  }

  // --- 显示模式切换 ---
  function applyDisplayMode(mode) {
    displayMode = mode;
    if (!readerOverlay) return;

    // 更新按钮状态
    readerOverlay.querySelectorAll('.zdf-reader-btn-mode').forEach((btn) => {
      btn.classList.toggle('zdf-reader-btn-active', btn.dataset.mode === mode);
    });

    const paragraphs = readerOverlay.querySelectorAll('.zdf-reader-paragraph');
    paragraphs.forEach((el) => {
      const original = el.querySelector('.zdf-reader-original');
      const translated = el.querySelector('.zdf-reader-translated');
      if (!original || !translated) return;

      switch (mode) {
        case 'bilingual':
          original.style.display = '';
          translated.style.display = translated.textContent ? '' : 'none';
          el.classList.remove('zdf-reader-translated-only');
          break;
        case 'translated-only':
          original.style.display = 'none';
          translated.style.display = translated.textContent ? '' : 'none';
          el.classList.add('zdf-reader-translated-only');
          break;
        case 'original':
          original.style.display = '';
          translated.style.display = 'none';
          el.classList.remove('zdf-reader-translated-only');
          break;
      }
    });
  }

  // --- 事件绑定 ---
  function bindReaderEvents(callbacks) {
    // 关闭
    const closeBtn = readerOverlay.querySelector('#zdf-reader-close');
    closeBtn?.addEventListener('click', () => destroyReader());

    // ESC 关闭
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        destroyReader();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // 翻译
    const translateBtn = readerOverlay.querySelector('#zdf-reader-translate-btn');
    translateBtn?.addEventListener('click', () => {
      if (translationInProgress) return;
      if (currentTranslations) {
        // 已有翻译，切换显示
        applyDisplayMode('bilingual');
        return;
      }
      callbacks?.onTranslate?.(currentArticle);
    });

    // 导出图片
    const exportImgBtn = readerOverlay.querySelector('#zdf-reader-export-img');
    exportImgBtn?.addEventListener('click', () => {
      callbacks?.onExportImage?.();
    });

    // 导出 PDF
    const exportPdfBtn = readerOverlay.querySelector('#zdf-reader-export-pdf');
    exportPdfBtn?.addEventListener('click', () => {
      callbacks?.onExportPdf?.();
    });

    // 显示模式切换
    readerOverlay.querySelectorAll('.zdf-reader-btn-mode').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyDisplayMode(btn.dataset.mode);
      });
    });
  }

  // --- 销毁阅读视图 ---
  function destroyReader() {
    if (readerOverlay) {
      readerOverlay.remove();
      readerOverlay = null;
    }
    document.body.style.overflow = '';
    currentArticle = null;
    currentTranslations = null;
    translationInProgress = false;
  }

  // --- 工具函数 ---
  function escapeHTML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return escapeHTML(str);
  }

  function formatPublishTime(timeStr) {
    if (!timeStr) return '';
    try {
      const d = new Date(timeStr);
      if (isNaN(d.getTime())) return timeStr;
      return d.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return timeStr;
    }
  }

  // --- 获取渲染容器用于截图 ---
  function getReaderContainer() {
    return readerOverlay?.querySelector('#zdf-reader-container') || null;
  }

  function isReaderActive() {
    return !!readerOverlay;
  }

  function getOverlay() {
    return readerOverlay;
  }

  // 导出
  window.ZDFReader = {
    render: renderReader,
    destroy: destroyReader,
    applyTranslations: applyTranslations,
    setTranslating: setTranslating,
    applyDisplayMode: applyDisplayMode,
    getReaderContainer: getReaderContainer,
    isReaderActive: isReaderActive,
    getOverlay: getOverlay,
    escapeHTML,
    formatPublishTime,
  };
})();
