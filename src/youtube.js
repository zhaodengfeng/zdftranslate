// YouTube Subtitle Translator for ZDFTranslate - v1.5.0 (MASSIVE FONTS & LOWER POSITION)

(function() {
  'use strict';
  
  if (!window.location.hostname.includes('youtube.com')) return;

  let translationActive = false;
  let observer = null;
  const translationCache = new Map(); 
  let currentOverlay = null;
  let ccRetryTimer = null;
  let ccWatchdogTimer = null;
  let lastSubtitleSeenAt = 0;
  let ytToggleBtn = null;
  let ytToggleRetryTimer = null;

  let config = {
    targetLang: 'zh-CN',
    translationService: 'libretranslate', 
    apiKeys: {},
    autoEnableYouTubeCC: true,
    style: {
      translationColor: '#FFD700',
      translationSize: '1.2em'
    }
  };

  chrome.storage.sync.get(['zdfConfig'], (result) => {
    if (result.zdfConfig) {
      config = { ...config, ...result.zdfConfig };
      if (!config.style.translationColor || config.style.translationColor === '#111111') {
          config.style.translationColor = '#FFD700'; // Default gold
      }
      
    }
    ensureYouTubeToggleButton();
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleTranslation' || request.action === 'toggleYouTubeTranslation') {
      if (request.enabled) {
        startYouTubeTranslation();
      } else {
        stopYouTubeTranslation();
      }
      updateYouTubeToggleButtonState();
    } else if (request.action === 'updateConfig') {
      config = { ...config, ...request.config };
      ensureYouTubeToggleButton();
      if (translationActive) {
        if (config.autoEnableYouTubeCC === false) {
          if (ccRetryTimer) {
            clearTimeout(ccRetryTimer);
            ccRetryTimer = null;
          }
          if (ccWatchdogTimer) {
            clearInterval(ccWatchdogTimer);
            ccWatchdogTimer = null;
          }
        } else {
          scheduleEnsureCaptions(0, 200);
          startCaptionWatchdog();
        }
      }

      // Trigger a re-render if active to apply new styles
      if (translationActive && currentOverlay) {
          const lastText = currentOverlay.dataset.lastText;
          if (lastText) {
             renderOverlay(lastText, currentOverlay.querySelector('.zdf-overlay-translated')?.textContent);
          }
      }
    }
  });

  function updateYouTubeToggleButtonState() {
    if (!ytToggleBtn) return;
    ytToggleBtn.setAttribute('aria-pressed', translationActive ? 'true' : 'false');
    ytToggleBtn.classList.toggle('zdf-yt-toggle-active', !!translationActive);
    ytToggleBtn.title = translationActive ? '关闭双语字幕' : '开启双语字幕';
  }

  function ensureYouTubeToggleButton(retry = 0) {
    if (!location.href.includes('youtube.com/watch')) return;

    const controls = document.querySelector('.ytp-right-controls');
    if (!controls) {
      if (ytToggleRetryTimer) clearTimeout(ytToggleRetryTimer);
      if (retry < 20) {
        ytToggleRetryTimer = setTimeout(() => ensureYouTubeToggleButton(retry + 1), 500);
      }
      return;
    }

    if (ytToggleBtn && controls.contains(ytToggleBtn)) {
      updateYouTubeToggleButtonState();
      return;
    }

    const btn = document.createElement('button');
    btn.className = 'ytp-button zdf-yt-toggle-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', '切换双语字幕');
    btn.innerHTML = `
      <svg viewBox="0 0 36 36" class="zdf-yt-toggle-icon" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="6" y="8" width="24" height="20" rx="4.5" stroke="currentColor" stroke-width="2.2"/>
        <path d="M12 14.2H24L12 21.8H24" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (translationActive) {
        stopYouTubeTranslation();
      } else {
        startYouTubeTranslation();
      }
      updateYouTubeToggleButtonState();
    });

    controls.insertBefore(btn, controls.firstChild || null);
    ytToggleBtn = btn;
    updateYouTubeToggleButtonState();
  }

  function startYouTubeTranslation() {
    if (translationActive) return;
    translationActive = true;
    
    injectStyles();
    createOverlay();

    // 开启双语字幕时，自动尝试开启CC并切英文轨（可通过 autoEnableYouTubeCC 关闭）
    if (config.autoEnableYouTubeCC !== false) {
      scheduleEnsureCaptions(0);
      startCaptionWatchdog();
    }

    observeSubtitles();
    updateYouTubeToggleButtonState();
  }

  function stopYouTubeTranslation() {
    translationActive = false;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (ccRetryTimer) {
      clearTimeout(ccRetryTimer);
      ccRetryTimer = null;
    }
    if (ccWatchdogTimer) {
      clearInterval(ccWatchdogTimer);
      ccWatchdogTimer = null;
    }
    if (currentOverlay) {
        currentOverlay.remove();
        currentOverlay = null;
    }
    updateYouTubeToggleButtonState();
  }

  function createOverlay() {
      if (document.getElementById('zdf-movie-subs')) return;

      const overlay = document.createElement('div');
      overlay.id = 'zdf-movie-subs';
      
      // Try to append to movie_player first for fullscreen compatibility
      // If we append to body, fullscreen video z-index might still cover it depending on browser impl
      const player = document.getElementById('movie_player') || document.body;
      player.appendChild(overlay);
      currentOverlay = overlay;
      
      overlay.style.display = 'none';
  }

  function scheduleEnsureCaptions(attempt = 0, delayMs = 600) {
    if (ccRetryTimer) clearTimeout(ccRetryTimer);
    ccRetryTimer = setTimeout(() => {
      ensureCaptionsWithRetry(attempt);
    }, delayMs);
  }

  function ensureCaptionsWithRetry(attempt) {
    if (!translationActive || config.autoEnableYouTubeCC === false) return;
    if (attempt > 15) return;

    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!player) {
      scheduleEnsureCaptions(attempt + 1, 1200);
      return;
    }

    const ccBtn = player.querySelector('.ytp-subtitles-button');
    if (!ccBtn) {
      scheduleEnsureCaptions(attempt + 1, 1200);
      return;
    }

    if (ccBtn.getAttribute('aria-pressed') === 'false') {
      ccBtn.click();
    }

    const switched = trySwitchCaptionTrackToEnglish(player);

    // 没切到英语或字幕轨还没准备好，继续重试
    if (!switched) {
      scheduleEnsureCaptions(attempt + 1, 1000);
    }
  }

  function trySwitchCaptionTrackToEnglish(player) {
    try {
      const api = player;
      if (!api || typeof api.getOption !== 'function' || typeof api.setOption !== 'function') {
        return false;
      }

      const trackList = api.getOption('captions', 'tracklist');
      if (!Array.isArray(trackList) || trackList.length === 0) {
        return false;
      }

      // 优先英文人工字幕，其次英文自动字幕（asr）
      const englishTrack =
        trackList.find(t => t?.languageCode === 'en' && !t?.kind) ||
        trackList.find(t => t?.languageCode === 'en') ||
        null;

      if (!englishTrack) return false;

      const currentTrack = api.getOption('captions', 'track');
      if (currentTrack?.languageCode === 'en') {
        return true;
      }

      api.setOption('captions', 'track', englishTrack);
      return true;
    } catch (e) {
      return false;
    }
  }

  function startCaptionWatchdog() {
    if (ccWatchdogTimer) clearInterval(ccWatchdogTimer);

    ccWatchdogTimer = setInterval(() => {
      if (!translationActive || config.autoEnableYouTubeCC === false) return;

      // 15 秒内没抓到字幕，认为可能没成功自动开启，再尝试一次
      const stale = Date.now() - lastSubtitleSeenAt > 15000;
      if (stale) {
        scheduleEnsureCaptions(0, 300);
      }
    }, 5000);
  }

  function observeSubtitles() {
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!player) {
      setTimeout(observeSubtitles, 1000); 
      return;
    }

    if (observer) observer.disconnect();
    
    observer = new MutationObserver((mutations) => {
        if (!translationActive) return;
        updateOverlayContent();
    });

    observer.observe(player, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  let updateTimeout;
  function updateOverlayContent() {
      if (updateTimeout) clearTimeout(updateTimeout);
      // 合并刷新，减少字幕抖动/闪烁
      updateTimeout = setTimeout(performUpdate, 120);
  }

  async function performUpdate() {
      if (!translationActive) return;

      // Re-check overlay existence
      const player = document.getElementById('movie_player');
      if (player && currentOverlay && !player.contains(currentOverlay)) {
           player.appendChild(currentOverlay);
      } else if (!currentOverlay) {
          createOverlay();
      }

      // Find all active caption segments from YouTube's internal structure
      const segments = document.querySelectorAll('.ytp-caption-segment');
      
      if (segments.length === 0) {
          if (currentOverlay) {
              currentOverlay.style.display = 'none';
              currentOverlay.innerHTML = '';
          }
          return;
      }

      let fullText = '';
      segments.forEach(seg => {
          fullText += seg.textContent + ' ';
      });
      lastSubtitleSeenAt = Date.now();
      fullText = fullText.trim();

      if (!fullText) {
          if (currentOverlay) currentOverlay.style.display = 'none';
          return;
      }

      if (currentOverlay.dataset.lastText === fullText) {
          currentOverlay.style.display = 'block';
          return; 
      }
      
      currentOverlay.dataset.lastText = fullText;

      const displayText = await getTranslation(fullText);
      renderOverlay(fullText, displayText);
  }

  async function getTranslation(text) {
      const cleanText = text.replace(/\s+/g, ' ').trim();
      const cacheKey = `${config.targetLang}:${cleanText}`;
      
      if (translationCache.has(cacheKey)) {
          return translationCache.get(cacheKey);
      }

      try {
        const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({
                action: 'translate',
                text: cleanText,
                targetLang: config.targetLang,
                sourceLang: config.sourceLang || 'auto',
                service: config.translationService,
                model: config?.selectedModels?.[config.translationService] || '',
                enableAIContentAware: !!config.enableAIContentAware,
                articleTitle: document.title || '',
                articleSummary: '',
                promptVersion: 'v6-p1'
            }, resolve);
        });

        if (response && Object.prototype.hasOwnProperty.call(response, 'translatedText')) {
          translationCache.set(cacheKey, response.translatedText || '');
          return response.translatedText || '';
      }
      } catch (e) {
          console.error('[ZDFTranslate] Translation error:', e);
      }
      return null;
  }

  function renderOverlay(original, translated) {
      if (!currentOverlay) return;

      currentOverlay.innerHTML = '';
      currentOverlay.style.display = 'block';

      // Original Text (English/Source) - Top, white, ~24px
      const originalDiv = document.createElement('div');
      originalDiv.className = 'zdf-movie-original';
      originalDiv.textContent = original;
      currentOverlay.appendChild(originalDiv);

      // Translated Text (Chinese/Target) - Bottom, gold, ~32px, LARGER
      if (translated) {
          const transDiv = document.createElement('div');
          transDiv.className = 'zdf-movie-translated';
          transDiv.textContent = translated;
          
          // Allow user color override, but default to gold
          const userColor = config.style.translationColor || '#FFD700';
          if (userColor !== '#FFD700' && userColor !== '#111111' && userColor !== '#000000') {
              transDiv.style.color = userColor;
          }
          // Note: Font size is now controlled by CSS (2em) for consistency

          currentOverlay.appendChild(transDiv);
      }
  }

  function injectStyles() {
    if (document.getElementById('zdf-yt-overlay-style')) return;
    const style = document.createElement('style');
    style.id = 'zdf-yt-overlay-style';
    style.textContent = `
      /* Hide original YouTube captions visually but keep accessible for scraping */
      .ytp-caption-window-container {
        opacity: 0 !important;
        pointer-events: none !important;
      }

      /* External Overlay Container - Vertical Stacking - LOWER POSITION */
      #zdf-movie-subs {
        position: absolute !important;
        bottom: 8% !important; 
        left: 50% !important;
        transform: translateX(-50%) !important;
        width: 80% !important;
        max-width: 980px !important;
        text-align: center !important;
        pointer-events: none !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: flex-end !important;
        gap: 0px !important;
      }

      /* Original Text Styling */
      .zdf-movie-original {
        font-family: 'Roboto', 'Arial', sans-serif !important;
        font-size: 1.45em !important;
        font-weight: 500 !important;
        color: #FFFFFF !important;
        text-shadow: 
          0px 0px 8px rgba(0, 0, 0, 1),
          0px 0px 10px rgba(0, 0, 0, 1),
          2px 2px 5px rgba(0, 0, 0, 0.95);
        background: rgba(0, 0, 0, 0.55) !important;
        padding: 6px 14px !important;
        border-radius: 8px !important;
        display: block !important;
        line-height: 1.35 !important;
        margin-bottom: 6px !important;
      }

      /* Translated Text Styling - balanced readability */
      .zdf-movie-translated {
        font-family: 'Roboto', 'Noto Sans CJK SC', sans-serif !important;
        font-size: 1.8em !important;
        font-weight: 700 !important;
        color: #FFD700 !important;
        text-shadow: 
          0px 0px 10px rgba(0, 0, 0, 1),
          0px 0px 12px rgba(0, 0, 0, 1),
          2px 2px 5px rgba(0, 0, 0, 1),
          0px 0px 16px rgba(255, 215, 0, 0.25);
        background: rgba(0, 0, 0, 0.5) !important;
        padding: 7px 16px !important;
        border-radius: 8px !important;
        display: block !important;
        line-height: 1.35 !important;
      }

      .zdf-yt-toggle-btn {
        width: 56px;
        height: 56px;
        padding: 0 !important;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        position: relative;
        color: rgba(255,255,255,0.92);
      }

      .zdf-yt-toggle-icon {
        width: 30px;
        height: 30px;
        opacity: 0.98;
        display: block;
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
      }

      .zdf-yt-toggle-btn:hover {
        color: #fff;
      }

      .zdf-yt-toggle-btn.zdf-yt-toggle-active {
        color: #3ea6ff;
      }
    `;
    document.head.appendChild(style);
  }

  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      if (url.includes('youtube.com/watch')) {
          ensureYouTubeToggleButton();

          if (currentOverlay) {
              currentOverlay.innerHTML = '';
              currentOverlay.style.display = 'none';
              delete currentOverlay.dataset.lastText;
          }
          lastSubtitleSeenAt = 0;

      } else {
          if (ytToggleBtn) {
            ytToggleBtn.remove();
            ytToggleBtn = null;
          }
      }
    }
  }).observe(document, {subtree: true, childList: true});

  setInterval(() => {
    if (translationCache.size > 500) {
      translationCache.clear();
    }
  }, 1000 * 60 * 10);

})();
