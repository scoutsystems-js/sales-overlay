# Google Calendar — private inspection test live

Released September 13, 2026 as `22884b96e7289b0152e997d63b78414e86c5a54d`; Railway deployment `b804381e-61a2-4bb4-b06b-421b5305969b` SUCCESS. Latest Observatory main `172b591` is preserved. Final integrated suite: 2,845/2,845. Served page/scripts/styles/privacy match the release byte-for-byte, unauthenticated inspection returns 401, and the existing signed-in Scout browser shows the new Account button. No Google consent or real-event inspection has happened. Follow-up: Justin confirmed `joshua@soberlivingriches.com`; it is now saved on Google's test list, verified in the console. Josh should restart Connect Google Calendar and personally authorize. Release evidence: `~/Desktop/scan-reports/block-021-calendar-connect/release-verification.md`.

Justin authorized Codex to build this directly on September 13, 2026. Google Calendar only; GHL appointments arrive on calendars that also contain personal and internal events. Their titles are normally prospect names, so this version deliberately does not classify or count sales calls.

## What this version does

- My Account shows a short read-only/private-use disclosure and starts Google sign-in directly from **Connect Google Calendar**. A connected user gets **Manage Calendar**.
- After the callback, Scout automatically reads the connected user's primary calendar for today through six days ahead. The user may inspect any inclusive range up to 14 days.
- The page calls every row a **calendar event** and explicitly says the total is not a sales-call count. Event details stay collapsed until the user opens one.
- The inspection exposes an allowlisted set of details useful for finding a reliable GHL marker: title, description, location, status/type, start/end, organizer, creator, attendee identity/status, source title/host, conference provider, recurrence, timestamps, visibility, availability and extended-property key names.
- Provider links, meeting entry points, event identifiers, extended-property values and token-like values do not reach the page. Every displayed value is escaped.
- Event details are read on demand and returned only to the authenticated user whose encrypted Google connection is used. They are not saved to Scout's database, logged, sent to AI, shared with a manager, or used by coaching, grading or metrics.
- Disconnect deletes Scout's encrypted connection and attempts Google revocation. A response that was already in flight cannot redraw event details after disconnect.

The former title filter, calendar picker, preview/save form, scheduled-sales-call count, manager team route and My Team calendar entry are removed. There is no background sync, calendar history, bulk harvest, GHL API connection, recording match, webhook or model call.

## Test release and remaining live-user checks

Justin authorized wiring and releasing this private inspection flow so Josh can connect. The dedicated Google project, read-only consent scopes, web client and exact production callback are configured. Production variables are saved, and the additive migration is applied with both tables empty and browser access denied. This is test-ready infrastructure, not a verified real Google connection or a sales-booking tracker.

1. A legitimate user must be added to the Google app's test users and personally authorize the connection. Never mint another user's Scout session.
2. Inspect real GHL and non-GHL events in that user's private view. Record which Google fields actually distinguish the source before designing any sales-appointment rule.
3. Verify connect → automatic primary-calendar inspection → date change → disconnect with real events. No fixture is evidence that a GHL marker exists.
4. Use the normal drain, integration, deployed-commit and served-marker checks to release the connection button. The real-user checks above follow that test release; they still gate any claim that real calendar reading or sales-appointment identification works.

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

The existing additive migration remains unchanged. Both tables have RLS enabled, no browser policies, and no anon/authenticated table privileges. The inspection leaves `calendar_id`, `title_contains` and `snapshot` null; only the encrypted connection and OAuth state are stored. Backend reads also filter by the authenticated Scout user. Deleting the auth user cascades both rows.

## Operational boundaries

- The primary calendar is identified by Google's `CalendarListEntry.primary` marker on every inspection. No setup form or saved calendar selection exists.
- A request covers at most 14 inclusive calendar days and at most two complete 250-item event pages. Exceeding either boundary refuses the inspection rather than returning a partial result.
- Calendar-local dates decide whether an event is inside the window. Recurring instances remain separate. Cancelled events are omitted; mixed normal, all-day and nonstandard event types remain visible because this is an inspection, not a classifier.
- OAuth connect/disconnect and token refresh serialization follow the existing single-process deployment model. Database generation checks prevent a disconnected request from serving late event data. Multiple backend instances would need a cross-instance authorization lock before scaling this feature.
- Google Calendar remains independent of the one-active-recording-source rule.

## Verification

From `backend/`:

```
node --test test/google-calendar.test.js test/calendar-service.test.js test/calendar-routes.test.js test/calendar-ui.test.js
npm test
```

The focused tests execute the real HTTP and rendered UI paths: encrypted OAuth, single-use state, partial-consent and deactivated-user refusal, primary-calendar choice, short range/page caps, owner-only access, mixed-event metadata, redaction/escaping, no event persistence, missing former publishing routes, one-click Account connection, malicious redirect refusal, disconnect races, and desktop/mobile layout. All Google event responses remain fixtures until the legitimate real-user check.

Local verification on September 13, 2026: 27/27 focused tests and 2,842/2,842 full backend tests passed. Desktop and mobile fixture renders were inspected in `~/Desktop/scan-reports/block-021-calendar-connect/`; those labeled samples prove layout and mixed-event presentation only, not the presence of a real GHL marker.

Reference documentation: [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [Calendar-list primary marker](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList), [Event resource](https://developers.google.com/workspace/calendar/api/v3/reference/events), [Event listing](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
