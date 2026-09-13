# Google Calendar — private scheduled GHL appointments LIVE

## Block 024 — account restriction removed; LIVE

Released `607252388755404b6316619c2cd4a2afa3b52fe8`, Railway `1fa7a405-eca4-47b0-890a-650adbc8257b` SUCCESS. The hard-coded Scout-team eligibility check is removed. An existing connection can share counts from its current Scout profile with no email match, account switch, reconnect or token transfer. Explicit opt-in and current manager/access checks remain. The SLR event-source filter and SalesKick exclusion are unchanged. Focused tests 51/51; full suite 2,880/2,880; both deliberate access-control bypasses fail the HTTP guard. Six served artifacts match the release, deploy markers pass. Actual signed-in page: existing 29 appointments for September 13–19, sharing control available and unchecked. Josh can enable sharing there; no live positive shared count is claimed before that consent. Evidence: `~/Desktop/scan-reports/block-024-calendar-account/`.

## Block 023 — manager counts LIVE

Released `0344cb95a1b818212ce60f41ca90d73b7be7db0a` (implementation `3fd6c43`), Railway `b16d7184-f1e0-43f8-bad6-3beec46f3e96` SUCCESS. Latest design `da7f2a2` merged and preserved. Full integrated suite 2,877/2,877; six served artifacts byte-identical and artifact-specific markers pass. Actual signed-in manager page: 12 active SLR members, all Not connected, dates verified and current week restored. Original private connection still shows 29 appointments. Live positive sharing awaits Josh's account/opt-in step below. Evidence: `~/Desktop/scan-reports/block-023-manager-calendar/`.

My Team links to a separate Scheduled appointments view. It reads the same current GHL appointment computation as the private owner view, with a 14-day maximum and counts only. A missing connection, withheld sharing, unsupported team, or failed Google read never becomes zero. There is no attendance claim, first-booking ledger, title-derived follow-up flag, AI processing, or change to existing call metrics.

Sharing is explicitly off for existing connections. An active closer with an assigned manager, or a manager/admin heading their own board, can enable it on their private calendar page. Only their current manager and authorized Scout admins can request the count; no event details reach that response. Consent is bound to the manager scope and reset on reconnect. Access and consent are checked again after the Google read. The connection table remains server-only with RLS and no browser grants. Block 024 removes the former hard-coded SLR Scout-team gate; it does not change the measured SLR booking-source filter.

**Justin's correction, September 13 (Block 024):** the Google account chosen at Connect need not match the Scout email. The prior instruction to switch Scout accounts/reconnect is withdrawn. Josh keeps the existing connection on `josh@scoutsystems.io`; counts remain on that profile, not automatically transferred to another profile. He may opt into count sharing there. Other Google users still require test-user approval while the OAuth app is in Testing. This removes a Scout-team restriction, not Google's tester list or Scout's actual access controls.

Historical receipts below describe the earlier private-only version.

**Block 022 released:** `94bef3be7d6f5fc168df3b30e2c084dba9bcc2c6`, Railway `05a18e3e-26f6-4813-9bbb-331607ded02f` SUCCESS. Latest design `c472290` preserved; combined suite 2,854/2,854. Actual signed-in Josh view: 29 appointments September 13–19 and 33 September 7–12; zero SalesKick details in either. Date changes verified, current week restored, connection intact. Served dashboard/calendar HTML/calendar JS match the release byte-for-byte. Receipt: `~/Desktop/scan-reports/block-022-ghl-schedule/release-verification.md`. Pre-release notes below are historical; live manager sharing and first-booking metrics are not part of this release.

Released September 13, 2026 as `22884b96e7289b0152e997d63b78414e86c5a54d`; Railway deployment `b804381e-61a2-4bb4-b06b-421b5305969b` SUCCESS. Latest Observatory main `172b591` is preserved. Final integrated suite: 2,845/2,845. Served page/scripts/styles/privacy match the release byte-for-byte, unauthenticated inspection returns 401, and the existing signed-in Scout browser shows the new Account button. That release receipt predates live consent. Follow-up completed: `joshua@soberlivingriches.com` is on Google's test list, Josh successfully connected, and real primary-calendar reads across two date ranges established the narrow Sober Living Riches signature below. The live connection remains intact. Release evidence: `~/Desktop/scan-reports/block-021-calendar-connect/release-verification.md`.

Justin authorized Codex to build this directly on September 13, 2026. Google Calendar only; GHL appointments arrive on calendars that also contain personal and internal events. Their titles are normally prospect names, so title text is not used to classify them.

## Block 022 — measured Sober Living Riches schedule rule

This local, unshipped change follows Josh's successful private calendar connection. It shows a **current Scheduled GHL appointments** count and list, not every calendar event. On Josh's connected primary calendar, the measured Sober Living Riches signature is all five nonempty private keys — `calendarId`, `eventId`, `linkedCalendarId`, `userCalendarId`, and `userId` — plus a URL in the description whose parsed host is exactly `links.soberlivingriches.com`.

SalesKick always wins exclusion: an event with any known SalesKick key (`skCreatedAt`, `skManagedBookingId`, `skSubmissionId`, `skVersion`) or an `app.saleskick.com` URL is not shown, even when it carries the GHL-shaped keys. Cancelled, all-day, non-default Google event types, and events the connected user declined are also excluded. Nothing else is called non-sales; it is simply not included in this measured schedule.

The count means appointments currently on the calendar. It does **not** mean calls taken, first bookings, prospects, outcomes, or historical booked-call attribution. It does not derive a follow-up flag from an event title; Scout's recorded-call follow-up rules remain unchanged.

