# Changelog

## v1.9.9 (2026-02-15)

- **Service Worker stability**: Hardened config save response handling and provider API-key validation to avoid opaque 401/empty errors.
- **DeepL fix**: Fixed `source_lang=undefined` request bug when using auto source language.
- **Options page usability**: Added timeout-safe remote model fetch helper and fallback paths to prevent setup page stalls.
- **Custom/OpenRouter compatibility**: Improved Anthropic/OpenAI-compatible model list parsing and fixed Zhipu model API auth header.
- **Popup consistency**: Added robust fallback when configured translation service no longer exists (e.g. removed custom service).
- **Capture reliability/performance**: Switched html2canvas to `allowTaint:false` + timeout to reduce CORS hard-fail and hanging image loads.
- **Config consistency**: Reset defaults now align to free default service (`libretranslate`).

## v1.8.21 (2026-02-14)

- **Save as Image**: Added "Save as Image" feature for exporting translations.
- **Improved UI**: Better floating button and popup layout.
- **Export Polish**: Added branding/watermark support for exported images.

## v1.5.7 (2026-02-11)

- Added **YouTube Dual Subtitles** (original + translated subtitle display)
- Improved subtitle segmentation and rendering stability
- Store release packaging cleanup
