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

  let config = {
    targetLang: 'zh-CN',
    translationService: 'libretranslate', 
    apiKeys: {},
    autoTranslateYouTube: true,
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
      
      if (config.autoTranslateYouTube !== false) {
          startYouTubeTranslation();
      }
    } else {
      startYouTubeTranslation();
    }
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleTranslation' || request.action === 'toggleYouTubeTranslation') {
      if (request.enabled) {
        startYouTubeTranslation();
      } else {
        stopYouTubeTranslation();
      }
    } else if (request.action === 'updateConfig') {
      config = { ...config, ...request.config };
      if (config.autoTranslateYouTube !== false && !translationActive) {
        startYouTubeTranslation();
      } else if (config.autoTranslateYouTube === false && translationActive) {
        stopYouTubeTranslation();
      }

      if (translationActive) {
        if (config.autoTranslateYouTube === false) {
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

  function startYouTubeTranslation() {
    if (translationActive) return;
    translationActive = true;
    
    injectStyles();
    createOverlay();

    // 内置策略：只要开启自动双语字幕，就自动尝试开启CC并切英文轨
    if (config.autoTranslateYouTube !== false) {
      scheduleEnsureCaptions(0);
      startCaptionWatchdog();
    }

    observeSubtitles();
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
    if (!translationActive || config.autoTranslateYouTube === false) return;
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
      if (!translationActive || config.autoTranslateYouTube === false) return;

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
      updateTimeout = setTimeout(performUpdate, 50);
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
                service: config.translationService 
            }, resolve);
        });
        
        if (response && response.translatedText) {
          translationCache.set(cacheKey, response.translatedText);
          return response.translatedText;
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
        width: 85% !important;
        max-width: 1100px !important;
        text-align: center !important;
        pointer-events: none !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: flex-end !important;
        gap: 0px !important;
      }

      /* Original Text Styling - White, ~28px */
      .zdf-movie-original {
        font-family: 'Roboto', 'Arial', sans-serif !important;
        font-size: 1.75em !important;
        font-weight: 500 !important;
        color: #FFFFFF !important;
        text-shadow: 
          0px 0px 8px rgba(0, 0, 0, 1),
          0px 0px 10px rgba(0, 0, 0, 1),
          2px 2px 5px rgba(0, 0, 0, 0.95);
        background: rgba(0, 0, 0, 0.65) !important;
        padding: 6px 16px !important;
        border-radius: 8px !important;
        display: block !important;
        line-height: 1.3 !important;
        margin-bottom: 8px !important;
      }

      /* Translated Text Styling - Gold, ~42px, MASSIVE & BOLD */
      .zdf-movie-translated {
        font-family: 'Roboto', 'Noto Sans CJK SC', sans-serif !important;
        font-size: 2.6em !important;
        font-weight: 800 !important;
        color: #FFD700 !important;
        text-shadow: 
          0px 0px 10px rgba(0, 0, 0, 1),
          0px 0px 12px rgba(0, 0, 0, 1),
          3px 3px 6px rgba(0, 0, 0, 1),
          0px 0px 20px rgba(255, 215, 0, 0.3);
        background: rgba(0, 0, 0, 0.7) !important;
        padding: 8px 20px !important;
        border-radius: 8px !important;
        display: block !important;
        line-height: 1.3 !important;
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
          if (currentOverlay) {
              currentOverlay.innerHTML = '';
              currentOverlay.style.display = 'none';
              delete currentOverlay.dataset.lastText;
          }
          lastSubtitleSeenAt = 0;

          if (config.autoTranslateYouTube !== false) {
            if (!translationActive) {
              startYouTubeTranslation();
            } else {
              observeSubtitles();
              if (config.autoTranslateYouTube !== false) {
                scheduleEnsureCaptions(0, 500);
                startCaptionWatchdog();
              }
            }
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
