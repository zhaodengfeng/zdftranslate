/**
 * 选择工具栏（Selection Toolbar）
 * 用户选中文本时显示快速操作工具栏
 */

class SelectionToolbar {
  constructor(options = {}) {
    this.options = {
      onTranslate: options.onTranslate || (() => {}),
      onCopy: options.onCopy || (() => {}),
      onExplain: options.onExplain || null,  // 可选：解释功能
      position: options.position || 'above', // 'above' | 'below'
      theme: options.theme || 'auto',        // 'light' | 'dark' | 'auto'
      ...options
    };
    
    this.toolbar = null;
    this.hideTimeout = null;
    this.isVisible = false;
    
    this.init();
  }

  init() {
    // 监听选区变化
    document.addEventListener('selectionchange', () => {
      this.handleSelectionChange();
    });

    // 点击外部隐藏
    document.addEventListener('mousedown', (e) => {
      if (this.toolbar && !this.toolbar.contains(e.target)) {
        this.hide();
      }
    });

    // 键盘 ESC 隐藏
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    });
  }

  handleSelectionChange() {
    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (text.length > 0 && text.length < 1000) {
      // 延迟显示，避免频繁触发
      clearTimeout(this.hideTimeout);
      this.hideTimeout = setTimeout(() => {
        this.show(selection, text);
      }, 200);
    } else {
      this.hide();
    }
  }

  show(selection, text) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    this.removeExisting();
    this.createToolbar();
    this.positionToolbar(rect);
    this.isVisible = true;

    // 添加动画
    requestAnimationFrame(() => {
      this.toolbar.style.opacity = '1';
      this.toolbar.style.transform = 'translateY(0)';
    });

    // 保存当前选中文本
    this.currentText = text;
    this.currentSelection = selection;
  }

  createToolbar() {
    const theme = this.getTheme();
    
    this.toolbar = document.createElement('div');
    this.toolbar.className = `zdf-selection-toolbar zdf-theme-${theme}`;
    this.toolbar.innerHTML = `
      <div class="zdf-toolbar-content">
        <button class="zdf-toolbar-btn zdf-btn-translate" title="翻译">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
          </svg>
          <span>翻译</span>
        </button>
        <button class="zdf-toolbar-btn zdf-btn-copy" title="复制">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
          </svg>
          <span>复制</span>
        </button>
        ${this.options.onExplain ? `
        <button class="zdf-toolbar-btn zdf-btn-explain" title="解释">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M11 18h2v-3h3v-2h-3v-3h-2v3H8v2h3v3zm1-12c4.97 0 9 4.03 9 9s-4.03 9-9 9-9-4.03-9-9 4.03-9 9-9zm0-2C6.48 4 2 8.48 2 14s4.48 10 10 10 10-4.48 10-10S17.52 4 12 4z"/>
          </svg>
          <span>解释</span>
        </button>
        ` : ''}
      </div>
      <div class="zdf-toolbar-arrow"></div>
    `;

    // 绑定事件
    this.toolbar.querySelector('.zdf-btn-translate').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.options.onTranslate(this.currentText, this.currentSelection);
      this.hide();
    });

    this.toolbar.querySelector('.zdf-btn-copy').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(this.currentText).then(() => {
        this.showToast('已复制');
      });
      this.options.onCopy(this.currentText);
    });

    if (this.options.onExplain) {
      this.toolbar.querySelector('.zdf-btn-explain').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.options.onExplain(this.currentText);
        this.hide();
      });
    }

    document.body.appendChild(this.toolbar);
  }

  positionToolbar(rect) {
    const toolbarRect = this.toolbar.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    let left = rect.left + rect.width / 2 - toolbarRect.width / 2;
    let top;
    let arrowPosition = 'bottom';

    // 水平边界处理
    if (left < 10) left = 10;
    if (left + toolbarRect.width > viewportWidth - 10) {
      left = viewportWidth - toolbarRect.width - 10;
    }

    // 垂直位置：优先显示在选区上方
    if (rect.top > toolbarRect.height + 20 || this.options.position === 'above') {
      top = rect.top - toolbarRect.height - 10;
      arrowPosition = 'bottom';
    } else {
      top = rect.bottom + 10;
      arrowPosition = 'top';
    }

    this.toolbar.style.left = `${left + window.scrollX}px`;
    this.toolbar.style.top = `${top + window.scrollY}px`;
    
    // 设置箭头位置
    const arrow = this.toolbar.querySelector('.zdf-toolbar-arrow');
    if (arrowPosition === 'top') {
      arrow.style.top = '-6px';
      arrow.style.bottom = 'auto';
      arrow.style.borderWidth = '0 6px 6px 6px';
      arrow.style.borderColor = 'transparent transparent var(--bg-color) transparent';
    }
  }

  getTheme() {
    if (this.options.theme !== 'auto') {
      return this.options.theme;
    }
    // 检测系统主题
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'zdf-toolbar-toast';
    toast.textContent = message;
    this.toolbar.appendChild(toast);
    
    setTimeout(() => toast.remove(), 1500);
  }

  hide() {
    if (!this.toolbar) return;
    
    this.toolbar.style.opacity = '0';
    this.toolbar.style.transform = 'translateY(-10px)';
    
    setTimeout(() => {
      this.removeExisting();
      this.isVisible = false;
    }, 200);
  }

  removeExisting() {
    const existing = document.querySelector('.zdf-selection-toolbar');
    if (existing) {
      existing.remove();
    }
    this.toolbar = null;
  }

  destroy() {
    this.removeExisting();
    // 清理事件监听器（如果需要完全销毁）
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SelectionToolbar;
}