## What this version does

- My Account shows a short read-only/private-use disclosure and starts Google sign-in directly from **Connect Google Calendar**. A connected user gets **Manage Calendar**.
- After the callback, Scout automatically reads the connected user's primary calendar for today through six days ahead. The user may inspect any inclusive range up to 14 days.
- The page shows only current **Scheduled GHL appointments** under the measured Sober Living Riches rule above. Event details stay collapsed until the user opens one.
- The appointment view exposes an allowlisted set of details: title, description, location, status/type, start/end, organizer, creator, attendee identity/status, source title/host, conference provider, recurrence, timestamps, visibility, availability and extended-property key names.
- Provider links, meeting entry points, event identifiers, extended-property values and token-like values do not reach the page. Every displayed value is escaped.
- Event details are read on demand and returned only to the authenticated user whose encrypted Google connection is used. They are not saved to Scout's database, logged, sent to AI, shared with a manager, or used by coaching, grading or metrics.
- Disconnect deletes Scout's encrypted connection and attempts Google revocation. A response that was already in flight cannot redraw event details after disconnect.

The former title filter, calendar picker, preview/save form, scheduled-sales-call count, manager team route and My Team calendar entry are removed. There is no background sync, calendar history, bulk harvest, GHL API connection, recording match, webhook or model call.

## Test release and remaining live-user checks

Justin authorized wiring and releasing this private inspection flow so Josh can connect. The dedicated Google project, read-only consent scopes, web client and exact production callback are configured. Production variables are saved, and the additive migration is applied with RLS and browser access denied. This is a private, read-only schedule connection, not a historical sales-booking tracker.

1. Completed: Josh was added to the Google test list and personally authorized the connection. Never mint another user's Scout session.
2. Two real windows established the narrow Sober Living Riches signature used by Block 022; it must not be generalized to another team's GHL setup without measuring that team.
3. Completed: real date changes loaded the expected calendar windows. Live disconnect was deliberately not run so Josh's test connection remains intact; the fixture guard still protects that path.
4. Use the normal drain, integration, deployed-commit and served-marker checks before releasing Block 022.

## Google setup

Use the dedicated Scout Calendar Google Cloud project with the Calendar API and an OAuth **Web application** client. While the app remains in testing, each legitimate tester must be listed on the consent screen. Complete Google's publishing and verification requirements before general availability.

The registered redirect URI and `GOOGLE_CALENDAR_REDIRECT_URI` must be exactly:

```
https://www.scoutsystems.io/calendar/callback
```

Local testing may use `http://localhost:<port>/calendar/callback` with a separately registered redirect.

Server variables (never expose these in the browser or commit real values):

```
GOOGLE_CALENDAR_CLIENT_ID
GOOGLE_CALENDAR_CLIENT_SECRET
GOOGLE_CALENDAR_REDIRECT_URI
GOOGLE_CALENDAR_TOKEN_KEY
```

The token key is 32 cryptographically random bytes encoded as base64. Keep it stable in the approved secret store. Requested permissions are only `calendar.calendarlist.readonly` and `calendar.events.readonly`. OAuth state is random, browser-bound, hashed, expiring and one-use. Access and refresh tokens are encrypted with AES-256-GCM bound to the Scout user ID.

The existing additive migration remains unchanged. Both tables have RLS enabled, no browser policies, and no anon/authenticated table privileges. The inspection leaves `calendar_id`, `title_contains` and `snapshot` null; only the encrypted connection and OAuth state are stored. One live connection exists; no snapshots or title filters exist. Backend reads also filter by the authenticated Scout user. Deleting the auth user cascades both rows.

## Operational boundaries

- The primary calendar is identified by Google's `CalendarListEntry.primary` marker on every inspection. No setup form or saved calendar selection exists.
- A request covers at most 14 inclusive calendar days and at most two complete 250-item event pages. Exceeding either boundary refuses the inspection rather than returning a partial result.
- Calendar-local dates decide whether an event is inside the window. Recurring instances remain separate. The scheduled view excludes cancelled, all-day, non-default event types, and self-declined events before its count is formed.
- OAuth connect/disconnect and token refresh serialization follow the existing single-process deployment model. Database generation checks prevent a disconnected request from serving late event data. Multiple backend instances would need a cross-instance authorization lock before scaling this feature.
- Google Calendar remains independent of the one-active-recording-source rule.

## Verification

From `backend/`:

```
node --test test/google-calendar.test.js test/calendar-service.test.js test/calendar-routes.test.js test/calendar-ui.test.js
npm test
```

The focused tests execute the real HTTP and rendered UI paths: encrypted OAuth, single-use state, partial-consent and deactivated-user refusal, primary-calendar choice, short range/page caps, owner-only access, measured GHL/SalesKick source filtering, redaction/escaping, no event persistence, missing former publishing routes, one-click Account connection, malicious redirect refusal, disconnect races, and desktop/mobile layout. The fixtures protect the exact behavior; Josh's real connection supplied the Sober Living Riches source evidence.

Historical Block 021 verification on September 13, 2026: 27/27 focused tests and 2,842/2,842 full backend tests passed. Desktop and mobile fixture renders were inspected in `~/Desktop/scan-reports/block-021-calendar-connect/`; they prove layout only. The real GHL marker is established separately by Josh's connected calendar.

Reference documentation: [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [Calendar-list primary marker](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList), [Event resource](https://developers.google.com/workspace/calendar/api/v3/reference/events), [Event listing](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
