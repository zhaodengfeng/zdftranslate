# ZDFTranslate

A simple and efficient bilingual translation Chrome extension. Supports multiple AI translation services, free and ready to use.

## Features

- **Bilingual Display** — Side-by-side original and translated text
- **Multiple Modes** — Bilingual / Replace / Hover translation
- **Save as Image** — Export current mode (original / bilingual) as image
- **Export as PDF** — Export current mode (original / bilingual) as paginated PDF
- **YouTube Dual Subtitles** — Original + translated subtitles
- **Multiple Providers** — Google Translate, DeepL, OpenAI, Kimi, Zhipu, DeepSeek
- **Custom Styles** — Adjustable colors, font size, spacing
- **Site Exclusion** — Blacklist sites you don't want translated

## Install

1. Download from [Chrome Web Store](https://chrome.google.com/webstore/detail/dnjhjgnofonkmcbgbdlfmhfpfjfidfae) or load unpacked
2. Go to `chrome://extensions/` → Enable Developer Mode → Load Unpacked
3. Select the `src/` folder

## Configuration

Click the extension icon → Settings to configure:
- Choose a translation provider
- Enter your API key (some providers are free)
- Customize display styles

## API Keys

| Provider | Get API Key | Notes |
|----------|------------|-------|
| Google Translate | [Cloud Console](https://console.cloud.google.com/) → Enable Cloud Translation API → Create Credentials | Paid, usage-based |
| DeepL | [DeepL API](https://www.deepl.com/pro-api) → Sign up | Free tier available (keys ending in `:fx`) |
| OpenAI | [Platform](https://platform.openai.com/api-keys) → Create API Key | Paid, usage-based |
| Kimi | [Moonshot Platform](https://platform.moonshot.cn/) → API Keys | Free tier available |
| Zhipu AI | [Open Platform](https://open.bigmodel.cn/) → API Keys | Free tier available |
| DeepSeek | [DeepSeek Platform](https://platform.deepseek.com/) → API Keys | Free tier available |
| Alibaba Cloud (Qwen) | [Bailian Platform](https://bailian.console.aliyun.com/) → API Keys | Free tier available |

## License

[GPL-3.0](LICENSE)
