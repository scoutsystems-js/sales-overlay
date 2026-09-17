# Core Takeover login motion

Scout plays this sequence once after a fresh password sign-in. It never plays for an already-valid session.

The sequence opens with the visor HUD, runs a scan across target locks, pulls those marks into the central aperture, fades the field away, and brings the compact reactor into focus. The reactor spins, shows `SCOUT SYSTEMS LOADED`, then expands into the live dashboard. The dark cover lifts with that expanding ring, so the product appears on the same beat as the animation.

The overlay is optional presentation only. Click or any key skips it immediately. Reduced-motion users get no moving HUD. Its timing never waits for dashboard data, and a watchdog removes it if anything fails.

All timing lives in `WELCOME_TIMING` in `backend/web/dashboard.html`.
