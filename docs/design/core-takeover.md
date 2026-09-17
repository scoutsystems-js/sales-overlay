# Core Takeover login motion

Scout plays this sequence once after a fresh password sign-in. It never plays for an already-valid session.

The sequence opens with the visor HUD, lets its geometry calibrate, fades that field away, brings the central reactor into focus, spins it twice, shows `SCOUT SYSTEMS LOADED`, and expands the reactor into the loaded dashboard. The final interface is the payoff, so all animation disappears when it finishes.

The overlay is optional presentation only. Click or any key skips it immediately. Reduced-motion users get no moving HUD. The dashboard still renders underneath, readiness waiting is capped, and a watchdog removes the overlay if anything fails.

All timing lives in `WELCOME_TIMING` in `backend/web/dashboard.html`.
