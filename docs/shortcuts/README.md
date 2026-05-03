# RepOS iOS Shortcuts

Build instructions and operational runbooks for the iOS Shortcuts that interact with the RepOS API. v1 ships one shortcut.

## Index

| Shortcut | Purpose | Trigger | Doc |
|---|---|---|---|
| RepOS Daily Weight Sync | Reads the most-recent Apple Health Body Mass sample and POSTs it to `/api/health/weight` | Personal Automation — Time of Day (default 07:30 daily) **or** Health · Body Mass Updated (iOS 17+) | [`health-weight-sync.md`](./health-weight-sync.md) |

## Why text instructions instead of a `.shortcut` bundle

`.shortcut` files are signed with iCloud keys belonging to the device that authored them. There is no supported way to generate that binary off-device. Each user builds their copy locally following the recipe; takes about 10 minutes the first time.

When the project ships a published `.shortcut` later (v2), it'll live alongside this directory and the build doc will become a "build this yourself OR import the signed bundle" choice.

## Conventions used in the build docs

- Step format: `Step N: [Action name from Shortcuts app]`, then `Field: Value` lines, then a `Why:` rationale.
- "Magic variable" = the output of a previous step that you reference by tapping it into a field.
- Token format used in all examples: `<16-hex-prefix>.<64-hex-secret>`. See [`health-weight-sync.md` §1.1](./health-weight-sync.md#11-mint-the-bearer-token) for how to mint one.

## Related references

- API contract: `api/src/routes/weight.ts`, `api/src/middleware/auth.ts`, `api/src/routes/tokens.ts`
- Product spec: `Engineering Handoff.md` §2 (request shape), §6 (auth), §9 (Shortcut spec)
- Deployment: `PASSDOWN.md`
