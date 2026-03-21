# ZDFTranslate

A simple and efficient bilingual translation Chrome extension. Supports multiple AI translation services, free and ready to use.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/dnjhjgnofonkmcbgbdlfmhfpfjfidfae?color=4285F4&label=Chrome%20Web%20Store&logo=google-chrome&logoColor=white)](https://chrome.google.com/webstore/detail/dnjhjgnofonkmcbgbdlfmhfpfjfidfae)
[![License](https://img.shields.io/github/license/zhaodengfeng/zdftranslate?color=blue)](LICENSE)

## Latest Release

- **Version:** `26.3.21`

### v26.3.21 Changes

- **Fix: Screenshot image loss on Economist and similar sites** — Cross-origin images (e.g. Economist CDN) were lost during screenshots because setting `crossOrigin='anonymous'` on already-loaded images caused re-fetch failures. Now uses Service Worker proxy to fetch images as data URLs, bypassing CORS restrictions entirely.
- **Fix: Long article translation failures** — Long articles could trigger API errors ("exceeds limit") due to oversized combined text and insufficient output token budget. Added automatic text length checking with fallback to per-paragraph translation, smart splitting for oversized paragraphs (>3000 chars), and increased `max_tokens` from 2000 to 8000 for LLM providers.

## Features

- **Bilingual Display** — Side-by-side original and translated text
- **Multiple Modes** — Bilingual / Replace / Hover translation
- **Save as Image** — Export current mode (original / bilingual) as image
- **Export as PDF** — Export current mode (original / bilingual) as paginated PDF
- **YouTube Dual Subtitles** — Manual toggle via YouTube player button (no forced auto-enable)
- **OpenRouter Support** — Access hundreds of models via OpenRouter (GPT-4o, Claude 3.5, Gemini Pro, etc.)
- **Custom Services** — Add any OpenAI or Anthropic compatible API endpoints
- **Multiple Providers** — Google Translate, DeepL, OpenAI, Kimi, Zhipu, DeepSeek, Alibaba Cloud
- **Custom Styles** — Adjustable colors, font size, spacing
- **Official-style Provider Icons** — Service/model selectors support high-recognition brand-style icons

## Install

### Chrome Web Store

[<img src="https://img.shields.io/badge/Install%20from-Chrome%20Web%20Store-4285F4?logo=google-chrome&logoColor=white&style=for-the-badge" height="40">](https://chrome.google.com/webstore/detail/dnjhjgnofonkmcbgbdlfmhfpfjfidfae)

### Install from release package

1. Download and unzip `zdftranslate-26.3.21.zip`
2. Open `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the extracted folder (the folder containing `manifest.json`)

## Configuration

Click the extension icon → Settings to configure:
- Choose a translation provider (free providers and API providers supported)
- Enter your API key for advanced AI models
- Configure custom API endpoints in the service settings
- Customize display styles and behavior options

## API Keys

| Provider | Get API Key | Notes |
|----------|------------|-------|
| Google Translate | [Cloud Console](https://console.cloud.google.com/) → Enable Cloud Translation API → Create Credentials | Paid, usage-based |
| DeepL | [DeepL API](https://www.deepl.com/pro-api) → Sign up | Free tier available (keys ending in `:fx`) |
| OpenAI | [Platform](https://platform.openai.com/api-keys) → Create API Key | Paid, usage-based |
| **OpenRouter** | [OpenRouter Keys](https://openrouter.ai/keys) | Access to many models |
| **Custom** | Any compatible provider | Supports `/v1/chat/completions` or Anthropic format |
| Kimi | [Moonshot Platform](https://platform.moonshot.cn/) → API Keys | Free tier available |
| Zhipu AI | [Open Platform](https://open.bigmodel.cn/) → API Keys | Free tier available |
| DeepSeek | [DeepSeek Platform](https://platform.deepseek.com/) → API Keys | Free tier available |
| Alibaba Cloud (Qwen) | [Bailian Platform](https://bailian.console.aliyun.com/) → API Keys | Free tier available |

## License

[GPL-3.0](LICENSE)
