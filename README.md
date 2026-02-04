# ZDFTranslate - 沉浸式双语翻译插件

类似「沉浸式翻译」的 Chrome 浏览器扩展，支持双语对照阅读。

## 功能特性

- 🌐 **智能识别** - 自动识别页面主要内容区域
- 📖 **双语对照** - 原文译文并排显示，便于对照学习
- 🎯 **多种模式** - 双语对照/直接替换/悬停翻译
- ⚡ **多翻译源** - 支持 Google Translate / DeepL / OpenAI
- 🎨 **自定义样式** - 可调整译文颜色、字号、行间距
- 🚫 **站点排除** - 可设置不需要翻译的网站

## 项目结构

```
zdf-translate/
├── manifest.json      # 插件配置
├── content.js         # 内容脚本（核心翻译逻辑）
├── background.js      # 后台服务
├── popup.html         # 弹出面板
├── popup.js           # 弹出面板逻辑
├── options.html       # 设置页面
├── options.js         # 设置页面逻辑
├── lib/
│   ├── dom-parser.js  # DOM解析工具
│   └── translator.js  # 翻译工具函数
├── styles/
│   ├── content.css    # 页面注入样式
│   ├── popup.css      # 弹出面板样式
│   └── options.css    # 设置页面样式
└── icons/
    ├── icon16.png     # 16x16 图标
    ├── icon48.png     # 48x48 图标
    └── icon128.png    # 128x128 图标
```

## 本地开发

1. 克隆项目
```bash
cd zdf-translate
```

2. 加载到 Chrome
- 打开 `chrome://extensions/`
- 开启「开发者模式」
- 点击「加载已解压的扩展程序」
- 选择本项目文件夹

3. 配置 API Key
- 点击扩展图标 → 高级设置
- 填入至少一个翻译服务的 API Key

## 获取 API Key

### Google Translate
1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建项目并启用 Cloud Translation API
3. 创建 API 密钥

### DeepL
1. 访问 [DeepL API](https://www.deepl.com/pro-api)
2. 注册账号获取 API Key
- `:fx` 结尾的是免费版

### OpenAI
1. 访问 [OpenAI Platform](https://platform.openai.com/api-keys)
2. 创建 API Key

## 打包上架

```bash
# 打包为 zip
zip -r zdf-translate.zip zdf-translate/ -x "*.git*"

# 或直接到 Chrome Web Store 开发者后台上传文件夹
```

## 权限说明

- `storage` - 保存用户设置
- `activeTab` - 访问当前标签页
- `scripting` - 注入翻译脚本
- `host_permissions` - 在所有网站运行

## License

MIT
