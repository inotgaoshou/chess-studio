# Authored board skins

Six skin definitions for the shared endgame-training client. Palette definitions live in `palettes.json`; `../generate-authored-skins.cjs` renders the vectors to PNG ahead of time (except the preserved source-artwork set described below). No SVG filters, drawing code or extra font is loaded at runtime.

The competitive pieces use the existing Noto Sans SC font at `apps/desktop/src-tauri/resources/fonts/NotoSansSC-VF.ttf`, licensed under the SIL Open Font License in the adjacent `OFL.txt`. The calligraphic pieces and river labels are rasterized using the installed macOS Kaiti SC font (or a locally supplied TTF via `SKIN_CALLIGRAPHY_FONT`). No system font file is copied into the app. The generated PNGs contain rasterized glyphs, not embedded font files.

Run from the repository root with Playwright and Chrome available:

```sh
PLAYWRIGHT_MODULE_PATH=/absolute/path/to/playwright node scripts/generate-authored-skins.cjs
PLAYWRIGHT_MODULE_PATH=/absolute/path/to/playwright node scripts/test-authored-skins-ui.cjs
SKIN_TEST_BROWSER=webkit PLAYWRIGHT_MODULE_PATH=/absolute/path/to/playwright node scripts/test-authored-skins-ui.cjs
```

Each set contains a 1120×1240 board, blank-river variant, and fourteen transparent 120×120 pieces. Grid intersections share `src/authoredSkinGeometry.json` with touch mapping, animation, previews and exports; legacy skin geometry is unchanged. Keep the geometry and asset integrity tests passing when regenerating. `prepare-endgame-training-skins.mjs` preserves these authored directories and merges their catalog entries when importing legacy skins.


For board-only refinements, append `--boards-only` to preserve every piece PNG byte-for-byte. Procedural grain is rasterized by Chromium at generation time. The app only loads PNGs.

For piece-only refinements, append `--pieces-only` to preserve both board PNGs byte-for-byte. This includes the matching high-resolution pieces and separate ground shadow. It cannot be combined with `--boards-only`.

`record-skin-previews.cjs` records the real Board component in a dedicated demonstration page, with touch input, two known legal horse moves, skin switching, flipping and landscape layout checks. Output names explicitly identify Chromium/WebKit, not native Android/iOS. It is not a replacement for native package acceptance. `SKIN_SCREENSHOT_SCALE=3 SKIN_TEST_WIDTH=390` on the layout script produces high-resolution phone stills.


## Source artwork replacement (latest)

`xuan-paper` now copies the user's existing `皮肤/默认` board and all fourteen piece PNGs unchanged. SHA-256 values and provenance are recorded in `reference-assets.json`. The generator validates these bytes and skips regenerating this set. Its calibrated grid lives in `referenceSkinGeometry.json`; the other three sets retain `authoredSkinGeometry.json`.

This original bitmap board preserves its river lettering and therefore advertises `supportsCustomRiverText:false`. The previous generated blank-river image is not selected. The default skin and all saved skin IDs remain unchanged. This is a closer source-artwork version, **not a claim of pixel-identical reproduction**: the supplied screenshot has different frame proportions, background and lighting. Exact screenshot assets are still required to verify 100% equivalence.

## Two timber sets (v1.1.1)

| ID | Name | Board | Pieces |
| --- | --- | --- | --- |
| `golden-timber` | 金木雅韵 | Golden figured wood | Grey ivory discs with a rounded rim and red/black inset ring |
| `ivory-timber` | 暖木素韵 | Reference honey wood, double frame and original river calligraphy | User-supplied wood discs |

Both sets use `src/defaultSkinGeometry.json`, shared unchanged with 清新竹韵. They support complete sets, independent board/piece mixing, preference persistence and custom river text. Other skins retain their geometry and assets. The default skin is unchanged.

Generate either set independently:

```sh
PLAYWRIGHT_MODULE_PATH=/absolute/path/to/playwright node scripts/generate-authored-skins.cjs --skin golden-timber
PLAYWRIGHT_MODULE_PATH=/absolute/path/to/playwright node scripts/generate-authored-skins.cjs --skin ivory-timber
```

Each set contains two 1120×1240 boards, fourteen 120px pieces, fourteen 240px pieces under `retina/`, and a 1216×1336 `board-depth.png` and a separate `piece-shadow.png` (120px for golden ivory, 150px for source wood, anchored to the same 120px disc origin). Live rendering, settings preview and PNG export use the same material and shadow. Cast shadows are not baked into the pieces. Sidewall colors follow the chosen piece set even when mixed with a different board.

