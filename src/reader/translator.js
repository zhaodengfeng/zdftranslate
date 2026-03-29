// ZDFTranslate - Reader Translation & Export Module
// 管理阅读模式下的批量翻译调度和图片/PDF导出

(function () {
  'use strict';

  /**
   * 批量翻译文章段落
   * 将段落分批发送给翻译 API，保持上下文连贯
   * @param {ArticleData} article
   * @param {Object} config - 翻译配置
   * @returns {Promise<string[]>} 翻译结果数组，与 paragraphs 一一对应
   */
  async function batchTranslateParagraphs(article, config) {
    const texts = article.paragraphs
      .filter((p) => p.type === 'text')
      .map((p) => p.content);

    if (!texts.length) return [];

    const BATCH_SIZE = 8; // 每批段落数
    const translations = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const batchText = batch
        .map((t, idx) => `[${i + idx + 1}] ${t}`)
        .join('\n\n');

      const prompt = `Translate the following numbered paragraphs into Chinese. Keep the paragraph numbers. Return each translated paragraph on its own line prefixed with the same number.\n\n${batchText}`;

      try {
        const translated = await sendTranslationRequest(prompt, config);
        const parsed = parseNumberedTranslation(translated, batch.length);

        // 将解析结果映射回正确位置
        for (let j = 0; j < batch.length; j++) {
          translations[i + j] = parsed[j] || batch[j];
        }
      } catch (err) {
        console.error('[ZDFReader] batch translate error:', err);
        // 失败时用原文占位
        for (let j = 0; j < batch.length; j++) {
          translations[i + j] = translations[i + j] || '';
        }
      }
    }

    return translations;
  }

  /**
   * 发送翻译请求到 background service worker
   */
  function sendTranslationRequest(text, config) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: 'translate',
          text: text,
          targetLang: config.targetLang || 'zh-CN',
          sourceLang: config.sourceLang || 'auto',
          service: config.translationService || 'microsoft-free',
          model: config.selectedModel || '',
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response?.error) {
            reject(new Error(response.error));
            return;
          }
          resolve(response?.translatedText || '');
        }
      );
    });
  }

  /**
   * 解析带编号的翻译结果
   */
  function parseNumberedTranslation(text, expectedCount) {
    const results = [];
    const lines = text.split('\n').filter((l) => l.trim());

    for (const line of lines) {
      // 匹配 [数字] 开头的行
      const match = line.match(/^\[(\d+)\]\s*(.+)/);
      if (match) {
        const idx = parseInt(match[1], 10) - 1;
        results[idx] = match[2].trim();
      }
    }

    // 如果编号解析失败，按行顺序分配
    if (results.filter(Boolean).length === 0) {
      return lines.slice(0, expectedCount);
    }

    return results;
  }

  /**
   * 导出阅读视图为高清图片
   */
  async function exportReaderAsImage() {
    const container = window.ZDFReader.getReaderContainer();
    if (!container) throw new Error('阅读视图未激活');

    // 临时隐藏工具栏
    const toolbar = container.querySelector('.zdf-reader-toolbar');
    const origToolbarDisplay = toolbar?.style.display;
    if (toolbar) toolbar.style.display = 'none';

    try {
      const canvas = await html2canvas(container, {
        scale: 3,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        scrollX: 0,
        scrollY: -container.querySelector('.zdf-reader-body')?.scrollTop || 0,
        height: container.querySelector('.zdf-reader-body')?.scrollHeight || container.scrollHeight,
        width: container.offsetWidth,
        windowWidth: container.offsetWidth,
      });

      // 添加底部水印
      const watermarkCanvas = addWatermark(canvas, document.title);

      // 下载
      const link = document.createElement('a');
      const title = document.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').slice(0, 60);
      link.download = `${title}_reader.png`;
      link.href = watermarkCanvas.toDataURL('image/png');
      link.click();
    } finally {
      if (toolbar) toolbar.style.display = origToolbarDisplay || '';
    }
  }

  /**
   * 导出阅读视图为 PDF
   */
  async function exportReaderAsPdf() {
    const container = window.ZDFReader.getReaderContainer();
    if (!container) throw new Error('阅读视图未激活');

    const jspdfNS = window.jspdf;
    if (!jspdfNS || !jspdfNS.jsPDF) {
      throw new Error('PDF模块未加载，请刷新页面后重试');
    }

    // 临时隐藏工具栏
    const toolbar = container.querySelector('.zdf-reader-toolbar');
    const origToolbarDisplay = toolbar?.style.display;
    if (toolbar) toolbar.style.display = 'none';

    try {
      const canvas = await html2canvas(container, {
        scale: 3,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        scrollX: 0,
        scrollY: -container.querySelector('.zdf-reader-body')?.scrollTop || 0,
        height: container.querySelector('.zdf-reader-body')?.scrollHeight || container.scrollHeight,
        width: container.offsetWidth,
        windowWidth: container.offsetWidth,
      });

      const { jsPDF } = jspdfNS;
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4',
        compress: true,
      });

      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();
      const sliceHeightPx = Math.max(1, Math.floor(canvas.width * (pdfH / pdfW)));

      let y = 0;
      let page = 0;

      while (y < canvas.height) {
        const remaining = canvas.height - y;
        const h = Math.min(sliceHeightPx, remaining);

        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = h;
        const pageCtx = pageCanvas.getContext('2d');
        pageCtx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);

        const imgData = pageCanvas.toDataURL('image/jpeg', 0.92);
        const renderH = (h * pdfW) / canvas.width;

        if (page > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, renderH, undefined, 'FAST');

        y += h;
        page++;
      }

      const title = document.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').slice(0, 60);
      pdf.save(`${title}_reader.pdf`);
    } finally {
      if (toolbar) toolbar.style.display = origToolbarDisplay || '';
    }
  }

  /**
   * 添加底部水印
   */
  function addWatermark(sourceCanvas, pageTitle) {
    const barHeight = 50;
    const totalHeight = sourceCanvas.height + barHeight * sourceCanvas.width / sourceCanvas.width;
    const barHeightPx = Math.round(barHeight * sourceCanvas.width / 800);

    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = sourceCanvas.width;
    resultCanvas.height = sourceCanvas.height + barHeightPx;

    const ctx = resultCanvas.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0);

    // 水印条
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, sourceCanvas.height, resultCanvas.width, barHeightPx);

    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.round(barHeightPx * 0.4)}px -apple-system, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText('ZDFTranslate', Math.round(barHeightPx * 0.5), sourceCanvas.height + barHeightPx / 2);

    return resultCanvas;
  }

  window.ZDFReaderBridge = {
    batchTranslateParagraphs,
    exportReaderAsImage,
    exportReaderAsPdf,
    sendTranslationRequest,
  };
})();
