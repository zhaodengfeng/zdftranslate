// ZDFTranslate - Financial Times Adapter
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

  class FTAdapter extends BaseAdapter {
    constructor() {
      super('FT', ['ft\\.com/content/', 'ft\\.com/(opinion|companies|markets|world|uk|us|economy)/'], '#CCD6DF');
    }

    extract(doc) {
      const url = location.href;

      // --- Title ---
      let title = '';
      const titleEl =
        doc.querySelector('.article__title') ||
        doc.querySelector('h1[class*="article-title"]') ||
        doc.querySelector('[data-trackable="headline"]') ||
        doc.querySelector('article h1') ||
        doc.querySelector('h1');
      if (titleEl) title = cleanText(titleEl.textContent);

      // --- Subtitle / standfirst ---
      let subtitle = '';
      const subEl =
        doc.querySelector('.article__standfirst') ||
        doc.querySelector('[data-trackable="standfirst"]') ||
        doc.querySelector('.standfirst');
      if (subEl) subtitle = cleanText(subEl.textContent);

      // --- Author ---
      let author = '';
      const authorEl =
        doc.querySelector('.article__author a') ||
        doc.querySelector('[data-trackable="author"]') ||
        doc.querySelector('.n-content-tag--author');
      if (authorEl) author = cleanText(authorEl.textContent);

      // --- Time ---
      const publishTime = getTimeContent(doc, [
        'time[datetime]',
        '.article__timestamp time',
        '[data-trackable="timestamp"] time',
      ]);

      // --- Cover image ---
      let coverImage = '';
      const articleRoot = doc.querySelector('article') || doc.querySelector('.article') || doc.body;
      const heroImg = articleRoot.querySelector('figure img, .article__image img');
      if (heroImg) coverImage = resolveUrl(extractImageSrc(heroImg), url);
      if (!isValidImageUrl(coverImage)) coverImage = this.fallbackImage(doc);

      // --- Paragraphs ---
      const paragraphs = [];
      const bodyEl =
        doc.querySelector('.article__body') ||
        doc.querySelector('[data-trackable="article-body"]') ||
        doc.querySelector('article') ||
        doc.querySelector('[role="main"]');
      if (bodyEl) {
        const pElements = bodyEl.querySelectorAll('p');
        for (const p of pElements) {
          const text = cleanText(p.textContent);
          if (text.length < 25) continue;
          if (subtitle && text === subtitle) continue;
          if (/^(sign up|subscribe|newsletter|advertisement|promoted|follow|copyright)/i.test(text)) continue;
          paragraphs.push({ type: 'text', content: text });
        }
      }

      // --- Images ---
      const images = [];
      const figures = (bodyEl || doc).querySelectorAll('figure, .n-content-picture');
      for (const fig of figures) {
        const img = fig.querySelector('img');
        const caption = fig.querySelector('figcaption') || fig.querySelector('.n-content-caption');
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
        source: 'FT',
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
  window.ZDFAdapters.push(new FTAdapter());
})();
