# ZDFTranslate

A simple and efficient bilingual translation Chrome extension. Supports multiple AI translation services, free and ready to use.

## Latest Release

- **Version:** `2.1.18`

## Features

- **Bilingual Display** — Side-by-side original and translated text
- **Multiple Modes** — Bilingual / Replace / Hover translation
- **Save as Image** — Export current mode (original / bilingual) as image
- **Export as PDF** — Export current mode (original / bilingual) as paginated PDF
- **YouTube Dual Subtitles** — Original + translated subtitles
- **OpenRouter Support** — Access hundreds of models via OpenRouter (GPT-4o, Claude 3.5, Gemini Pro, etc.)
- **Custom Services** — Add any OpenAI or Anthropic compatible API endpoints
- **Multiple Providers** — Google Translate, DeepL, OpenAI, Kimi, Zhipu, DeepSeek, Alibaba Cloud
- **Custom Styles** — Adjustable colors, font size, spacing
- **Site Exclusion** — Blacklist sites you don't want translated

## Install

### Chrome Web Store

- Download from Chrome Web Store: https://chrome.google.com/webstore/detail/dnjhjgnofonkmcbgbdlfmhfpfjfidfae

### Install from release package

1. Download and unzip `zdf-translate-v2.1.16.zip`
2. Open `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the extracted folder (the folder containing `manifest.json`)

## Configuration

Click the extension icon → Settings to configure:
- Choose a translation provider (LibreTranslate is free by default)
- Enter your API key for advanced AI models
- Configure custom API endpoints in the "International Services" section
- Customize display styles

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
