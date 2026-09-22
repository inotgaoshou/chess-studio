# Qixi 1.0.0 (10010) submission checklist

## Verified locally

- [x] Archive metadata identifies version 1.0.0, build 10010, and bundle ID cn.xiangqi.endgame.training.
- [x] The archive is an arm64 iPhone/iPad app with minimum iOS 14.
- [x] The archive contains no bundled CBL library or Pikafish executable/NNUE file.
- [x] The iOS cloud implementation sends the current FEN to https://www.chessdb.cn/chessdb.php.
- [x] The public support and privacy-policy URLs returned HTTP 200 on 2026-09-09.
- [x] The reply accurately states that no account, public UGC, advertising, analytics, payment, subscription, or in-app purchase is present.

## Attachment gates

- [x] Copy the selected review sample to qixi-review-sample.cbl.
- [x] Run the review-packet verifier and confirm the CBL contains at least one importable endgame problem.
- [x] Confirm in writing that the sample and every bundled visual/audio asset are original or used under a valid license.
- [x] Record the core flow on a physical device and prepare it as qixi-review-10010.mov.
- [x] Review the full recording for visible personal data; no credentials or account identifiers are displayed.
- [x] Run the review-packet verifier again and retain its SHA-256 output.

## Physical-device QA gates

- [x] Demonstrate build 10010 on a physical iPhone 14 running iOS 26.6.1.
- [ ] Test build 10010 on a physical iPad running the latest public iPadOS.
- [ ] Verify CBL import, problem selection, legal and illegal moves, hints, solution display, replay, record persistence, and library deletion.
- [ ] Verify portrait and landscape layouts without clipped or overlapping controls.
- [ ] Verify Cloud Practice on Wi-Fi and cellular data.
- [ ] Verify the app remains usable and exits its pending state when ChessDB is unavailable.

## App Store Connect gates

- [x] Record the physical device and OS version in apple-review-response.txt.
- [ ] Confirm App Privacy answers match the live privacy policy and the ChessDB FEN request.
- [x] Confirm the prepared App Store screenshot set includes both the imported-library and training experience.
- [ ] Paste the final response into App Review Information Notes and save it.
- [ ] Reply to Apple's review message with the same text and attach both files.
- [ ] Re-select build 10010, add it for review, and perform the final Submit for Review action.

Do not upload build 10011 unless physical-device QA finds a binary defect that requires a code change.
