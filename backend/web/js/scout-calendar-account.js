(function () {
  'use strict';

  async function startConnect(host, button, status, navigate) {
    button.disabled = true;
    var notice = host.querySelector('[data-calendar-notice]');
    notice.textContent = '';
    try {
      if (status.connect_origin && status.connect_origin !== location.origin) {
        navigate(new URL('/calendar.html', status.connect_origin).href);
        return;
      }
      var response = await fetch('/calendar/connect', { method: 'POST', headers: window.ScoutAuth.authHeader() });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not start Google sign-in.');
      var destination = new URL(result.url);
      if (destination.origin !== 'https://accounts.google.com') throw new Error('Could not start Google sign-in.');
      navigate(destination.href);
    } catch (error) {
      notice.textContent = error.message || 'Could not start Google sign-in.';
      button.disabled = false;
    }
  }

  window.ScoutCalendarAccount = {
    mount: async function (host, navigate) {
      if (!host) return;
      var go = navigate || function (url) { location.assign(url); };
      try {
        var response = await fetch('/calendar/status', { headers: window.ScoutAuth.authHeader() });
        if (!response.ok) throw new Error('unavailable');
        var status = await response.json();
        if (status.connected) {
          host.innerHTML = '<div class="conn-row"><div class="conn-left">Google Calendar</div><div class="conn-right"><a class="btn-fathom-secondary" href="/calendar.html">Manage Calendar</a></div></div>';
          return;
        }
        host.innerHTML = '<div class="conn-row"><div class="conn-left"><div>Google Calendar</div>'
          + '<p class="meta">Read-only. Calendar details stay private to you and are not saved. <a href="/privacy.html">Privacy</a></p>'
          + '<p class="meta" role="status" data-calendar-notice></p></div><div class="conn-right">'
          + '<button class="btn-fathom-secondary" type="button" data-calendar-connect>Connect Google Calendar</button></div></div>';
        var button = host.querySelector('[data-calendar-connect]');
        button.onclick = function () { startConnect(host, button, status, go); };
      } catch (_) {
        host.innerHTML = '<p>Calendar status unavailable. <a href="/calendar.html">Open Calendar</a></p>';
      }
    },
  };
})();
