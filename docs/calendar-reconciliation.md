# Calendar reconciliation foundation — built locally, not live

Calendar is Scout's durable source record that an appointment was booked. This block adds the backend and data foundation only. It does not add a manager dashboard, scheduled-count UI, show rate, booked-to-close funnel, cancellation/no-show labels, or any new customer-facing metric.

## Saved record

Each observed Google event occurrence has one row keyed by the Scout account, primary Google calendar ID and a hashed occurrence identity. A one-time event uses Google's event ID. A recurring occurrence uses the recurring event ID plus the canonical original start instant, so an equivalent time-zone representation or replacement Google event ID cannot create a second appointment. Google's current event ID is still retained in each revision. Distinct source states append to an immutable minimal history while the latest state stays on the appointment row.

The only saved event-derived values are:

- scheduled start, scheduled end, time zone and the scheduled calendar date in that time zone;
- Google's source update time and whether the observed event still met Scout's measured SLR booking rule;
- the numeric Zoom meeting ID when it can be derived exactly from the event location;
- the calendar title as an unverified label when it contains no link or credential-like value;
- one exact non-self attendee email when exactly one is present.

Raw descriptions, locations, meeting links, organizer/creator data, attendee names or arrays, conference payloads, extended properties, full Google event payloads and provider credentials never enter the appointment tables. A title containing a web/app link or credential-like value is omitted in full. The existing encrypted connection credentials remain in their existing server-only connection table.

Disconnecting removes the connection and stops new reads. It does not delete the appointment ledger or history. Those rows cascade only when the Scout account is deleted.

## Source coverage

The read-only source audit found a stable event ID on every event in two live windows. Every recurring event had `recurringEventId` and `originalStartTime`. All 61 measured SLR appointments carried a numeric Zoom join ID in `location`; none carried it in a conference entry point. Every candidate had at least one valid non-self attendee email. This is why the implementation reads the event ID before the private inspection response removes it and derives the Zoom ID from `location` only. See [calendar-reconciliation-source-audit.md](calendar-reconciliation-source-audit.md). The audit describes provider shape; it does not invent older appointment history.

The background read runs after Fathom and Zoom in the existing two-hour workflow. Durable capture covers a rolling 90 calendar days before today through 90 days after today in the primary calendar's time zone; the separate on-demand inspection remains unchanged at no more than 14 inclusive calendar days. The provider request keeps its UTC boundary cushion, while timed events are stored only when their date in the primary calendar's time zone is within that 90-day range. Pagination is complete up to the provider safety cap, and a response that exceeds the cap fails before any event state is written. The initial run captures only events in that bounded window, so it does not invent older history. Once an appointment is seen, its durable record and every distinct captured minimal revision remain after it falls outside the window. Edits outside the 90-day lookback are not observed unless the event later re-enters the window, except that an explicit deleted, cancelled or all-day form returned for a known occurrence can append a `not_qualifying` source observation while retaining the prior minimal schedule. That observation is not an outcome or attendance claim. Mere absence from the bounded response is never converted into a state or result.

## Reconciliation

Every scheduled run retries all stored appointments against all existing call records for that Scout account, so a recording arriving after the appointment can still match. This database-only pass covers connected and disconnected ledger owners and still runs when Google's read fails. It never reads Google for a disconnected account. A candidate requires exact equality on:

1. `calendar_appointments.user_id = fathom_calls.user_id` (the owning closer);
2. the numeric Zoom meeting ID; and
3. the call timestamp's calendar date in that appointment revision's saved time zone.

The date rule is local to reconciliation. It does not change Scout's existing Eastern Time metric windows or attribution rules.

Scout accepts a match only when it is unique in both directions. Two calls fitting one appointment, two appointments fitting one call, or different saved revisions fitting different calls all remain unmatched. The read-only audit found 2,431 call rows across Fathom and Zoom with an ID and date: 203 exact unique keys were eligible and 2,228 rows were under ambiguous reused-ID keys. Provider is deliberately not part of the key, so a Fathom/Zoom collision stays ambiguous.

