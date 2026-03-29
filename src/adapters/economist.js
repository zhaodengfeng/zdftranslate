// ZDFTranslate - The Economist Adapter
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

  class EconomistAdapter extends BaseAdapter {
    constructor() {
      super('The Economist', ['economist\\.com/([a-z-]+/)?\\d{4}/\\d{2}/\\d{2}/'], '#E3120B');
    }

    extract(doc) {
      const url = location.href;

      // --- Title ---
      let title = '';
      const titleEl =
        doc.querySelector('h1 span') ||
        doc.querySelector('h1.headline') ||
        doc.querySelector('.article__headline h1') ||
        doc.querySelector('article h1') ||
        doc.querySelector('h1');
      if (titleEl) title = cleanText(titleEl.textContent);

      // --- Subtitle / rubric ---
      let subtitle = '';
      const subEl =
        doc.querySelector('.article__rubric') ||
        doc.querySelector('[data-test-id="rubric"]') ||
        doc.querySelector('.article__description');
      if (subEl) subtitle = cleanText(subEl.textContent);

      // --- Author ---
      let author = '';
      const authorEl =
        doc.querySelector('[data-test-id="author"]') ||
        doc.querySelector('.article__author');
      // The Economist 通常不署名
      if (authorEl) author = cleanText(authorEl.textContent);

      // --- Time ---
      const publishTime = getTimeContent(doc, [
        'time[datetime]',
        '.article__dateline time',
        '[data-test-id="timestamp"]',
      ]);

      // --- Cover image ---
      let coverImage = '';
      const articleRoot = doc.querySelector('article') || doc.querySelector('.article') || doc.body;
      const heroImg = articleRoot.querySelector('figure img');
      if (heroImg) coverImage = resolveUrl(extractImageSrc(heroImg), url);
      if (!isValidImageUrl(coverImage)) coverImage = this.fallbackImage(doc);

      // --- Paragraphs ---
      const paragraphs = [];
      const bodyEl =
        doc.querySelector('.article__body-text')?.parentElement ||
        doc.querySelector('.article__body') ||
        doc.querySelector('[data-test-id="article-body"]') ||
        doc.querySelector('article');
      if (bodyEl) {
        const pElements = bodyEl.querySelectorAll('p.article__body-text, p');
        for (const p of pElements) {
          const text = cleanText(p.textContent);
          if (text.length < 25) continue;
          if (subtitle && text === subtitle) continue;
          if (/^(sign up|subscribe|newsletter|advertisement|listen|watch|read more)/i.test(text)) continue;
          // 跳过 "Read more" 链接按钮
          if (p.closest('a')) continue;
          paragraphs.push({ type: 'text', content: text });
        }
      }

      // --- Images ---
      const images = [];
      const figures = (bodyEl || doc).querySelectorAll('figure');
      for (const fig of figures) {
        const img = fig.querySelector('img');
        const caption = fig.querySelector('figcaption') || fig.querySelector('.article__image-caption');
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
        source: 'The Economist',
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
  window.ZDFAdapters.push(new EconomistAdapter());
})();
