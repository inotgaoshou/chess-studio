# Screenshot Recognition Fixtures

`tiantian-black-bottom-board.jpg` is a privacy-sanitized mobile 天天象棋 board crop used for
offline screenshot-recognition regression checks.

| Property | Value |
| --- | --- |
| SHA-256 | `ed37e64c441b5d5094125f03ecdadb1ce7d9e339b102981807a8dba19b7de62a` |
| Pixel size | `1060 × 1120` |
| Viewpoint | Black at bottom |
| Visual evidence | White hollow source ring; white destination-piece base glow |
| Deliberate limits | Mobile wood skin; no avatar, nickname, clock, system bar, score, controls, or full application chrome |

The fixture is a crop of the board rectangle only. Do not replace it with a full user screenshot and
do not add a fixture that contains an account name, avatar, game record, clock, device status bar,
chat, or third-party controls.

## Regeneration

The source image is user-provided and intentionally not stored in the repository. A maintainer with
the authorized source can reproduce the crop locally with the following command, then must inspect
the output before committing it:

```sh
ffmpeg -y -i <authorized-source.jpg> \
  -vf crop=1060:1120:10:600 -map_metadata -1 -frames:v 1 -q:v 2 \
  apps/desktop/src-tauri/tests/fixtures/tiantian-black-bottom-board.jpg
shasum -a 256 apps/desktop/src-tauri/tests/fixtures/tiantian-black-bottom-board.jpg
```

The crop offsets apply to the authorized `1080 × 2400` portrait sample used for this fixture. The
output must be `1060 × 1120`, must contain only the board and pieces, and must have the checksum
above unless the fixture is deliberately updated together with this document and its tests.

## What this fixture proves

It exercises the mobile board boundary, black-at-bottom orientation, piece scale, a white hollow
ring, and a partial white base glow. It does **not** assert that the white marks alone identify a
move: tests must first require full-FEN one-ply matching against the current manual. White marks may
only order candidates that already match the recognized post-move placement.

For other skins, image scales, partial occlusion, compression artifacts, or incomplete markings,
add privacy-sanitized board-only fixtures and assert the safe fallback: no exact FEN match means no
automatic move preview and the user must select a legal source and destination manually.
