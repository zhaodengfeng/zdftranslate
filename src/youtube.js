// YouTube Subtitle Translator for ZDFTranslate - v1.5.0 (MASSIVE FONTS & LOWER POSITION)

(function() {
  'use strict';
  
  if (!window.location.hostname.includes('youtube.com')) return;

  let translationActive = false;
  let observer = null;
  const translationCache = new Map(); 
  let currentOverlay = null;

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

    if (config.autoEnableYouTubeCC !== false) {
      enableCaptionsWithRetry(0);
    }

    observeSubtitles();
  }

  function stopYouTubeTranslation() {
    translationActive = false;
    if (observer) {
      observer.disconnect();
      observer = null;
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

  function enableCaptionsWithRetry(attempt) {
    if (attempt > 10) return; 
    
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!player) {
        setTimeout(() => enableCaptionsWithRetry(attempt + 1), 2000);
        return;
    }

    const ccBtn = player.querySelector('.ytp-subtitles-button');
    if (ccBtn) {
        if (ccBtn.getAttribute('aria-pressed') === 'false') {
            ccBtn.click();
        }
    } else {
        setTimeout(() => enableCaptionsWithRetry(attempt + 1), 2000);
    }
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
          }
          if (config.autoTranslateYouTube !== false) {
             startYouTubeTranslation();
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
