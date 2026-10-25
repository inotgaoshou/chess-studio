# Authored board skins

Four original vector designs for the shared endgame-training client. Palette definitions live in `palettes.json`; `../generate-authored-skins.cjs` renders the vectors to PNG ahead of time. No SVG filters, drawing code or extra font is loaded at runtime.

The competitive pieces use the existing Noto Sans SC font at `apps/desktop/src-tauri/resources/fonts/NotoSansSC-VF.ttf`, licensed under the SIL Open Font License in the adjacent `OFL.txt`. The calligraphic pieces and river labels are rasterized using the installed macOS Kaiti SC font (or a locally supplied TTF via `SKIN_CALLIGRAPHY_FONT`). No system font file is copied into the app. The generated PNGs contain rasterized glyphs, not embedded font files.

Run from the repository root with Playwright and Chrome available:

```sh
PLAYWRIGHT_MODULE_PATH=/absolute/path/to/playwright node scripts/generate-authored-skins.cjs
PLAYWRIGHT_MODULE_PATH=/absolute/path/to/playwright node scripts/test-authored-skins-ui.cjs
SKIN_TEST_BROWSER=webkit PLAYWRIGHT_MODULE_PATH=/absolute/path/to/playwright node scripts/test-authored-skins-ui.cjs
```

Each set contains a 1120×1240 board, blank-river variant, and fourteen transparent 120×120 pieces. Grid intersections share `src/authoredSkinGeometry.json` with touch mapping, animation, previews and exports; legacy skin geometry is unchanged. Keep the geometry and asset integrity tests passing when regenerating. `prepare-endgame-training-skins.mjs` preserves these authored directories and merges their catalog entries when importing legacy skins.


For board-only refinements, append `--boards-only` to preserve every piece PNG byte-for-byte. Procedural grain is rasterized by Chromium at generation time. The app only loads PNGs.

`record-skin-previews.cjs` records the real Board component in a dedicated demonstration page, with touch input, two known legal horse moves, skin switching, flipping and landscape layout checks. Output names explicitly identify Chromium/WebKit, not native Android/iOS. It is not a replacement for native package acceptance. `SKIN_SCREENSHOT_SCALE=3 SKIN_TEST_WIDTH=390` on the layout script produces high-resolution phone stills.
