# Four additional mobile board skins — 2026-10-25

> The first design below is superseded by the reference-driven revision at the end.

Implemented in the shared Android/iOS endgame-training frontend:

| ID | Name | Appearance |
| --- | --- | --- |
| xuan-paper | 宣纸墨韵 | Warm paper, vermilion red, ink black |
| sea-salt | 海盐蓝 | Pale blue, white pieces, navy black side |
| chestnut | 栗木雅棕 | Chestnut frame, warm wood, ivory pieces |
| dusk-jade | 暮山深青 | Deep teal board, pale jade pieces |

Existing default and skin IDs remain unchanged. New entries support complete sets, mixed board/piece selection, and custom river text. The settings count is now derived from the catalog. The 64 new PNG files total 938,680 bytes; no runtime dependency was added.

Validation:

- `npm run test:ui -- skinCatalog.test.tsx moveFeedback.test.tsx`: 6 tests passed. Covers stored IDs, invalid settings fallback, asset dimensions/completeness, all 90 target positions, flipped boards, mixed skins and existing move feedback.
- `npm run build`: TypeScript and Vite passed; existing large-chunk warning remains.
- `node --check scripts/prepare-endgame-training-skins.mjs`: passed. Full importer was not run because it rewrites externally imported skin assets.
- Real shared Board rendered in Chromium and Playwright WebKit, each at 375/390/430/820px for all four skins: 32 layouts passed. Each layout checks 32 pieces, normal/flipped red-rook taps, custom river asset and horizontal overflow.
- Visually inspected the four-set comparison. Screenshots and raw results: `artifacts/skins-20261025/`; comparison `four-skins-preview.png`.

These are browser-engine checks, not Android/iOS native simulator acceptance. No new APK/IPA, device install, server deployment or App Store submission was performed in this task. Unrelated working-tree changes were preserved.


## Reference-driven revision

User feedback: initial frames were too large and the appearance did not match the three supplied examples. Reworked the first three unshipped sets while preserving their IDs:

- `xuan-paper`: **竹韵雅木**, light wood with bamboo-colored rims and cream calligraphic pieces.
- `sea-salt`: **经典竞技**, plain warm board with red/black disks and white characters.
- `chestnut`: **原木黑白**, fine-grained wood with ivory/red and black/white calligraphic pieces.
- `dusk-jade`: retained as an additional dark option.

Removed inset frames and heavy board shadow; enlarged pieces to fit the calibrated 124px grid spacing. Geometry now comes from `authoredSkinGeometry.json`, shared by raster generation and runtime touch, animation, previews, and export. Old skin geometries remain untouched. Moving and dragging sprites use the same enlarged size. Calligraphic glyphs are rasterized using the installed macOS Kai font; no system font files are distributed.

Final checks: 6 focused UI tests passed; TypeScript/Vite build passed (existing chunk warning); Chromium and WebKit each passed 16 layouts at 375/390/430/820px, including flipped raw-coordinate taps and no horizontal overflow. Supplemental Chromium motion checks passed 8 combinations of phone/tablet, flip, and study enlargement. The final four sets total 3,936,420 PNG bytes.

Comparison: `artifacts/skins-20261025/reference-three-skins.png`. Previous artwork retained as a comparison in `artifacts/skins-20261025/v1/`. Browser-engine verification only; no native package, phone operation or publication this turn.


## Raised-piece refinement

Further user request: increase piece depth. Updated only the authored PNG generator and generated assets. Pieces now have an 8px sidewall at source resolution, rounded bevel lighting, domed face shading, softened contact shadow, and a subtle engraved-glyph highlight. The 120×120 sprite dimensions, board geometry and runtime styles are unchanged.

Verified all three principal sets have fully transparent outermost pixels (no clipped shadow or rim); the 3 focused skin tests and 16 Chromium phone/tablet layouts passed. Inspect `artifacts/skins-20261025/piece-depth-detail.png` and `reference-three-skins-depth.png`. Effects are prerendered; no runtime filters or new render loop. Local only; no device install or publication.


## Shallow board depth

User approved subtle board depth while retaining the narrow border. Added a baked 8px bottom sidewall (about 2–3px on phones), thin bevel, upper-left lighting and a restrained static CSS shadow. Surface grain is clipped to the playing face. No changes to the grid geometry, board aspect ratio, hit targets or piece sprites.

Validation: 3 focused skin tests and TypeScript/Vite build passed; Chromium and WebKit each passed 16 phone/tablet layouts including flipped coordinate taps, custom river variants and overflow checks. Visually checked the actual 390px board. Final comparison: `artifacts/skins-20261025/raised-board-and-pieces.png`. This is local verification, not a native install or release.


## Boundary and line refinement

