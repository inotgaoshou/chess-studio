# Qiyan 1.0.0 (10010) App Review Packet

This directory contains the material for responding to Apple's Guideline 2.1 information request.

## Files

- `apple-review-response.txt`: paste-ready English response for App Review Information Notes and the review message.
- `recording-script.md`: the required physical-device recording sequence.
- `submission-checklist.md`: verification and resubmission checklist, including the remaining manual gates.
- `verification-report.txt`: immutable facts from the completed local verification.
- `verify-review-packet.sh`: validates the submitted archive, CBL attachment, video attachment, and public support pages.

## Add the attachments

Place the final attachments in this directory with these names:

- `qiyan-review-sample.cbl`
- `qiyan-review-10010.mov`

Both attachments are intentionally ignored by Git because the recording may show local device content and the CBL must not be published without a separate rights review.

Then run:

`\`\`bash
./app-store-assets/qiyan-review-1.0.0-10010/verify-review-packet.sh
`\`\`

The script prints the SHA-256 of both attachments. Do not submit until every unchecked manual gate in `submission-checklist.md` is complete.
