(function () {
  'use strict';
  var epoch = 0;
  var el = function (id) { return document.getElementById(id); };
  var selectedTeam = new URLSearchParams(location.search).get('team') || '';
  var labels = { not_connected: 'Not connected', not_sharing: 'Not shared', unavailable: 'Temporarily unavailable', unsupported: 'Not available for this team' };
  async function request(url) {
    var response = await fetch(url, { headers: window.ScoutAuth.authHeader() });
    var data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load scheduled appointments. Try again.');
    return data;
  }
  function clearCounts() {
    ++epoch;
    el('teamCalendarResults').textContent = 'Refresh counts for these dates and this team.';
  }
  function showCounts(data) {
    var host = el('teamCalendarResults');
    host.replaceChildren();
    var heading = document.createElement('h2');
    heading.textContent = data.team_label || 'Your team';
    host.appendChild(heading);
    var dates = document.createElement('p');
    dates.className = 'calendar-note';
    dates.textContent = data.from + ' through ' + data.to + ' · each closer’s calendar time zone';
    host.appendChild(dates);
    if (!data.members.length) {
      var empty = document.createElement('p');
      empty.textContent = 'No active closers on this team.';
      host.appendChild(empty);
      return;
    }
    var list = document.createElement('dl');
    list.className = 'calendar-team-list';
    data.members.forEach(function (member) {
      var row = document.createElement('div');
      var name = document.createElement('dt');
      var value = document.createElement('dd');
      row.className = 'calendar-team-row';
      name.textContent = member.name;
      var measured = member.status === 'ready' && Number.isInteger(member.count) && member.count >= 0;
      value.textContent = measured ? String(member.count) : labels[member.status] || labels.unavailable;
      if (measured) value.className = 'calendar-team-count';
      row.append(name, value);
      list.appendChild(row);
    });
    host.appendChild(list);
  }
  async function refresh() {
    var current = ++epoch;
    var query = new URLSearchParams({from: el('teamCalendarFrom').value, to: el('teamCalendarTo').value});
    if (selectedTeam) query.set('team', selectedTeam);
    el('teamCalendarResults').textContent = 'Reading shared appointment counts…';
    try {
      var data = await request('/calendar/team?' + query);
      if (current === epoch) showCounts(data);
    } catch (error) {
      if (current === epoch) el('teamCalendarResults').textContent = error.message;
    }
  }
  async function boot() {
    if (!window.ScoutAuth.getSession()) { location.replace('/login'); return; }
    try {
      var context = await request('/team/context');
      if (context.role !== 'owner' && context.role !== 'manager') throw new Error('This page is for managers and admins.');
      var picker = el('teamCalendarTeam');
      if (context.role === 'owner' && context.teams && context.teams.length) {
        var option = document.createElement('option');
        option.value = ''; option.textContent = 'My team'; picker.appendChild(option);
        context.teams.forEach(function (team) {
          var item = document.createElement('option'); item.value = team.key; item.textContent = team.label; picker.appendChild(item);
        });
        picker.value = selectedTeam;
        if (picker.value !== selectedTeam) selectedTeam = '';
        el('teamCalendarTeamLabel').hidden = false;
      } else selectedTeam = '';
      var today = new Date();
      var localDate = function (date) { return date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0'); };
      el('teamCalendarFrom').value = localDate(today);
      today.setDate(today.getDate()+6);
      el('teamCalendarTo').value = localDate(today);
      el('teamCalendarFrom').onchange = clearCounts;
      el('teamCalendarTo').onchange = clearCounts;
      picker.onchange = function () { selectedTeam = picker.value; clearCounts(); };
      el('teamCalendarRange').onsubmit = function (event) {
        event.preventDefault();
        if (context.role === 'owner') selectedTeam = picker.value;
        refresh();
      };
      el('teamCalendarRange').hidden = false;
      await refresh();
    } catch (error) { el('teamCalendarResults').textContent = error.message; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