Historical revisions participate only in this conservative exact uniqueness check. Calendar title and attendee email never participate. Reconciliation writes only `matched_call_id` and `matched_at` on the appointment. It never creates or merges a prospect and never writes any call, outcome, follow-up, call-kind, grade, coaching, attribution or metric field.

## Release state

This work is local only. No production migration, data write, push or deploy has run. The original architecture review found two blockers; local verification and bounded integration review found no remaining blocker. The release is still unapproved and not live. The additive migration is `backend/migrations/20260913210000_calendar_appointment_ledger.sql`; it enables RLS, removes browser-role access and grants the existing server role the server-only write path. The recording function keeps its public name and signature but runs as `SECURITY INVOKER`; `PUBLIC`, `anon` and `authenticated` cannot execute it, while `service_role` retains the existing table grants and its configured `BYPASSRLS` role attribute. It has been executed only in an isolated in-memory Postgres test, which verifies the real function, constraints, history, generation rejection, RLS and grants. The focused Calendar suite passes 86/86 and the full backend suite passes 2,920/2,920. The migration must be applied before any code deploy. The privacy and in-product data-use copy ship with the writer so retained history is described before the first scheduled write.

After deployment, verify the exact commit, run the secret-protected calendar sync after the recording syncs, and inspect only aggregate row/revision/match/error counts. Do not print stored titles or attendee emails in release evidence.

## Changed files

Backend and scheduling:

- [`.github/workflows/fathom-sync.yml`](../.github/workflows/fathom-sync.yml)
- [`backend/lib/calendar-appointments.js`](../backend/lib/calendar-appointments.js)
- [`backend/lib/calendar-service.js`](../backend/lib/calendar-service.js)
- [`backend/lib/google-calendar.js`](../backend/lib/google-calendar.js)
- [`backend/migrations/20260913210000_calendar_appointment_ledger.sql`](../backend/migrations/20260913210000_calendar_appointment_ledger.sql)
- [`backend/package.json`](../backend/package.json)
- [`backend/package-lock.json`](../backend/package-lock.json)
- [`backend/routes/calendar.js`](../backend/routes/calendar.js)

Tests:

- [`backend/test/calendar-appointment-migration.test.js`](../backend/test/calendar-appointment-migration.test.js)
- [`backend/test/calendar-appointment-storage.test.js`](../backend/test/calendar-appointment-storage.test.js)
- [`backend/test/calendar-appointments.test.js`](../backend/test/calendar-appointments.test.js)
- [`backend/test/calendar-routes.test.js`](../backend/test/calendar-routes.test.js)
- [`backend/test/calendar-service.test.js`](../backend/test/calendar-service.test.js)
- [`backend/test/calendar-history-window-disclosure.test.js`](../backend/test/calendar-history-window-disclosure.test.js)
- [`backend/test/calendar-ui.test.js`](../backend/test/calendar-ui.test.js)
- [`backend/test/google-calendar.test.js`](../backend/test/google-calendar.test.js)
- [`backend/test/helpers/calendar-store.js`](../backend/test/helpers/calendar-store.js)

Customer copy:

- [`backend/web/js/scout-calendar-account.js`](../backend/web/js/scout-calendar-account.js)
- [`backend/web/js/scout-calendar.js`](../backend/web/js/scout-calendar.js)
- [`backend/web/calendar.html`](../backend/web/calendar.html)
- [`backend/web/privacy.html`](../backend/web/privacy.html)

Build and technical records:

- [`BUILD-LIST.md`](../BUILD-LIST.md)
- [`docs/calendar-reconciliation-source-audit.md`](calendar-reconciliation-source-audit.md)
- [`docs/calendar-reconciliation.md`](calendar-reconciliation.md)
- [`docs/google-calendar.md`](google-calendar.md)
