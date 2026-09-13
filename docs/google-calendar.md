# Google Calendar — private inspection test live; scheduled GHL view pending release

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
