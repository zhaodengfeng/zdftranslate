# Changelog

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

