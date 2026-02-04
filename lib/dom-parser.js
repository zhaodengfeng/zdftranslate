// DOM Parser - 智能识别页面主要内容
const DOMParser = {
  // 获取元素的文本密度
  getTextDensity(element) {
    const textLength = element.innerText?.trim().length || 0;
    const linkLength = Array.from(element.querySelectorAll('a'))
      .reduce((sum, a) => sum + (a.innerText?.trim().length || 0), 0);
    
    if (textLength === 0) return 0;
    return (textLength - linkLength) / textLength;
  },

  // 计算元素得分（用于判断是否是主要内容）
  calculateScore(element) {
    const tagScores = {
      'article': 100,
      'main': 80,
      'section': 60,
      'div': 40
    };
    
    const tagName = element.tagName.toLowerCase();
    let score = tagScores[tagName] || 20;
    
    // 根据class/id加分
    const classAndId = (element.className + ' ' + element.id).toLowerCase();
    if (classAndId.includes('content')) score += 50;
    if (classAndId.includes('article')) score += 50;
    if (classAndId.includes('post')) score += 40;
    if (classAndId.includes('entry')) score += 30;
    if (classAndId.includes('main')) score += 30;
    
    // 根据文本密度调整
    score *= (0.5 + 0.5 * this.getTextDensity(element));
    
    // 根据文本长度调整
    const textLength = element.innerText?.trim().length || 0;
    score *= Math.min(textLength / 1000, 2);
    
    return score;
  },

  // 查找最佳内容容器
  findContentContainer() {
    const candidates = [];
    const elements = document.querySelectorAll('article, main, section, div[class*="content"], div[class*="article"]');
    
    elements.forEach(el => {
      const score = this.calculateScore(el);
      if (score > 50) {
        candidates.push({ element: el, score });
      }
    });
    
    candidates.sort((a, b) => b.score - a.score);
    
    return candidates.length > 0 ? candidates[0].element : document.body;
  },

  // 提取段落
  extractParagraphs(container) {
    const paragraphs = [];
    const elements = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
    
    elements.forEach(el => {
      const text = el.innerText?.trim();
      if (text && text.length > 20 && !el.closest('pre, code, nav, header, footer')) {
        paragraphs.push(el);
      }
    });
    
    return paragraphs;
  }
};

// 导出
if (typeof module !== 'undefined') {
  module.exports = DOMParser;
}
