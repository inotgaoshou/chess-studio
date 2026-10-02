# 1.0.3 Verification

Verified on 2026-10-02. Physical iOS workflow acceptance and App Store submission remain pending.

## Standards

Review found stale refresh-token persistence after organization changes and an
Android Keystore AES-GCM initialization error. Both were fixed. Authenticated
requests now bind to the original account, organization, environment and
session; stale responses cannot restore a logged-out session. Android generates
its encryption IV through Keystore. Java compilation passed; Android device
runtime verification is deferred with Android distribution.

## Spec

Review found late requests could retry as another account, results were queued
only after network failure, assignment drafts did not restore the board and
remaining solution, and reconnect did not submit while staying on the board.
These were fixed and covered by regression tests. Submission captures the
original account and move list, persists before sending, and retains the
original ownership after logout. Unowned legacy entries are retained without
submitting them as a different student.

## Checks

- `node --test scripts/test-mobile-environment.mjs scripts/test-mobile-practice-history.mjs`: 26 passed.
- `TEACHER_URL=http://127.0.0.1:1441 node scripts/test-mobile-teacher-ui.cjs`: passed responsive layout, batch publishing, search, retries and institution changes.
- `PRACTICE_URL=http://127.0.0.1:1441 node scripts/test-mobile-practice-ui.cjs`: passed phone/tablet navigation, practice, favorites, search, draft restoration and reconnect on the board.
- Production-environment mobile web/WASM build and iOS development signed build: passed. Build is `1.0.3 (10017)`, not the final review build.
- Embedded NNUE SHA-256 matches `7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e`; Pikafish GPL, NNUE license and build metadata are embedded.
- iOS workflow YAML and mobile build shell syntax checks: passed. Production workflow requires the matching annotated mobile tag and version/build values; its engine helper dependency is pinned to a published commit.
- Backend migration tests: 5 passed. Production row/file verification and repeated no-op apply passed.
- Live production API: teacher publishes to the named student, three valid solution submissions, teacher completion counts, idempotent resubmission and cross-institution/role denial passed. Review experience homework is separate from this completed API acceptance homework.

Mock UI regression and live HTTP evidence do not replace physical iPhone
offline/reconnect acceptance or the required 3–5 minute recording. No new
App Store screenshots, release tag, uploaded review build or review-submitted
status has yet been verified.

## Practice Follow-up

- Start the mock regression server with `VITE_APP_ENV=test` and
  `VITE_TEACHING_API_BASE=https://api-test.qixiapp.cn`; development otherwise
  defaults to the local gateway and cannot restore the mocked session.
- Phone (390x844) and tablet (1024x768) regressions cover daily start/retry,
  library solver return, unspaced Chinese category paths, category expansion,
  settings visibility, shared board/piece skins and persistence, repeated
  attempts after restart, favorites, mastered review and reconnect.
- Settings use the existing study skin controls. The settings page was hidden
  by its base display rule; its fixed scrolling layout is now enabled and
  secondary routes suppress the underlying account/solver pages.
- The production development-signed iOS package was rebuilt and installed in
  place on the connected iPhone 14, and app launch succeeded. Version remains
  1.0.3 (10017) for initial acceptance. No uninstall or data reset was run.
- Review passwords were rotated using the production password API. The review
  student has permanent VIP and receives a six-question killing assignment
  with short and multistep solutions; this homework is still pending.
- The platform has the 757-question continuous killing topic in both
  environments. The public ten-question topic remains the daily-plan source.
- Today's practice fixes its question order and session after the first start,
  and repeated starts return that snapshot. Selection is not adaptive and uses
  all eligible questions in the configured source order. UTC dates currently
  roll over at 08:00 China time.
- iPhone Mirroring reports iCloud is signed out. Device installation is
  verified; native UI acceptance and video are not yet verified.

## Calendar, Filters And Solver Controls

- Test and production are both running backend release
  `20261001T160028Z-c7636d9502fb`. Candidate/favorite SQL decoding, JSON snapshots,
  history aggregation and dashboard progress decoding are fixed in that release.
- `verify-mobile-practice-filters.mjs` compared 20 live selections per
  environment against database progress and metadata. Counts 5/10/20, previously
  attempted exclusions, empty pending mistakes, exact category, solver and
  learning modes passed. No homework answers were submitted by these checks.
- All 767 basic-killing and 757 continuous-killing topic rows have NULL
  difficulty in both environments. Explicit difficulty selections correctly
  return no matches; unavailable difficulty controls are now disabled rather
  than letting a selection appear usable.
- Calendar tests cover same-day session aggregation, empty dates and month/year
  boundaries. Phone/tablet UI checks cover seven dates and selected-day totals.
- Solver buttons use fixed 18px icons with centered text and consistent gaps.
  UI geometry assertions cover actions, favorites and previous/next controls.
  The return arrow is 44x44, with an accessible destination label.
- Platform library questions now create one-question practice sessions. The
  regression solves a question, opens its actual result and returns to the
  library. Local and homework questions have a separate single-question result.
- Revealed answers expose Chinese moves, step navigation and playback controls.
  The learning-mode regression verifies the request mode and moving the board
  forward/back through its solution.
- Production browser verification used a locally served production bundle at
  the API-allowed `https://localhost` origin. Actual review-student login,
  both topic details/counts, topic starts and custom ten-question training passed.
  Browser evidence is distinct from physical iPhone evidence.
- Rebuilt production `1.0.3 (10017)` passed codesign and embedded NNUE hash
  checks, was installed over the existing connected iPhone app, and launched.
  Final review recording, annotated release tag and ASC submission remain pending.
