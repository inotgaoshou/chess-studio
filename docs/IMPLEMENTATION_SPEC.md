# MVP Implementation Spec

## Product boundary

- Desktop-first application for Windows, macOS, and Linux.
- Tauri 2 + React/TypeScript client with Rust domain modules.
- Core chess records and local engine analysis only; no screen recognition, third-party board control, or automatic clicking.
- Third-party attributions and license details are maintained separately in project notices.

## Required capabilities

- Parse and emit Xiangqi FEN and ICCS moves; validate legal moves, check, and flying generals.
- Store a UUID move tree with variations, mainline selection, comments, ordering, and tombstone deletion.
- Import/export PGN with ICCS or Chinese notation, RAV variations, comments, custom FEN, BOM and legacy Chinese encoding fallback.
- Launch user-selected UCI/UCCI engines and support fixed time, fixed depth, fixed nodes, infinite search, MultiPV, forced alternatives, stop, and cleanup.
- Run Pikafish as red or black with fixed move time, immediate move and optional ponder behavior.
- Persist games, move nodes, engine metadata, analysis cache structure, and an operation outbox in local SQLite.
- Restore the most recently edited local game and current position after restart.
- Provide Rust/Axum account and synchronization endpoints backed by MySQL 8.0.
- Hash passwords, issue JWTs, make operation pushes idempotent, and pull changes by a monotonic cursor.
- Expose a desktop workflow for document open/save, board editing, clipboard exchange, branch ordering, engine analysis/play, move history, and manual synchronization.

## Acceptance checks

- Rust workspace tests pass.
- React production build and Tauri/server compilation pass.
- At 1080x720 the board, controls, and FEN input are visible without horizontal overflow.
- The frontend renders all 32 starting pieces and reports no browser console errors.
