# Receipt capture v3: staged rollout

This increment adds native document capture (VisionKit on iOS, ML Kit document
scanner on Android), structured-row arithmetic warnings, and stale-request
guards. Gallery images continue through the existing OCR path unchanged.

No new cloud calls or local LLM are introduced. Multi-pass enhancement,
RecognizeDocumentsRequest, PaddleOCR benchmarking, and richer item extraction
remain future work, not implemented features.

The scanner dependency is pinned to 2.0.4. Keep Expo/RN and expo-modules-core at
their existing versions for this branch. A native rebuild is required; Expo Go
and a JS-only update cannot install the scanner module.

## Before merging

Run npm ci, npm run typecheck, npm run test:parser, and
npx expo export --platform ios. Run the unsigned iOS workflow against this
branch before merging. Local JS export/prebuild do not prove Swift compilation.

## Device acceptance tests

- Scan one angled receipt; adjust crop, retake, then complete the scan.
- Cancel native scanning: existing draft must remain unchanged.
- Cancel OCR then start another scan: the previous response must not replace it.
- On iOS, submitting multiple pages must show a one-receipt warning, not silently
  discard additional pages (the native page limit is Android-only).
- Import a payment screenshot; confirm this still bypasses document capture.
- For a 460-yen receipt with cash 510 and change 50, verify no arithmetic warning.
- A conflicting total must show a warning and remain editable, never auto-save.
- Save two confirmed expenses; restart the app and verify both remain in history.

Android scanner resources may need an initial Google Play services download.
Test first-run and later offline use separately. Unsupported devices can still
import images from the photo library.

Arithmetic is only corroborating evidence. Tax-inclusive/exclusive conventions,
rounding, coupons, and split tenders can invalidate simple equations. The app
does not replace a missing OCR amount with a calculated amount, and it does not
treat multiple OCR passes as independent evidence of accuracy.
