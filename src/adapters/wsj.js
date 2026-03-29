// ZDFTranslate - WSJ (Wall Street Journal) Adapter
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

  class WSJAdapter extends BaseAdapter {
    constructor() {
      super('WSJ', ['wsj\\.com/(articles|opinion|news|economy|politics|business|tech|finance|markets)/'], '#0274B6');
    }

    extract(doc) {
      const url = location.href;

      // --- Title ---
      let title = '';
      const titleEl =
        doc.querySelector('h1[class*="headline"]') ||
        doc.querySelector('.wsj-article-headline') ||
        doc.querySelector('h1');
      if (titleEl) title = cleanText(titleEl.textContent);

      // --- Subtitle / subheadline ---
      let subtitle = '';
      const subEl =
        doc.querySelector('h2[class*="subheadline"]') ||
        doc.querySelector('.article-subheadline') ||
        doc.querySelector('.article__subhead');
      if (subEl) subtitle = cleanText(subEl.textContent);

      // --- Author ---
      let author = '';
      const authorEl =
        doc.querySelector('[class*="author-name"]') ||
        doc.querySelector('.byline__name') ||
        doc.querySelector('.author .name');
      if (authorEl) author = cleanText(authorEl.textContent);

      // --- Time ---
      const publishTime = getTimeContent(doc, [
        'time[datetime]',
        '.article__timestamp time',
        '[class*="timestamp"]',
      ]);

      // --- Cover image ---
      let coverImage = '';
      const articleRoot = doc.querySelector('article') || doc.querySelector('.article-wrap') || doc.body;
      const heroImg = articleRoot.querySelector('figure img, .article-image img');
      if (heroImg) coverImage = resolveUrl(extractImageSrc(heroImg), url);
      if (!isValidImageUrl(coverImage)) coverImage = this.fallbackImage(doc);

      // --- Paragraphs ---
      const paragraphs = [];
      const contentEl =
        doc.querySelector('.article-content') ||
        doc.querySelector('.article__body') ||
        doc.querySelector('article') ||
        doc.querySelector('[role="main"]');
      if (contentEl) {
        const pElements = contentEl.querySelectorAll('p');
        for (const p of pElements) {
          const text = cleanText(p.textContent);
          if (text.length < 25) continue;
          if (subtitle && text === subtitle) continue;
          if (/^(sign up|subscribe|newsletter|advertisement|most popular|read more)/i.test(text)) continue;
          paragraphs.push({ type: 'text', content: text });
        }
      }

      // --- Images ---
      const images = [];
      const figures = (contentEl || doc).querySelectorAll('figure');
      for (const fig of figures) {
        const img = fig.querySelector('img');
        const caption = fig.querySelector('figcaption') || fig.querySelector('.caption');
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
        source: 'WSJ',
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
  window.ZDFAdapters.push(new WSJAdapter());
})();
