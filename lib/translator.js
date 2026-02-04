// Translator - 翻译相关工具函数
const Translator = {
  // 语言代码映射
  langMap: {
    'zh': 'zh-CN',
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    'en': 'en',
    'ja': 'ja',
    'ko': 'ko',
    'fr': 'fr',
    'de': 'de',
    'es': 'es',
    'ru': 'ru',
    'auto': 'auto'
  },

  // 检测文本语言（简化版）
  detectLanguage(text) {
    // 中文检测
    if (/[\u4e00-\u9fa5]/.test(text)) {
      return 'zh-CN';
    }
    // 日文检测
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) {
      return 'ja';
    }
    // 韩文检测
    if (/[\uac00-\ud7af]/.test(text)) {
      return 'ko';
    }
    // 俄文检测
    if (/[\u0400-\u04ff]/.test(text)) {
      return 'ru';
    }
    // 默认英文
    return 'en';
  },

  // 分割长文本（用于批量翻译）
  splitText(text, maxLength = 5000) {
    if (text.length <= maxLength) return [text];
    
    const chunks = [];
    let current = '';
    const sentences = text.split(/([.!?。！？\n]+)/);
    
    for (let i = 0; i < sentences.length; i += 2) {
      const sentence = (sentences[i] || '') + (sentences[i + 1] || '');
      if (current.length + sentence.length > maxLength) {
        if (current) chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    
    if (current) chunks.push(current.trim());
    return chunks;
  },

  // HTML实体转义
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  // 清理文本
  cleanText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
  },

  // 判断是否为可翻译内容
  isTranslatable(element) {
    // 跳过代码块
    if (element.closest('pre, code, .code, .highlight')) {
      return false;
    }
    
    // 跳过导航、侧边栏等
    if (element.closest('nav, aside, .sidebar, .menu, .navigation')) {
      return false;
    }
    
    // 跳过按钮、输入框
    if (element.closest('button, input, textarea, select')) {
      return false;
    }
    
    return true;
  }
};

// 导出
if (typeof module !== 'undefined') {
  module.exports = Translator;
}
