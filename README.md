# ZDFTranslate

简洁高效的双语对照网页翻译插件，支持多种 AI 翻译服务，免费开箱即用。

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/dnjhjgnofonkmcbgbdlfmhfpfjfidfae?color=4285F4&label=Chrome%20Web%20Store&logo=google-chrome&logoColor=white)](https://chrome.google.com/webstore/detail/dnjhjgnofonkmcbgbdlfmhfpfjfidfae)
[![License](https://img.shields.io/github/license/zhaodengfeng/zdftranslate?color=blue)](LICENSE)

## Latest Release

- **Version:** `26.4.12`

## Features

- **免费开箱即用** — 内置 Microsoft Translator (Free) 与 Google Translate (Free)，无需配置 API Key
- **双语对照 / 纯译文** — 两种显示模式随心切换，译文与原文段落一一对应
- **顺序渐进翻译** — 从页面标题到正文按文档流逐段翻译，配合呼吸闪烁动效，直观感知进度
- **多服务商支持** — 支持 DeepL、OpenAI、Claude、Gemini、Kimi、智谱 GLM、阿里百炼 (Qwen)、DeepSeek、OpenRouter
- **自定义服务** — 添加任意兼容 OpenAI (`/v1/chat/completions`) 或 Anthropic (`/v1/messages`) 格式的 API 端点
- **Prompt 预设** — 通用、新闻、学术、技术、文学、社交媒体六种风格（仅对 LLM 服务生效）
- **AI 内容感知** — 可选将文章标题/摘要作为上下文传入，提升翻译准确度
- **远程模型列表** — 一键获取服务商最新可用模型，支持自定义模型名
- **划词翻译** — 选中文本后通过右键菜单或悬浮按钮快速翻译
- **自定义样式** — 可调整译文颜色、字号、行间距与背景高亮
- **服务图标识别** — 翻译服务与模型选择器均带有高辨识度品牌图标

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

## API Keys

| Provider | Get API Key | Notes |
|----------|------------|-------|
| DeepL | [DeepL API](https://www.deepl.com/pro-api) → Sign up | Free tier available (keys ending in `:fx`) |
| OpenAI | [Platform](https://platform.openai.com/api-keys) → Create API Key | Paid, usage-based |
| Claude | [Anthropic Console](https://console.anthropic.com/settings/keys) | Paid, usage-based |
| Gemini | [Google AI Studio](https://aistudio.google.com/apikey) | Free tier available |
| **OpenRouter** | [OpenRouter Keys](https://openrouter.ai/keys) | Access to hundreds of models |
| **Custom** | Any compatible provider | Supports `/v1/chat/completions` or Anthropic format |
| Kimi | [Moonshot Platform](https://platform.moonshot.cn/) → API Keys | Free tier available |
| Zhipu AI | [Open Platform](https://open.bigmodel.cn/) → API Keys | Free tier available |
| DeepSeek | [DeepSeek Platform](https://platform.deepseek.com/) → API Keys | Free tier available |
| Alibaba Cloud (Qwen) | [Bailian Platform](https://bailian.console.aliyun.com/) → API Keys | Free tier available |

## License

[GPL-3.0](LICENSE)
