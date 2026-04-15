# Changelog

## v26.4.15b6 (2026-04-15)

本次按 27 项代码审查问题全面修复（P0/P1/P2）。

**Security (P0/P1)**
- `safeRestoreHtml` 重写为严格白名单 sanitizer（DOMParser + 限定标签），拒绝 SVG/style/iframe/object/embed/script，仅 `<a>` 保留 http(s) 协议 href。
- 加密密钥不再以明文存于 `chrome.storage.local`：改为基于 `installId + runtime.id + 随机 salt` 的 PBKDF2 派生 AES-GCM wrapping key（仅 salt/installId 持久化，派生结果仅驻留 Service Worker 会话内存）。旧版 raw key 自动迁移后删除。
- 缓存键改用 `SHA-256 hex` 摘要，异步 `buildTranslationCacheKey()`。
- 日志统一走 `sanitizeErrorMessage`：20+ 位长串替换为 `***`，长度截断 300 字符；`DEBUG` 默认关闭，info/warn 不输出。

**Race / Concurrency (P1)**
- `startTranslation` 开始时 snapshot config，IntersectionObserver 回调使用快照，避免服务切换导致状态错乱。
- `enqueueTranslationRequest` / `handleTranslation` 增加 in-flight dedupe（相同 cacheKey 共享 Promise）。
- `fetchWithRetry` 识别 `NO_RETRY_STATUS = [400, 401, 403, 404, 422]`，客户端错误不再重试浪费时间。
- 提取 `applyRateLimit()`。

**Memory**
- `lazyLoadObservers` 上限 8，超出时踢出最旧者；`restoreOriginal` 完整断开并清空。
- 新增 SPA MutationObserver（800ms 防抖），`translationActive` 为 true 时自动翻译新增内容；还原时断开。

**Models**
- background default：`claude-sonnet-4-20250514` → `claude-sonnet-4-6`；`gemini-2.0-flash` → `gemini-3.1-flash-lite-preview`。
- options Claude 列表加入 `claude-opus-4-6 / claude-sonnet-4-6 / claude-haiku-4-5-20251001`；旧版标 `deprecated`。
- 智谱列表修正 `GLM 4.7 Flash` 错误标签为 `GLM-4-Flash`；更新 GLM-5 系列命名；DeepSeek 标注 `V3.2`。
- UI 下拉对 `deprecated:true` 自动追加「（已弃用）」后缀。

**Permissions**
- `manifest.json` `host_permissions` 从 `<all_urls>` 收窄为具体 API 端点白名单；`content_scripts.matches` 保留 `<all_urls>` 以便在任意页面注入翻译。

**UI / A11y**
- 翻译弹窗 `role="dialog" aria-modal="true"`；浮窗与选区快捷按钮添加 `aria-label`。
- 弹窗流式速度改为可配置 `popupStreamSpeedMs`（默认 14ms）。

**Misc**
- 新增 `CONSTANTS` 常量块（缓存 TTL、视口边距、观察器上限等）。
- `isTargetLanguage` 支持繁中（`\u3400-\u4dbf`）；<50 字符短文本使用更宽松的 20% 阈值。
- PROVIDER_SPECS URL 暂未抽离为独立 ENDPOINTS 对象（见后续重构）。
- 流式 API 支持为未来工作项，本版本暂未实现（风险过高）。

## v26.3.5 (2026-03-05)

- Migrated core codebase to the v6 line and updated extension version to `26.3.5`.
- Added provider registry split (`providers.js`) and unified provider/model UI structure.
- Added official-style provider/model icon support in popup and settings selectors.
- YouTube bilingual subtitles changed to manual player-button toggle only (removed forced auto-enable behavior).
- Removed extra blue left marker/visual noise from bilingual web translation display.
- Standardized release package naming to `zdftranslate-<version>.zip`.

## v2.1.18 (2026-02-17)

- Version bump to 2.1.18.

## v2.1.17 (2026-02-17)

- Version bump to 2.1.17.

## v2.1.16 (2026-02-16)

- Pre-release code review and cleanup for store submission.
- Fixed duplicated `insertReplaceMode` definition in `src/content.js` to keep behavior deterministic.
- Removed debug console output in `src/options.js`.
- Packaging consistency fix: `package.py` now packs all files in `src/` recursively (including `assets/`) to avoid missing web-accessible resources.
- Release artifact naming standardized to `zdf-translate-vX.Y.Z.zip`.

## v2.1.0 (2026-02-16)

- Release-candidate cleanup for Chrome Web Store submission.
- Settings page refined:
  - Unified quick service selection flow (show only selected service config).
  - Removed excluded-sites module from UI.
  - Updated labels/copy in “一些开关选项”.
  - Reworked section icons to neutral SVG style; adjusted distinction where requested.
  - Custom service title style aligned with regular labels; removed leading icon.
- Floating actions fixed:
  - Dynamic relayout for PDF/Image/Translate buttons to avoid blank gaps when a middle button is disabled.
- YouTube behavior:
  - Auto bilingual subtitles wording updated; internal CC+English strategy retained.
- Code hygiene:
  - Reduced stale UI references and improved button icon rendering consistency during loading/toggle.

## v1.9.11 (2026-02-16)

- Added a new section **一些开关选项** for:
  - Auto-enable bilingual subtitles on YouTube
  - Floating image export button toggle
  - Floating PDF export button toggle
  - Plugin watermark toggle
- Floating image/PDF icon visibility now follows user settings.
- Floating toggle does **not** affect selection-popup image export.
- Refined YouTube subtitle behavior: when auto bilingual subtitle is enabled, built-in strategy now auto tries CC + English caption track (no extra switch).
- Redesigned settings flow: added **快速配置服务下拉**; only selected service settings are shown.
- Moved export watermark setting into switch options and renamed text to **显示插件水印**.
- Removed the **排除网站** module from settings UI.

