/**
 * Mozilla Readability 集成
 * 用于智能提取网页正文内容
 * 
 * 基于 Mozilla 的 Readability.js
 * https://github.com/mozilla/readability
 */

(function() {
  'use strict';

  /**
   * Readability 主类 - 简化版实现
   * 提取文章标题、内容和元数据
   */
  class Readability {
    constructor(doc, options = {}) {
      this._doc = doc;
      this._options = options;
      this._articleTitle = null;
      this._articleContent = null;
      this._flags = {
        debug: options.debug || false
      };
    }

    /**
     * 解析文章
     * @returns {Object|null} - 包含 title, content, excerpt, byline 等
     */
    parse() {
      // 检查是否为文章页面
      if (!this._isProbablyReaderable()) {
        return null;
      }

      // 获取文章标题
      this._articleTitle = this._getArticleTitle();

      // 获取文章内容
      const articleContent = this._grabArticle();
      
      if (!articleContent) {
        return null;
      }

      // 创建结果对象
      const result = {
        title: this._articleTitle,
        content: articleContent.innerHTML,
        textContent: articleContent.textContent.trim(),
        length: articleContent.textContent.trim().length,
        excerpt: this._getExcerpt(articleContent),
        byline: this._getByline(),
        dir: this._getDirection(articleContent),
        siteName: this._getSiteName(),
        lang: this._doc.documentElement.lang || this._doc.body?.lang || 'unknown'
      };

      return result;
    }

    /**
     * 检查页面是否可能是可读的文章
     */
    _isProbablyReaderable() {
      const nodes = this._doc.querySelectorAll('p, article, [role="main"], .post-content, .entry-content, .article-body');
      let score = 0;
      
      for (const node of nodes) {
        const textLength = node.textContent.trim().length;
        if (textLength > 100) score++;
        if (textLength > 500) score += 2;
      }

      return score >= 3;
    }

    /**
     * 获取文章标题
     */
    _getArticleTitle() {
      // 尝试各种标题选择器
      const titleSelectors = [
        'h1.entry-title',
        'h1.post-title',
        'h1.article-title',
        'article h1',
        '[role="main"] h1',
        '.content h1',
        'h1'
      ];

      for (const selector of titleSelectors) {
        const titleEl = this._doc.querySelector(selector);
        if (titleEl && titleEl.textContent.trim().length > 0) {
          return titleEl.textContent.trim();
        }
      }

      // 回退到 document.title
      return this._doc.title || 'Untitled';
    }

    /**
     * 抓取文章内容
     */
    _grabArticle() {
      const doc = this._doc;
      
      // 首先尝试常见的内容容器
      const contentSelectors = [
        'article',
        '[role="main"]',
        'main',
        '.post-content',
        '.entry-content',
        '.article-body',
        '.content',
        '#content'
      ];

      let bestElement = null;
      let bestScore = 0;

      for (const selector of contentSelectors) {
        const elements = doc.querySelectorAll(selector);
        for (const el of elements) {
          const score = this._calculateScore(el);
          if (score > bestScore) {
            bestScore = score;
            bestElement = el;
          }
        }
      }

      // 如果没找到，使用启发式算法
      if (!bestElement) {
        bestElement = this._findBestElementByHeuristics();
      }

      if (!bestElement) {
        return null;
      }

      // 克隆元素以避免修改原页面
      const cloned = bestElement.cloneNode(true);
      
      // 清理不必要的元素
      this._cleanElement(cloned);
      
      return cloned;
    }

    /**
     * 计算元素的评分
     */
    _calculateScore(element) {
      const text = element.textContent || '';
      const textLength = text.trim().length;
      
      if (textLength < 200) return 0;

      let score = textLength / 100;

      // 减分项
      const tagName = element.tagName.toLowerCase();
      if (['nav', 'header', 'footer', 'aside', 'sidebar'].includes(tagName)) {
        score *= 0.5;
      }

      // 链接密度检查
      const linkDensity = this._getLinkDensity(element);
      score *= (1 - linkDensity * 0.5);

      return score;
    }

    /**
     * 启发式查找最佳元素
     */
    _findBestElementByHeuristics() {
      const paragraphs = this._doc.querySelectorAll('p');
      const candidates = [];

      for (const p of paragraphs) {
        if (p.textContent.trim().length < 100) continue;

        let parent = p.parentElement;
        let grandparent = parent?.parentElement;

        if (parent && !candidates.includes(parent)) {
          candidates.push(parent);
        }
        if (grandparent && !candidates.includes(grandparent)) {
          candidates.push(grandparent);
        }
      }

      let bestElement = null;
      let bestScore = 0;

      for (const candidate of candidates) {
        const score = this._calculateScore(candidate);
        if (score > bestScore) {
          bestScore = score;
          bestElement = candidate;
        }
      }

      return bestElement;
    }

    /**
     * 获取链接密度
     */
    _getLinkDensity(element) {
      const textLength = (element.textContent || '').trim().length;
      if (textLength === 0) return 0;

      let linkLength = 0;
      const links = element.querySelectorAll('a');
      for (const link of links) {
        linkLength += (link.textContent || '').trim().length;
      }

      return linkLength / textLength;
    }

    /**
     * 清理元素中的无关内容
     */
    _cleanElement(element) {
      const selectorsToRemove = [
        'script',
        'style',
        'nav',
        'header',
        'footer',
        'aside',
        '.sidebar',
        '.advertisement',
        '.ads',
        '.social-share',
        '.comments',
        '#comments',
        '.related-posts',
        '.post-navigation'
      ];

      for (const selector of selectorsToRemove) {
        const elements = element.querySelectorAll(selector);
        for (const el of elements) {
          el.remove();
        }
      }
    }

    /**
     * 获取摘要
     */
    _getExcerpt(articleContent) {
      const text = articleContent.textContent.trim();
      const firstParagraph = text.split(/\n\s*\n/)[0] || text;
      return firstParagraph.substring(0, 200).trim();
    }

    /**
     * 获取作者信息
     */
    _getByline() {
      const selectors = [
        '[rel="author"]',
        '.author',
        '.byline',
        '[name="author"]',
        '.post-author'
      ];

      for (const selector of selectors) {
        const el = this._doc.querySelector(selector);
        if (el) {
          return el.textContent.trim() || el.content;
        }
      }

      return null;
    }

    /**
     * 获取文本方向
     */
    _getDirection(element) {
      const dir = element.dir || element.getAttribute('dir');
      if (dir) return dir;

      const lang = element.lang || this._doc.documentElement.lang;
      if (['ar', 'he', 'fa', 'ur'].some(l => lang?.startsWith(l))) {
        return 'rtl';
      }

      return 'ltr';
    }

    /**
     * 获取网站名称
     */
    _getSiteName() {
      const metaSiteName = this._doc.querySelector('meta[property="og:site_name"]');
      if (metaSiteName) return metaSiteName.content;

      // 从域名推断
      try {
        const hostname = new URL(this._doc.baseURI).hostname;
        return hostname.replace(/^www\./, '');
      } catch {
        return null;
      }
    }
  }

  /**
   * 检测页面是否可读取
   * @param {Document} doc - 文档对象
   * @param {Object} options - 配置选项
   * @returns {boolean}
   */
  function isProbablyReaderable(doc, options = {}) {
    const readability = new Readability(doc, options);
    return readability._isProbablyReaderable();
  }

  // 导出
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Readability, isProbablyReaderable };
  } else {
    // 浏览器环境
    if (typeof window !== 'undefined') {
      window.Readability = Readability;
      window.isProbablyReaderable = isProbablyReaderable;
    }
  }
})();
