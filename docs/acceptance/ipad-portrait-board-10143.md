# v1.1.0 (10143) iPad portrait board regression

During App Store screenshot capture, the 10142 simulator reproduced a missing research board at 1024px portrait width. The same screen displayed normally in landscape. Chromium reproduced the exact geometry: board width and height were both zero.

The portrait workspace used an auto grid row because the explicit fitted-board row rule stopped at 999px. The fitted board has no intrinsic size to expand that row. Extend the existing portrait rule to all phone/tablet widths; desktop selectors and landscape rules remain unchanged.

After the fix, the original 1024×1366 path measures approximately 760×841px. Chromium geometry checks pass at 320×568, 390×844, 430×932, 844×390, 820×1180, 1024×1366 and 1366×1024. The recorded before/after measurements are in `artifacts/releases/qixi-1.1.0-10143/ipad-portrait-layout.json`.

Validation: 264 UI tests, 67 unit tests and the production web build pass. Native WebKit simulator capture and distribution status are recorded in the final release manifest when complete. Build 10142 was uploaded but is superseded before submission by 10143.

Native iPad Pro 13-inch (M4), iOS 18.6, Release simulator build 10143 passes portrait display and local Pikafish candidate rendering. The full-resolution capture is `app-store-assets/qixi-review-1.1.0-10143/raw/ipad-analysis.png`. Xcode upload succeeded; App Store Connect submitted 10143 and reports waiting for review, with manual release retained. No 10143 physical iPhone installation is claimed.
