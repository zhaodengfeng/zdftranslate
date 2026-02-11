# ZDFTranslate

A simple and efficient bilingual translation Chrome extension. Supports multiple AI translation services, free and ready to use.

## Features

- **Bilingual Display** — Side-by-side original and translated text
- **Multiple Modes** — Bilingual / Replace / Hover translation
- **YouTube Dual Subtitles** — Original + translated subtitles
- **Multiple Providers** — Google Translate, DeepL, OpenAI, Kimi, Zhipu, DeepSeek
- **Custom Styles** — Adjustable colors, font size, spacing
- **Site Exclusion** — Blacklist sites you don't want translated

## Install

1. Download from [Chrome Web Store](#) or load unpacked
2. Go to `chrome://extensions/` → Enable Developer Mode → Load Unpacked
3. Select the `src/` folder

## Configuration

Click the extension icon → Settings to configure:
- Choose a translation provider
- Enter your API key (some providers are free)
- Customize display styles

## Project Structure

```
src/
├── manifest.json       # Extension config
├── background.js       # Service worker
├── content.js          # Content script (core translation)
├── youtube.js          # YouTube subtitle injection
├── popup.html/js       # Popup UI
├── options.html/js     # Settings page
├── lib/                # Utilities
├── styles/             # CSS
└── icons/              # Extension icons
```

## License

[GPL-3.0](LICENSE)
