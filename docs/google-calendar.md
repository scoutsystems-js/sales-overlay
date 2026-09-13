# Google Calendar — local implementation, not released

Justin authorized Codex to build this directly on September 13, 2026. Google Calendar only; appointments originate in GHL. He confirmed that calendars contain a mixture of sales, internal and personal events. Site design is owned by the separate Observatory workstream.

## What this version does

- My Account → Connections → Connect Google Calendar / Manage Calendar.
- My Team → Scheduled Calls, with the selected team passed through and resolved again on the server.
- A closer selects one readable Google calendar and enters a literal phrase used in sales appointment titles. Case is ignored; regex is not supported. A preview shows matches before the closer confirms sharing those matching titles and times with their manager. Editing the rule clears its preview.
- The page reads Google when opened, when dates/scope change, and when Refresh Calls is pressed. One appointment is enough. Each manager sees only their team, including themselves; inactive reps are omitted. Owners retain the existing server-resolved team rules.
- Dates refer to appointment start dates in each calendar's current time zone. Recurring instances are expanded; IDs deduplicate repeated instances. Cancelled, declined, all-day and non-appointment event types are excluded. Each complete read replaces one saved snapshot, so moved/cancelled events do not accumulate as duplicate rows.
- A failed, disconnected or unfinished connection has no count, not zero. Zero means a complete Google read found no matching appointments. Incomplete pagination fails rather than publishing a partial number.

This is a **current scheduled-appointments view**, not a historical booking ledger. It includes matching follow-ups; it does not claim they are first-booked prospects. No change to close rate, calls taken, grading, coaching, attendance or no-show logic. There is no background cron, webhook, GHL API connection, recording match, or new model call. A snapshot is the last successfully read date window, not a permanent appointment history. Past dates show Google's current surviving events, not how the calendar looked that day.

## Release gates — still open

1. Inspect one actual GHL appointment title/event with Justin. The title filter is a proposed deterministic setup control, not a proven GHL classifier. If sales calls lack a stable distinguishing title, or use multiple unrelated naming patterns, do not release this filter as accurate; resolve that from a real example first. Do not infer bookings from every event or from absent recordings.
2. Configure the Google OAuth app and test one legitimate user's connect → preview → select → count → reschedule/cancel → refresh → disconnect flow. No live Google connection has been tested. Do not mint another user's Scout session.
3. Apply the new schema to the intended environment before enabling the feature. The migration has only been executed in an isolated embedded PostgreSQL instance; local Supabase/Docker was unavailable. No live database change has occurred.
4. Bring in the current design release, review the combined diff, run final tests and the normal drain/deploy/commit-marker checks before any production push. This document grants no deployment authority.

## Google setup

Use a Scout-owned Google Cloud project dedicated to this integration, enable the Calendar API, and create an OAuth **Web application** client. Configure the consent screen and permitted test users before testing. Complete Google's publishing/verification requirements before general availability; test-mode authorization is not a production approval.

Registered redirect URI and `GOOGLE_CALENDAR_REDIRECT_URI` must be identical, e.g. `https://scoutsystems.io/calendar/callback`. Use the same host on which users sign in. The browser binding is host-only: if Scout is opened on an alternate host, Connect navigates to the configured host first; the user may need to sign in there. Local testing may use `http://localhost:<port>/calendar/callback` with a separately registered redirect.

Server variables (never expose these in the browser or commit real values):

```
GOOGLE_CALENDAR_CLIENT_ID
GOOGLE_CALENDAR_CLIENT_SECRET
GOOGLE_CALENDAR_REDIRECT_URI
GOOGLE_CALENDAR_TOKEN_KEY
```

The token key is 32 cryptographically random bytes encoded as base64. Keep it stable and backed up in the approved secret store. Changing it without migrating encrypted tokens requires reconnecting. Record secrets only in the gitignored canonical `API Keys.md` and the deployment secret store, not in tracked files or chat.

Requested permissions are limited to `calendar.calendarlist.readonly` and `calendar.events.readonly`. Both must be granted. OAuth uses a random browser-bound, hashed, expiring, one-use state. Access and refresh tokens are encrypted with AES-256-GCM bound to the Scout user ID. The two tables have RLS enabled, no browser policies, and revoked anon/authenticated table privileges. Backend reads/writes also filter by user. Deleting the auth user cascades these rows.

Disconnect deletes the local token and snapshot and attempts Google token revocation. If Google does not confirm revocation, the UI tells the user to remove access in Google Account permissions. Google revocation affects all grants in the Cloud project, which is why the integration should use a dedicated project.

## Operational boundaries

- One selected calendar and one title phrase per closer. A shared team-wide calendar needs a real, reliable rep-assignment rule before being treated as an individual's calendar.
- Date queries are capped at 93 days, Google pagination at 20 × 250 items, and manager scopes at 500 members. Caps refuse an incomplete measurement; they never quietly truncate a published count. Three Google reads run concurrently per team request.
- OAuth connect/disconnect and token refresh serialization follow the existing single-Railway-process deployment model. Database generation comparisons prevent a late schedule/token update from recreating a disconnected connection. Multiple backend instances require a cross-instance authorization lock before scaling this feature.
- Only matching appointment IDs, titles and start/end timestamps are saved. Descriptions and attendee lists are not persisted. Manager reads never receive OAuth tokens.
- No production inference, analytics or recording source is touched. Google Calendar is independent of the one-active-recording-source rule.

## Verification commands

From `backend/`:

```
node --test test/google-calendar.test.js test/calendar-service.test.js test/calendar-routes.test.js test/calendar-ui.test.js
npm test
```

The focused tests execute Google pagination/error handling, encryption, single-use OAuth, partial consent, deactivation, title filtering, preview/save agreement, cancellation/reschedule, timezone changes, disconnect races, the actual HTTP connect-to-count workflow, role/scope checks, and rendered desktop/mobile interactions. Access/scope guards were also tested with both removed gates and gates whose effects were ignored.

Reference documentation: [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [Event listing and recurrence](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
