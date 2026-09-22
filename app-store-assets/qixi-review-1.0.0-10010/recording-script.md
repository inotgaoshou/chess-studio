# Physical-device recording script

Record one continuous 2-4 minute video on a physical iPhone or iPad running the latest public iOS/iPadOS release. Turn on screen recording before launching Qixi. Do not show Apple IDs, notifications, email addresses, file-provider accounts, or other personal data.

## Before recording

1. Install Qixi 1.0.0 (10010) from TestFlight.
2. Delete any existing Qixi app data, reinstall the build, and place `qixi-review-sample.cbl` in a neutral folder in the Files app.
3. Enable Do Not Disturb, disable notification previews, and close unrelated apps.
4. Confirm the sample contains only material authorized for Apple review.
5. Confirm Wi-Fi access to ChessDB, then repeat the cloud fallback check once with networking unavailable.

## Recording sequence

| Time | Action | Evidence shown |
| --- | --- | --- |
| 00:00 | Show the Home Screen and launch Qixi | Physical-device launch and app identity |
| 00:10 | Pause briefly on the empty state | Clean-install behavior; no account or login |
| 00:20 | Tap `导入 CBL` and select `qixi-review-sample.cbl` | System Files picker and required setup |
| 00:40 | Open the imported library and select its first problem | Library and problem navigation |
| 01:00 | Select `只走解题方`, request one hint, and make the demonstrated move | Core training, legal-move validation, and hints |
| 01:30 | Tap `看答案`, then play the solution from the beginning | Solution and replay flow |
| 01:55 | Open `记录` | Practice progress is stored locally |
| 02:10 | Restart and briefly show `双方复现` and `自由实战` | Other offline modes |
| 02:30 | Start `云库对练` and make one legal move | ChessDB-backed mode and progress state |
| 02:50 | Open the About/settings panel | Version, app identity, and optional AI URL empty by default |
| 03:10 | Open the library delete confirmation, cancel once, then delete the sample library | Local-data deletion controls |
| 03:35 | Return to the empty state and stop recording | Successful cleanup and complete typical flow |

If ChessDB has no reply for the sample position, keep the resulting fallback message visible for several seconds. This is acceptable when the app remains responsive and permits manual continuation.

## Output

- Filename: `qixi-review-10010.mov`
- Keep the original screen-recording resolution and audio setting.
- Do not edit together simulator footage or add promotional slides.
- Review the entire video before submission and confirm that every label remains legible.