Golden wood is generated deterministically by `golden-timber-material.cjs`, and its ivory pieces by `golden-ivory-piece.cjs`. The ivory faces now carry a thin inset ring matching the red/black lettering, with a restrained lower-edge highlight; the physical outer bevel and sidewall stay neutral. The latest user reference supersedes the earlier smooth-board request. `ivory-timber` now derives its grain, double frame and river calligraphy from the preserved `xuan-paper/board.png`. `reference-warm-board.cjs` resamples its grid onto the unchanged default touch geometry, and applies a small calibrated RGB correction (14 clean wood patches have median absolute channel differences of 1/255 against the supplied reference). The blank river interpolates the entire lettering band from adjacent clean wood, avoiding glyph-shaped repair ghosts. The original source file is validated by SHA-256 and never overwritten. The internal `ivory-timber` ID stays stable.

Wood pieces come from the supplied `天天象棋木棋子原.zip`. Unchanged originals are under `golden-timber-pieces-source/`; hashes and provenance are in `golden-timber-pieces-source.json`. `normalize-wood-piece.cjs` removes transparent-black floor shadow while preserving opaque lettering and warm antialiased edges. It scales without stretching and aligns the face with the renderer's anchor. Only normalized images ship in the App. The wooden face is enlarged within its existing square without changing hit targets. The separate shadow retains the source contact silhouette under antialiased edges, with enough transparent extent to preserve its full lower-right tail. A selected piece still uses the existing detached ground shadow, and moving/captured pieces use a light dynamic cast shadow.

Both board sets now use joined left/bottom wooden side faces and a single short contact shadow. The previous offset rectangular shadow stack looked like displaced copies of the board, so it was removed. `timber-board-depth.cjs` rasterizes the continuous side geometry and shadow, with a transparent cutout over the entire face; the overlay never duplicates the grid or tints the wood. Its 48px padding is mapped identically in live boards, settings previews and Canvas export. Depth scales directly with board size, including landscape and mini boards. Timber PNG exports include 72px transparent padding on each edge (1264×1384 total), so neither the board thickness nor shadow is clipped; other board exports retain their original dimensions.

Run `test-golden-timber-ui.cjs` with `TEST_SKIN=golden-timber` and `TEST_SKIN=ivory-timber`, each with Chromium and `SKIN_TEST_BROWSER=webkit`. It covers 7 viewports, real settings and persistence, geometry, gestures, river text, mixing and PNG exports. Evidence is under `artifacts/skins-1.1.1-<skin>/`. `TEST_SKIN` also selects either set in `test-piece-lift-ui.cjs` and `test-variation-board-ui.cjs`; `VARIATION_MOBILE_ONLY=1` keeps the latter within this task's mobile/tablet scope.


## Selectable catalog and large preview (v1.1.1)

`retired-skins.json` removes the screenshot's old 6 青铜, 9 曜石 and 14 暮山深青 from the selectable catalog. Original assets are retained. Both generation paths filter this list, so regeneration/import cannot re-add them. Reading a saved retired ID falls back to the default only for that board/piece preference; other valid settings remain intact.

The remaining sets have shared continuous labels 1–13 in complete sets and both mixing grids; 默认清新竹韵 is unnumbered. Golden timber and warm wood are 12 and 13. Each board/piece choice has its own pressed state and check mark. The current mixed selection is named above the library and can be opened with the preview button or thumbnail; each mixing panel has its own preview button too.

`SkinPreviewDialog.tsx` renders the actual shared Board at a fitted large size, with 32 pieces, custom river settings, lift selection and local flipping. Preview never moves pieces, writes manuals or starts analysis. It closes through Close, Done, Escape or the backdrop, restores scroll/focus, and uses a portal so an enclosing menu cannot crop it. Safari open buttons explicitly receive focus before opening. The modal fits phone/tablet and uses a side layout in landscape/wide screens.

Run `scripts/test-skin-settings-ui.cjs` with Chromium and WebKit. It verifies the real settings page at seven viewports, continuous numbering, removed entries, independently persisted choices, large preview, selection/flip, closing/focus and retired-preference fallback. Evidence is in `docs/acceptance/assets/skin-settings-1.1.1/`.
