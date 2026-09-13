(function () {
  'use strict';
  var loadEpoch = 0;
  var params = new URLSearchParams(location.search);
  var teamId = params.get('team');
  var currentSelection = null;
  var previewKey = null;
  var escape = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var el = function (id) { return document.getElementById(id); };
  async function request(path, method, body) {
    var response = await fetch('/calendar' + path, { method: method || 'GET', headers: Object.assign({ 'Content-Type': 'application/json' }, window.ScoutAuth.authHeader()),
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
    // Provider navigation only; never allow an arbitrary response URL.
    if (new URL(result.url).origin !== 'https://accounts.google.com') throw new Error('Could not start Google sign-in.');
    location.assign(result.url);
  }
  async function loadChoices() {
    var data = await request('/calendars');
    el('calendarChoices').innerHTML = '<legend>Choose the calendar GHL books into</legend>' + data.calendars.map(function (calendar) {
      return '<label class="calendar-choice"><input type="radio" name="calendar" required value="' + escape(calendar.id) + '"' + (currentSelection && currentSelection.calendar && currentSelection.calendar.id === calendar.id ? ' checked' : '') + '><span>' + escape(calendar.name) + ' · ' + escape(calendar.time_zone) + '</span></label>';
    }).join('');
    el('calendarTitleFilter').value = currentSelection && currentSelection.title_contains || '';
    resetPreview();
    el('calendarSelection').hidden = !data.calendars.length;
    if (!data.calendars.length) notice('No readable calendars were found in this Google account.');
  }
  async function loadConnection() {
    var status = await request('/status');
    currentSelection = status;
    var host = el('calendarConnection');
    el('calendarSelection').hidden = true;
    if (!status.configured) {
      el('calendarSetup').open = true;
      host.textContent = 'Google Calendar setup is not enabled yet.';
      el('calendarResults').textContent = 'Calendar counts will appear after setup is complete.';
      return false;
    }
    if (status.can_view_team && !el('calendarScope').querySelector('[value="team"]')) {
      el('calendarScope').insertAdjacentHTML('beforeend', '<option value="team">Team calls</option>');
      el('calendarScope').value = 'team';
    }
    if (!status.can_view_team) el('calendarBack').href = '/dashboard';
    el('calendarSetup').open = !status.connected || !status.calendar;
    host.innerHTML = '<p>' + (status.calendar ? escape(status.calendar.name) + ' · Title contains “' + escape(status.title_contains) + '”' : status.connected ? 'Connected. Choose your calendar and sales appointment titles.' : 'Read-only access. Scout will not create or change events.') + '</p>'
      + '<div class="calendar-actions"><button id="googleConnect" type="button">' + (status.connected ? 'Reconnect Google Calendar' : 'Connect Google Calendar') + '</button>'
      + (status.connected ? '<button id="googleChoose" type="button">Choose Calendar</button><button id="googleDisconnect" type="button">Disconnect</button>' : '') + '</div>';
    el('googleConnect').onclick = function () {
      if (status.connect_origin && status.connect_origin !== location.origin) {
        location.assign(new URL('/calendar.html', status.connect_origin).href); return;
      }
      action(this, connect);
    };
    if (status.connected) {
      el('googleChoose').onclick = function () { action(this, loadChoices); };
      el('googleDisconnect').onclick = function () {
        action(this, async function () {
          if (!await window.scoutConfirm({ title: 'Disconnect Google Calendar?', body: 'Scout will remove its saved calendar connection and snapshot. Your Google events and recorded calls stay unchanged.', confirmText: 'Disconnect' })) return;
          var result = await request('/connection', 'DELETE'); await loadConnection(); await loadSchedule();
          notice(result.revoked ? 'Google Calendar disconnected.' : 'Disconnected from Scout. Google did not confirm revocation; remove Scout’s access in your Google Account permissions too.');
        });
      };
      if (!status.calendar) await loadChoices();
    }
    return true;
  }
  function selectionValues() {
    var selected = el('calendarSelection').querySelector('input[name="calendar"]:checked');
    return { calendar_id: selected ? selected.value : '', title_contains: el('calendarTitleFilter').value.trim(),
      from: el('calendarFrom').value, to: el('calendarTo').value };
  }
  function resetPreview() {
    previewKey = null;
    el('calendarSave').disabled = true;
    el('calendarConfirmation').hidden = true;
    el('calendarConfirmed').checked = false;
    el('calendarPreview').textContent = '';
  }
  async function previewMatches() {
    var values = selectionValues();
    if (!values.calendar_id || !values.title_contains) { notice('Choose a calendar and enter the sales appointment title text.'); return; }
    resetPreview();
    var key = JSON.stringify(values);
    el('calendarPreview').textContent = 'Checking matching appointments…';
    var result;
    try { result = await request('/preview', 'POST', values); }
    catch (error) { if (JSON.stringify(selectionValues()) === key) el('calendarPreview').textContent = error.message; return; }
    if (JSON.stringify(selectionValues()) !== key) return;
    previewKey = key;
    el('calendarPreview').innerHTML = '<p class="calendar-note">Preview: ' + escape(values.from) + ' through ' + escape(values.to) + '</p>' + repHtml(Object.assign({}, result, { name: 'Matching appointments', state: 'ready' }));
    el('calendarPreview').querySelector('details').open = true;
    el('calendarConfirmation').hidden = false;
    el('calendarSave').disabled = false;
  }
  function stateText(rep) {
    if (rep.state === 'ready') return rep.count + ' scheduled call' + (rep.count === 1 ? '' : 's');
    if (rep.state === 'not_connected') return 'Calendar not connected';
    if (rep.state === 'setup_required') return 'Finish calendar setup';
    if (rep.reason === 'google_reconnect') return 'Reconnect Google Calendar';
    if (rep.reason === 'google_access_denied') return 'Calendar access needs attention';
    if (rep.state === 'connection_changed') return 'Calendar changed — refresh';
    return 'Calendar could not be refreshed';
  }
  function repHtml(rep) {
    var heading = '<span>' + escape(rep.name || 'My calls') + '</span><span>' + escape(stateText(rep)) + '</span>';
    if (rep.state !== 'ready') return '<div class="calendar-rep">' + heading + '</div>';
    var zone = rep.calendar.time_zone;
    var formatter = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    var rows = rep.appointments.map(function (appointment) {
      return '<li><time datetime="' + escape(appointment.start) + '">' + escape(formatter.format(new Date(appointment.start))) + '</time><span>' + escape(appointment.title) + '</span></li>';
    }).join('');
    return '<details class="calendar-rep"><summary>' + heading + '</summary><p class="calendar-note">' + escape(rep.calendar.name) + ' · ' + escape(zone)
      + (rep.last_sync_at ? ' · Updated ' + escape(new Date(rep.last_sync_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : '')
      + '</p>' + (rows ? '<ul class="calendar-appointments">' + rows + '</ul>' : '<p>No sales calls scheduled for these dates.</p>') + '</details>';
  }
  async function loadSchedule() {
    var epoch = ++loadEpoch;
    var query = new URLSearchParams({ from: el('calendarFrom').value, to: el('calendarTo').value });
    var team = el('calendarScope').value === 'team';
    if (team && teamId) query.set('team', teamId);
    el('calendarResults').textContent = 'Checking Google Calendar…';
    try {
      var data = await request((team ? '/team?' : '/schedule?') + query);
      if (epoch !== loadEpoch) return;
      el('calendarResults').innerHTML = (team ? '<h2>' + escape(data.team.label) + '</h2>' : '')
        + (team ? data.reps : [data]).map(repHtml).join('');
      if (team && !data.reps.length) el('calendarResults').textContent = 'No active team members.';
    } catch (error) { if (epoch === loadEpoch) el('calendarResults').textContent = error.message; }
  }
  async function boot() {
    if (!window.ScoutAuth.getSession()) { location.replace('/login'); return; }
    var today = new Date();
    var localDate = function (date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); };
    el('calendarFrom').value = localDate(today);
    var lastDay = new Date(today); lastDay.setDate(lastDay.getDate() + 6);
    el('calendarTo').value = localDate(lastDay);
    el('calendarRange').onsubmit = function (event) { event.preventDefault(); action(this.querySelector('button'), loadSchedule); };
    el('calendarRange').onchange = function () { resetPreview(); loadSchedule(); };
    el('calendarSelection').oninput = resetPreview;
    el('calendarFrom').oninput = resetPreview;
    el('calendarTo').oninput = resetPreview;
    el('calendarConfirmed').oninput = function (event) { event.stopPropagation(); };
    el('calendarPreviewButton').onclick = function () { action(this, previewMatches); };
    el('calendarSelection').onsubmit = function (event) {
      event.preventDefault();
      var values = selectionValues();
      if (previewKey !== JSON.stringify(values)) { notice('Preview these title matches before saving.'); return; }
      action(el('calendarSave'), async function () {
        await request('/selection', 'POST', { calendar_id: values.calendar_id, title_contains: values.title_contains, confirmed: el('calendarConfirmed').checked });
        notice('Sales calendar saved.'); await loadConnection(); await loadSchedule();
      });
    };
    if (params.has('connection')) notice(params.get('connection') === 'denied' ? 'Google Calendar was not connected.' : 'Google connection did not finish. Try connecting again and allow both calendar permissions.');
    if (params.has('connected')) notice('Google connected. Choose your sales calendar below.');
    try { if (await loadConnection()) await loadSchedule(); } catch (error) { notice(error.message); el('calendarResults').textContent = 'Calendar is unavailable right now.'; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
