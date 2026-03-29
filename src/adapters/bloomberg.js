// ZDFTranslate - Bloomberg Adapter
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

  class BloombergAdapter extends BaseAdapter {
    constructor() {
      super('Bloomberg', ['bloomberg\\.com/(news|opinion|newsletters|features)/'], '#391939');
    }

    extract(doc) {
      const url = location.href;

      // --- Title ---
      let title = '';
      const titleEl =
        doc.querySelector('h1[data-testid*="headline"]') ||
        doc.querySelector('h1[class*="headline"]') ||
        doc.querySelector('article h1') ||
        doc.querySelector('h1');
      if (titleEl) title = cleanText(titleEl.textContent);

      // --- Subtitle ---
      let subtitle = '';
      const subEl = doc.querySelector('[data-testid="abstract"]') ||
        doc.querySelector('.abstract') ||
        doc.querySelector('article > p:first-of-type');
      if (subEl) subtitle = cleanText(subEl.textContent);

      // --- Author ---
      let author = '';
      const authorEl =
        doc.querySelector('[data-testid="author"]') ||
        doc.querySelector('.author__name') ||
        doc.querySelector('[class*="author-name"]');
      if (authorEl) author = cleanText(authorEl.textContent);

      // --- Time ---
      const publishTime = getTimeContent(doc, [
        'time[datetime]',
        '[data-testid="publication-time"] time',
        '.article-meta time',
      ]);

      // --- Cover image ---
      let coverImage = '';
      const articleRoot = doc.querySelector('article') || doc.querySelector('[role="main"]') || doc.body;
      const firstImg = articleRoot.querySelector('figure img');
      if (firstImg) coverImage = resolveUrl(extractImageSrc(firstImg), url);
      if (!isValidImageUrl(coverImage)) coverImage = this.fallbackImage(doc);

      // --- Paragraphs ---
      const paragraphs = [];
      const articleEl = doc.querySelector('article') || doc.querySelector('[role="main"]');
      if (articleEl) {
        const pElements = articleEl.querySelectorAll('p');
        for (const p of pElements) {
          const text = cleanText(p.textContent);
          // 排除过短、已作为 subtitle 的段落、以及页脚相关
          if (text.length < 25) continue;
          if (subtitle && text === subtitle) continue;
          // 排除 "Sign up for" newsletter 类段落
          if (/sign up for|subscribe now|newsletter|Terms of Service/i.test(text)) continue;
          paragraphs.push({ type: 'text', content: text });
        }
      }

      // --- Images (正文配图) ---
      const images = [];
      const figures = (articleEl || doc).querySelectorAll('figure');
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
        source: 'Bloomberg',
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
  window.ZDFAdapters.push(new BloombergAdapter());
})();
