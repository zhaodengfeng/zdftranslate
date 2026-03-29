// ZDFTranslate - Site Adapter Base
// 定义统一的文章提取接口，各站点适配器实现具体逻辑

(function () {
  'use strict';

  /**
   * 统一的文章数据结构
   * @typedef {Object} ArticleData
   * @property {string} source - 来源站点名 (Bloomberg, WSJ, etc.)
   * @property {string} sourceIcon - 站点标识色
   * @property {string} url - 文章 URL
   * @property {string} title - 标题
   * @property {string} subtitle - 副标题/摘要
   * @property {string} author - 作者
   * @property {string} publishTime - 发布时间
   * @property {string} coverImage - 封面图 URL
   * @property {Array<{type:'text',content:string}>} paragraphs - 正文段落
   * @property {Array<{src:string,caption:string,alt:string}>} images - 配图
   */

  // 通用工具函数
  function cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  }

  function getMetaContent(doc, selectors) {
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el) {
        const content = el.getAttribute('content') || el.textContent;
        if (content && cleanText(content)) return cleanText(content);
      }
    }
    return '';
  }

  function getTimeContent(doc, selectors) {
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el) {
        const datetime = el.getAttribute('datetime') || el.getAttribute('content');
        if (datetime) return datetime;
        const text = el.textContent?.trim();
        if (text) return text;
      }
    }
    return '';
  }

  function extractImageSrc(el) {
    if (!el) return '';
    // 优先 data-src / data-lazy-src (懒加载)
    return (
      el.getAttribute('data-src') ||
      el.getAttribute('data-lazy-src') ||
      el.getAttribute('data-original') ||
      el.getAttribute('srcset')?.split(',')[0]?.split(' ')[0] ||
      el.getAttribute('src') ||
      ''
    );
  }

  function isValidImageUrl(url) {
    if (!url) return false;
    // 过滤 data: URI、tracking pixels、icon-size images
    if (url.startsWith('data:')) return false;
    if (url.includes('pixel') || url.includes('beacon') || url.includes('tracker')) return false;
    return true;
  }

  function resolveUrl(url, base) {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return 'https:' + url;
    try {
      return new URL(url, base).href;
    } catch {
      return url;
    }
  }

  // 基础适配器类
  class BaseAdapter {
    constructor(name, patterns, brandColor) {
      this.name = name;
      this.patterns = patterns; // URL match patterns
      this.brandColor = brandColor || '#333';
    }

    /** 判断当前页面是否匹配此适配器 */
    matches(url) {
      return this.patterns.some((p) => new RegExp(p).test(url));
    }

    /** 子类必须实现：从 DOM 提取文章数据 */
    extract(doc) {
      throw new Error(`${this.name} adapter must implement extract()`);
    }

    // 通用辅助：提取 og:title / meta title 兜底
    fallbackTitle(doc) {
      return getMetaContent(doc, [
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
        'h1',
      ]);
    }

    fallbackDescription(doc) {
      return getMetaContent(doc, [
        'meta[property="og:description"]',
        'meta[name="description"]',
      ]);
    }

    fallbackImage(doc) {
      const img = doc.querySelector('meta[property="og:image"]');
      return img ? img.getAttribute('content') || '' : '';
    }
  }

  // 导出到全局
  window.ZDFAdapterBase = {
    BaseAdapter,
    cleanText,
    getMetaContent,
    getTimeContent,
    extractImageSrc,
    isValidImageUrl,
    resolveUrl,
  };
})();
