(function () {
  'use strict';
  window.ScoutCalendarAccount = {
    mount: async function (host) {
      if (!host) return;
      try {
        var response = await fetch('/calendar/status', { headers: window.ScoutAuth.authHeader() });
        if (!response.ok) throw new Error('unavailable');
        var status = await response.json();
        host.innerHTML = '<div class="conn-row"><div class="conn-left">Google Calendar</div><div class="conn-right"><a class="btn-fathom-secondary" href="/calendar.html">'
          + (status.connected ? 'Manage Calendar' : 'Connect Google Calendar') + '</a></div></div>';
      } catch (_) { host.innerHTML = '<p>Calendar status unavailable. <a href="/calendar.html">Open Calendar</a></p>'; }
    },
  };
})();
