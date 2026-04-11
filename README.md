# ZDFTranslate

A simple and efficient bilingual webpage translation Chrome extension. Supports multiple AI translation services, free and ready to use out of the box.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/dnjhjgnofonkmcbgbdlfmhfpfjfidfae?color=4285F4&label=Chrome%20Web%20Store&logo=google-chrome&logoColor=white)](https://chrome.google.com/webstore/detail/dnjhjgnofonkmcbgbdlfmhfpfjfidfae)
[![License](https://img.shields.io/github/license/zhaodengfeng/zdftranslate?color=blue)](LICENSE)

## Latest Release

- **Version:** `26.4.12`

## Features

- **Free Out of the Box** — Built-in Microsoft Translator (Free) and Google Translate (Free), no API key required
- **Bilingual / Replace Mode** — Switch between side-by-side bilingual display and pure translation view, with paragraphs perfectly aligned
- **Top-to-Bottom Sequential Translation** — Translates the page from headings to body text in document-flow order, with a soft breathing pulse animation to show progress
- **Multiple Providers** — Supports DeepL, OpenAI, Claude, Gemini, Kimi, Zhipu GLM, Alibaba Bailian (Qwen), DeepSeek, and OpenRouter
- **Custom Services** — Add any OpenAI-compatible (`/v1/chat/completions`) or Anthropic-compatible (`/v1/messages`) API endpoint
- **Prompt Presets** — General, News, Academic, Technical, Literary, and Social Media presets (LLM services only)
- **AI Content Awareness** — Optionally pass page title and summary as context for more accurate translations
- **Remote Model List** — One-click fetch of the latest available models from providers, with support for custom model names
- **Selection Translation** — Right-click or use the floating button to translate selected text instantly
- **Customizable Styles** — Adjust translation color, font size, line spacing, and background highlight
- **Provider Brand Icons** — Service and model selectors feature high-recognition brand-style icons

## Install

### Chrome Web Store

[<img src="https://img.shields.io/badge/Install%20from-Chrome%20Web%20Store-4285F4?logo=google-chrome&logoColor=white&style=for-the-badge" height="40">](https://chrome.google.com/webstore/detail/dnjhjgnofonkmcbgbdlfmhfpfjfidfae)

### Install from release package

1. Download and unzip `zdftranslate-v26.4.12.zip` from [Releases](https://github.com/zhaodengfeng/zdftranslate/releases)
2. Open `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the extracted folder (the folder containing `manifest.json`)

## Release Highlights (v26.4.12)

- **MV3 Stability** — Background modules inlined into a single `background.js`, eliminating `importScripts` load failures
- **Fixed Free Translation** — Google Free / Microsoft Free endpoints restored; batch merging disabled to prevent paragraph misalignment and missed translations
- **Sequential Translation** — Page now translates top-to-bottom (headings → paragraphs → leaf containers) with a soft breathing pulse animation while waiting
- **Modernized Options UI** — Flat cards, two-column custom service grid, fixed oversized add-button icon
- **Fixed DOM Layout** — Translation containers now use `span` inside `<p>` tags to prevent browser auto-splitting
- **DeepL Fix** — Proper `target_lang` mapping for Chinese (`zh-CN` → `ZH`, `zh-TW` → `ZH-HANT`)

## Configuration

Click the extension icon → **Settings** to configure:
- Select a translation provider (free or API-based)
- Enter API keys for AI/advanced models
- Choose a Prompt preset and enable AI content awareness
- Add custom API endpoints
- Adjust display styles (color, font size, line spacing)

## License

[GPL-3.0](LICENSE)
