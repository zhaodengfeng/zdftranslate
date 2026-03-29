// ZDFTranslate - NYTimes Adapter
(function () {
  'use strict';

  const {
    BaseAdapter,
    cleanText,
    getTimeContent,
    extractImageSrc,
    isValidImageUrl,
    resolveUrl,
  } = window.ZDFAdapterBase;

  class NYTimesAdapter extends BaseAdapter {
    constructor() {
      super('NYTimes', ['nytimes\\.com/\\d{4}/\\d{2}/\\d{2}/', 'nytimes\\.com/(newsarticle|interactive)/'], '#1A1A1A');
    }

    extract(doc) {
      const url = location.href;

      // --- Title ---
      let title = '';
      const titleEl =
        doc.querySelector('[data-testid="headline"] h1') ||
        doc.querySelector('h1[data-testid="headline"]') ||
        doc.querySelector('h1.headline') ||
        doc.querySelector('article h1') ||
        doc.querySelector('h1');
      if (titleEl) title = cleanText(titleEl.textContent);

      // --- Subtitle / summary ---
      let subtitle = '';
      const subEl =
        doc.querySelector('#article-summary') ||
        doc.querySelector('[data-testid="summary"]') ||
        doc.querySelector('.article-summary');
      if (subEl) subtitle = cleanText(subEl.textContent);

      // --- Author ---
      let author = '';
      const authorEl =
        doc.querySelector('[data-testid="byline"] a') ||
        doc.querySelector('.byline-name') ||
        doc.querySelector('[itemprop="author"]');
      if (authorEl) author = cleanText(authorEl.textContent);

      // --- Time ---
      const publishTime = getTimeContent(doc, [
        'time[datetime]',
        '[data-testid="timestamp"] time',
        '.article-meta time',
      ]);

      // --- Cover image ---
      let coverImage = '';
      const articleRoot = doc.querySelector('article') || doc.querySelector('[role="main"]') || doc.body;
      const firstFigure = articleRoot.querySelector('figure img');
      if (firstFigure) coverImage = resolveUrl(extractImageSrc(firstFigure), url);
      if (!isValidImageUrl(coverImage)) coverImage = this.fallbackImage(doc);

      // --- Paragraphs ---
      const paragraphs = [];
      const bodyEl =
        doc.querySelector('section[name="articleBody"]') ||
        doc.querySelector('[data-testid="article-body"]') ||
        doc.querySelector('.article-body') ||
        doc.querySelector('article section') ||
        doc.querySelector('article');
      if (bodyEl) {
        const pElements = bodyEl.querySelectorAll('p');
        for (const p of pElements) {
          const text = cleanText(p.textContent);
          if (text.length < 25) continue;
          if (subtitle && text === subtitle) continue;
          if (/^(sign up|subscribe|newsletter|advertisement|supported by)/i.test(text)) continue;
          // 排除 "Share" / "X" 等社交媒体按钮文字
          if (text.length < 30 && /^(share|comment|save|X |Facebook)/i.test(text)) continue;
          paragraphs.push({ type: 'text', content: text });
        }
      }

      // --- Images ---
      const images = [];
      const figures = (bodyEl || doc).querySelectorAll('figure');
      for (const fig of figures) {
        const img = fig.querySelector('img');
        const caption = fig.querySelector('figcaption');
        const src = resolveUrl(extractImageSrc(img), url);
        if (isValidImageUrl(src)) {
          images.push({
            src,
            caption: caption ? cleanText(caption.textContent) : '',
            alt: img?.getAttribute('alt') || '',
          });
        }
      }

      return {
        source: 'NYTimes',
        sourceIcon: this.brandColor,
        url,
        title,
        subtitle,
        author,
        publishTime,
        coverImage,
        paragraphs,
        images,
      };
    }
  }

  window.ZDFAdapters = window.ZDFAdapters || [];
  window.ZDFAdapters.push(new NYTimesAdapter());
})();
