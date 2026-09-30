# 1.0.3 Verification

Verified on 2026-10-01. Physical iOS acceptance and App Store submission remain pending.

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

- `node --test scripts/test-mobile-environment.mjs`: 24 passed.
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
