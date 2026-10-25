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


## Source artwork replacement (latest)

`xuan-paper` now copies the user's existing `皮肤/默认` board and all fourteen piece PNGs unchanged. SHA-256 values and provenance are recorded in `reference-assets.json`. The generator validates these bytes and skips regenerating this set. Its calibrated grid lives in `referenceSkinGeometry.json`; the other three sets retain `authoredSkinGeometry.json`.

This original bitmap board preserves its river lettering and therefore advertises `supportsCustomRiverText:false`. The previous generated blank-river image is not selected. The default skin and all saved skin IDs remain unchanged. This is a closer source-artwork version, **not a claim of pixel-identical reproduction**: the supplied screenshot has different frame proportions, background and lighting. Exact screenshot assets are still required to verify 100% equivalence.