Refined the board silhouette with larger smooth corners, a lighter 6px sidewall and subtler bevel shading. Reduced grain contrast. The grid perimeter is now one continuous 3.6px stroke, internal lines 2.8px, river boundaries 3px, palace diagonals 2.6px, and pawn/cannon markers 2.4px with rounded tips/joins. All sizes are source-image pixels at 1120×1240. Shared intersections and all piece assets remain unchanged.

The 3 focused tests, TypeScript/Vite build, and 16 Chromium layouts passed. Visually inspected the 390px result. This revision does not change layout/CSS or interaction code; WebKit's previous layout validation remains prior evidence rather than a new run. Latest preview: `artifacts/skins-20261025/refined-board-lines.png`. No packaging or device operation.


## Piece-to-board margins matching the marked reference

Moved the authored grid inward to columns 80…1040 and rows 84…1156 at source resolution. Piece size, thin bevel and outer board dimensions remain unchanged. This leaves visible wood around the outer files and the top/bottom piece ranks, including the bottom rank marked by the user. Shared geometry updates artwork, hit mapping, previews and exports together.

Validation: 3 focused skin tests and build passed. Chromium and WebKit each passed 16 layouts at 375/390/430/820px: normal/flipped taps, at least 19 source pixels of full-sprite edge clearance, selected top-edge piece remaining inside the board, custom river text and no overflow. Tests wait for the deselection transition before measuring the next orientation. Actual 390px preview: `artifacts/skins-20261025/reference-piece-margins.png`. Local only; no device installation.


## Smaller, optically centered glyphs

Applied the user's successive requests to all three main skins. Bamboo and porcelain Kai glyphs reduced from 90px to 84px (6.7%), baseline 85→82; competitive white glyphs 76→72px (5.3%), baseline 81→79. Changes are inside the sprites; outer disc diameter, depth, grid and margins stay fixed. The extra dark set is unchanged.

The 3 focused tests, 16 Chromium layouts and frontend build passed. Twenty saved board/dark-set PNG hashes match the previous revision. Inspected the enlarged glyphs. Previews: `artifacts/skins-20261025/piece-airy-type.png` and `three-skins-airy-type.png`. Local only, no install.


## 1.0.7 integration and final reference colors

Final user clarification: each of the three skins must follow its own attached board reference, not a common color. Sampled unobstructed patches from the three newly attached images for palette selection. The first has honey wood with a warmer lower area; the second has a flat golden-yellow field; the third has a lighter golden wood field. Original piece styles, reduced glyph sizes, approved inset margins and thin edges are retained. These are generated artwork matched by reference colors, not pixel-identical copies of the photographed interfaces.

Integrated in the existing 1.0.7 shared client catalog. `VITE_APP_ENV=production npm run build -- --outDir ../../artifacts/skins-20261025/v1.0.7-production-web --emptyOutDir` passed. The output includes all 64 authored PNGs with hashes identical to source and all catalog names in the application bundle. Version and SHA-256 manifest: `artifacts/skins-20261025/v1.0.7-skins-manifest.json`. Both native clients consume this shared frontend through their existing Capacitor webDir pipeline. Native project assets, version codes, devices and App Store state were not modified.

Final validation: 6 focused UI tests; 16 Chromium and 16 WebKit layouts with flipped raw-coordinate taps, full-sprite margin checks, lifted-edge checks, custom river text and horizontal overflow assertions. Build retains the existing large-chunk warning. Latest preview: `artifacts/skins-20261025/v1.0.7-three-reference-palettes.png`.

The working tree contains unrelated ongoing manual-library/import changes; these were preserved. This frontend build is not a newly signed APK/IPA and does not certify those unrelated flows.


## Fixed pieces, clearer board pairing and touch videos

User confirmed the three piece styles. All 42 piece PNG SHA-256 hashes were locked before the board revision and remain identical. Revised only board palette/organic grain and river-label contrast; no typography, size, sidewall or piece color changes. Production frontend output rebuilt and all 64 skin PNGs reverified against source; version remains 1.0.7.

Checks: 6 focused tests passed; 16 Chromium layouts passed plus four phone layouts at 3× screenshot resolution. High-resolution stills (`v107-*-hd.png`) avoid relying only on the downscaled three-column comparison. Existing native simulators were inventoried, but no native apps/devices were modified.

`record-skin-previews.cjs` records four explicit browser-engine previews (Chromium/WebKit × phone/tablet). Each switches the three skins, taps red b0c2 and black b9c7, flips and resets, then checks landscape. The demonstration page is separate from the application UI, reusing the actual Board and skin CSS. An initial recording-page width constraint caused portrait cropping; corrected its grid minimum width, added explicit portrait bounds assertions, and re-recorded. These videos are not native Android/iOS simulator or physical-device acceptance.

Latest artifacts: `v107-fixed-pieces-clear-boards-hd.png`, `videos/manifest.json` and four MP4 files under `artifacts/skins-20261025/`. No APK/IPA or App Store action this turn.
