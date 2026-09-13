(function () {
  'use strict';
  var loadEpoch = 0;
  var params = new URLSearchParams(location.search);
  var escape = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
  }); };
  var el = function (id) { return document.getElementById(id); };

  async function request(path, method, body) {
    var response = await fetch('/calendar' + path, { method: method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, window.ScoutAuth.authHeader()),
      ...(body ? { body: JSON.stringify(body) } : {}) });
    var data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Calendar could not be loaded. Try again.');
    return data;
  }
  function notice(message) { el('calendarNotice').textContent = message; }
  async function action(button, work) {
    button.disabled = true;
    try { await work(); } catch (error) { notice(error.message); }
    finally { button.disabled = false; }
  }
  async function connect() {
    var result = await request('/connect', 'POST');
    if (new URL(result.url).origin !== 'https://accounts.google.com') throw new Error('Could not start Google sign-in.');
    location.assign(result.url);
  }

  function personText(person) {
    if (!person) return '';
    var identity = person.display_name || person.email || 'Not provided';
    var parts = [identity];
    if (person.display_name && person.email) parts.push(person.email);
    if (person.self) parts.push('you');
    if (person.response_status) parts.push(person.response_status);
    if (person.organizer) parts.push('organizer');
    return parts.join(' · ');
  }
  function detailRow(label, value, long) {
    if (value == null || value === '') return '';
    return '<div class="calendar-detail"><dt>' + escape(label) + '</dt><dd' + (long ? ' class="calendar-long"' : '') + '>' + escape(value) + '</dd></div>';
  }
  function eventTime(event, zone) {
    if (event.all_day) return escape(event.start) + ' · all day';
    var formatter = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return escape(formatter.format(new Date(event.start)));
  }
  function eventHtml(event, zone) {
    var attendees = (event.attendees || []).map(personText).filter(Boolean);
    var source = event.source ? [event.source.title, event.source.host].filter(Boolean).join(' · ') : '';
    var conference = event.conference ? [event.conference.name, event.conference.type].filter(Boolean).join(' · ') : '';
    var keys = event.extended_property_keys;
    var privateKeys = keys && keys.private && keys.private.length ? 'Private: ' + keys.private.join(', ') : '';
    var sharedKeys = keys && keys.shared && keys.shared.length ? 'Shared: ' + keys.shared.join(', ') : '';
    var properties = [privateKeys, sharedKeys].filter(Boolean).join(' · ');
    var details = detailRow('Status', event.status)
      + detailRow('Event type', event.event_type)
      + detailRow('Starts', event.start)
      + detailRow('Ends', event.end)
      + detailRow('Description', event.description, true)
      + detailRow('Location', event.location, true)
      + detailRow('Organizer', personText(event.organizer))
      + detailRow('Creator', personText(event.creator))
      + detailRow('Attendees', attendees.join('\n'), true)
      + detailRow('Source', source)
      + detailRow('Conference', conference)
      + detailRow('Extended data keys', properties, true)
      + detailRow('Visibility', event.visibility)
      + detailRow('Availability', event.transparency)
      + detailRow('Created', event.created)
      + detailRow('Updated', event.updated)
      + detailRow('Recurring', event.recurring ? 'Yes' : 'No');
    return '<details class="calendar-event"><summary><span>' + escape(event.title || '(No title)') + '</span><time datetime="' + escape(event.start) + '">' + eventTime(event, zone)
      + '</time></summary><dl>' + details + '</dl></details>';
  }

  async function loadInspection() {
    var epoch = ++loadEpoch;
    var query = new URLSearchParams({ from: el('calendarFrom').value, to: el('calendarTo').value });
    el('calendarResults').textContent = 'Reading your primary Google Calendar…';
    try {
      var data = await request('/inspection?' + query);
      if (epoch !== loadEpoch) return;
      var heading = '<div class="calendar-result-head"><div><h2>' + escape(data.calendar.name) + '</h2><p class="calendar-note">'
        + escape(data.from) + ' through ' + escape(data.to) + ' · ' + escape(data.calendar.time_zone) + '</p></div><p>'
        + escape(data.event_count) + ' calendar event' + (data.event_count === 1 ? '' : 's') + ' found</p></div>';
      var boundary = '<p class="calendar-boundary">This is not a sales-call count. Mixed personal, internal, and appointment events are shown only so you can identify reliable GHL details.</p>';
      var events = data.events.map(function (event) { return eventHtml(event, data.calendar.time_zone); }).join('');
      el('calendarResults').innerHTML = heading + boundary + (events || '<p>No events are on your primary calendar for these dates.</p>');
    } catch (error) {
      if (epoch === loadEpoch) el('calendarResults').textContent = error.message;
    }
  }

  async function loadConnection() {
    // Connection changes invalidate any event response already in flight.
    ++loadEpoch;
    var status = await request('/status');
    var host = el('calendarConnection');
    el('calendarRange').hidden = true;
    if (!status.configured) {
      host.textContent = 'Google Calendar setup is not enabled yet.';
      el('calendarResults').textContent = 'Calendar inspection will be available after setup is complete.';
      return false;
    }
    host.innerHTML = '<p>' + (status.connected
      ? 'Connected. Event details are read only when you open this page and are not saved.'
      : 'Not connected. Review the private data-use note above before continuing.') + '</p>'
      + '<div class="calendar-actions"><button id="googleConnect" type="button">'
      + (status.connected ? 'Reconnect Google Calendar' : 'Connect Google Calendar') + '</button>'
      + (status.connected ? '<button id="googleDisconnect" type="button">Disconnect</button>' : '') + '</div>';
    el('googleConnect').onclick = function () {
      if (status.connect_origin && status.connect_origin !== location.origin) {
        location.assign(new URL('/calendar.html', status.connect_origin).href);
        return;
      }
      action(this, connect);
    };
    if (!status.connected) {
      el('calendarResults').textContent = 'Connect Google Calendar to inspect events.';
      return false;
    }
    el('calendarRange').hidden = false;
    el('googleDisconnect').onclick = function () {
      action(this, async function () {
        if (!await window.scoutConfirm({ title: 'Disconnect Google Calendar?',
          body: 'Scout will remove its saved Google connection. Your calendar events and recorded calls stay unchanged.', confirmText: 'Disconnect' })) return;
        ++loadEpoch;
        el('calendarResults').textContent = 'Disconnecting Google Calendar…';
        var result = await request('/connection', 'DELETE');
        await loadConnection();
        notice(result.revoked ? 'Google Calendar disconnected.'
          : 'Disconnected from Scout. Google did not confirm revocation; remove Scout’s access in your Google Account permissions too.');
      });
    };
    return true;
  }

  async function boot() {
    if (!window.ScoutAuth.getSession()) { location.replace('/login'); return; }
    var today = new Date();
    var localDate = function (date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); };
    el('calendarFrom').value = localDate(today);
    var lastDay = new Date(today);
    lastDay.setDate(lastDay.getDate() + 6);
    el('calendarTo').value = localDate(lastDay);
    el('calendarRange').onsubmit = function (event) { event.preventDefault(); action(this.querySelector('button'), loadInspection); };
    if (params.has('connection')) notice(params.get('connection') === 'denied'
      ? 'Google Calendar was not connected.' : 'Google connection did not finish. Try connecting again and allow both read-only permissions.');
    if (params.has('connected')) notice('Google Calendar connected. Scout is reading your primary calendar below.');
    try { if (await loadConnection()) await loadInspection(); }
    catch (error) { notice(error.message); el('calendarResults').textContent = 'Calendar is unavailable right now.'; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
