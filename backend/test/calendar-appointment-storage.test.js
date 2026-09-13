'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION = path.join(__dirname, '..', 'migrations', '20260913210000_calendar_appointment_ledger.sql');
const PRIVACY = path.join(__dirname, '..', 'web', 'privacy.html');
const WORKFLOW = path.join(__dirname, '..', '..', '.github', 'workflows', 'fathom-sync.yml');
const CALENDAR_JS = path.join(__dirname, '..', 'web', 'js', 'scout-calendar.js');
const ACCOUNT_JS = path.join(__dirname, '..', 'web', 'js', 'scout-calendar-account.js');

test('appointment ledger schema owns stable occurrences, minimal history and server-only access', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /unique\s*\(user_id, provider_calendar_id, provider_event_id\)/i);
  assert.match(sql, /unique\s*\(user_id, provider_calendar_id, provider_occurrence_key\)/i);
  assert.match(sql, /calendar_appointment_history[\s\S]*state_hash text not null/i);
  assert.match(sql, /provider_recurring_event_id text/i);
  assert.match(sql, /provider_original_start timestamptz/i);
  assert.match(sql, /unique\s*\(appointment_id, state_hash\)/i);
  assert.match(sql, /user_id uuid not null references auth\.users\(id\) on delete cascade/i);
  assert.match(sql, /matched_call_id uuid references public\.fathom_calls\(id\) on delete set null/i);
  assert.match(sql, /enable row level security/gi);
  assert.match(sql, /revoke all on public\.calendar_appointments from anon, authenticated/i);
  assert.match(sql, /revoke all on public\.calendar_appointment_history from anon, authenticated/i);
  assert.doesNotMatch(sql, /\bdescription\b|\blocation\b|meeting_link|raw_event|event_payload|access_token|refresh_token/i);
});

test('transactional recorder requires a live matching connection and retains first-seen history', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /create or replace function public\.record_calendar_appointment/i);
  assert.match(sql, /google_calendar_connections[\s\S]*p_generation/i);
  assert.match(sql, /raise exception 'connection_changed'/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /on conflict \(appointment_id, state_hash\) do nothing/i);
  assert.match(sql, /first_seen_at/i);
  assert.match(sql, /last_seen_at/i);
  assert.match(sql, /source_observation text not null check \(source_observation in \('qualifying', 'not_qualifying'\)\)/i);
});

test('privacy policy truthfully describes the retained minimal calendar history', () => {
  const html = fs.readFileSync(PRIVACY, 'utf8');
  assert.match(html, /appointment history/i);
  assert.match(html, /Zoom meeting ID/i);
  assert.match(html, /external attendee email/i);
  assert.match(html, /kept with your Scout account/i);
  assert.match(html, /Disconnecting[^.]*does not delete[^.]*appointment history/i);
  assert.doesNotMatch(html, /not saved as a calendar history/i);
  for (const file of [CALENDAR_JS, ACCOUNT_JS]) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /Calendar details stay private to you and are not saved|Event details stay private to you and are not saved/i);
    assert.match(source, /minimal appointment history/i);
  }
});

test('the existing recording sync schedule runs calendar reconciliation after recordings arrive', () => {
  const yaml = fs.readFileSync(WORKFLOW, 'utf8');
  const zoom = yaml.indexOf('/zoom/sync-all');
  const calendar = yaml.indexOf('/calendar/sync-all');
  assert.ok(zoom >= 0);
  assert.ok(calendar > zoom);
  assert.match(yaml.slice(calendar), /X-Cron-Secret/);
});
