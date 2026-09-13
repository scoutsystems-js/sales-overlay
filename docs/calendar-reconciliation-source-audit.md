# Calendar reconciliation source-shape audit

Checked 2026-09-13 at 19:17:02 UTC (15:17:02 America/New_York). This is a read-only audit. It made no code or database changes, did not refresh any token, did not use the application calendar route, and did not print or retain event payloads, links, attendee identities, credentials, or secrets.

## Method and evidence

Reviewed the Block 020–025 handoff, `docs/google-calendar.md`, and the aggregate Block 022 receipt at `~/Desktop/scan-reports/block-022-ghl-schedule/preflight.md` and `release-verification.md`.

Then read the existing Google connection directly through the provider with its already-valid encrypted access token, using the primary calendar only. The token was read from the existing server-side connection and decrypted in memory with the gitignored key file; it was not refreshed. Both bounded windows completed without a next page:

- 2026-09-13 through 2026-09-19, calendar-local time, America/New_York
- 2026-09-07 through 2026-09-12, calendar-local time, America/New_York

Stored call metadata was read through the existing read-only Supabase REST path. Counts below are current at the check time; calendar counts can change as events are edited or removed.

## Google event shape

| Calendar-local window | Events in window | Measured SLR candidates | Event IDs present / unique | `status` present | `updated` present | Recurring instances | Recurring instances with `originalStartTime` | Duplicate occurrence keys |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Sep 13–19 | 74 | 28 | 74 / 74 | 74 | 74 | 29 | 29 | 0 |
| Sep 7–12 | 92 | 33 | 92 / 92 | 92 | 92 | 25 | 25 | 0 |

Every measured SLR candidate had an attendee array, a syntactically valid attendee email, and at least one valid non-self attendee email: 28/28 and 33/33. Every candidate also had a numeric Zoom join ID in the event `location` field. Each window had one distinct numeric ID across all candidates, confirming that the meeting ID is reused and cannot identify an appointment by itself. No candidate exposed a conference entry point containing the ID.

The prior browser receipt recorded 75/29 and 92/33 for the same windows. The one-event change in the first window is ordinary live-calendar drift and is not treated as a source failure.

The provider supports the required durable identity shape: `id` for each event, plus `recurringEventId` and `originalStartTime` for recurring instances. The current client requests `recurringEventId` but omits `originalStartTime` in its field list ([`backend/lib/google-calendar.js:240`](/Users/justinschmidt/.codex/worktrees/339e/sales-overlay/backend/lib/google-calendar.js:240)); its inspection response also intentionally drops the event ID and keeps only a recurrence boolean ([`backend/lib/google-calendar.js:122`](/Users/justinschmidt/.codex/worktrees/339e/sales-overlay/backend/lib/google-calendar.js:122)). A ledger must capture both identifiers before that redaction.

The live connection row has no saved calendar ID, time zone, snapshot, or event history. Therefore these reads prove current provider shape only. They do not prove identity continuity across later edits, cancellations, or reconnects; the ledger must establish that history going forward.

## Stored call shape

| Provider | Stored call rows | `meeting_id` present | `call_date` present and parseable |
|---|---:|---:|---:|
| Fathom | 1,912 | 1,903 | 1,912 |
| Zoom | 534 | 528 | 534 |
| Total | 2,446 | 2,431 | 2,446 |

Fathom derives the numeric meeting ID from the provider meeting URL ([`backend/routes/fathom.js:317`](/Users/justinschmidt/.codex/worktrees/339e/sales-overlay/backend/routes/fathom.js:317)). Zoom stores its numeric meeting ID from the recording object and retains the separate per-recording UUID ([`backend/lib/zoom-client.js:77`](/Users/justinschmidt/.codex/worktrees/339e/sales-overlay/backend/lib/zoom-client.js:77)). The stored closer owner is `fathom_calls.user_id`; provider recorder identity is not a safe substitute.

## Reconciliation uniqueness

The uniqueness calculation intentionally crosses providers. It groups by `(fathom_calls.user_id, meeting_id, calendar-local day)` and does **not** include provider. This treats a Fathom/Zoom collision as ambiguous, as required by the contract.

| Combined across Fathom + Zoom | Count |
|---|---:|
| Rows with both meeting ID and calendar day | 2,431 |
| Distinct owner + ID + day keys | 644 |
| Unique keys eligible for reconciliation | 203 keys / 203 rows |
| Ambiguous keys refused | 441 keys / 2,228 rows |

The provider-specific figures are only diagnostic: Fathom has 114 unique keys and 1,789 rows under ambiguous keys; Zoom has 92 unique keys and 436 rows under ambiguous keys. The combined figures above are the authoritative candidate counts because uniqueness must be checked across both providers together.

The ambiguity is expected from reused personal or recurring meeting IDs. The existing migration explicitly requires meeting ID plus date, never ID alone ([`backend/migrations/041_meeting_id.sql:1`](/Users/justinschmidt/.codex/worktrees/339e/sales-overlay/backend/migrations/041_meeting_id.sql:1)); the matching guard is covered by [`backend/test/meeting-id.test.js:44`](/Users/justinschmidt/.codex/worktrees/339e/sales-overlay/backend/test/meeting-id.test.js:44).

## Interpretation and limits

The live source supports a durable event ledger with owner, event ID, recurring occurrence identity, scheduled start/end, time zone, status, updated time, and state history. It also supports extracting the numeric Zoom ID from the GHL event location. Reconciliation must require one unique combined call key for the same closer, numeric meeting ID, and calendar-local day; all ambiguous or missing-key cases remain unreconciled.

No raw event or attendee data was saved by this audit. The current database has no calendar event ledger, and the current Google client does not request or preserve `originalStartTime`; those are the concrete implementation gaps. No production deployment or live product behavior was changed.
