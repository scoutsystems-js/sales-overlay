'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const MIGRATION = path.join(__dirname, '..', 'migrations', '20260913210000_calendar_appointment_ledger.sql');
const USER_ID = '10000000-0000-4000-8000-000000000001';
const GENERATION = '20000000-0000-4000-8000-000000000001';

async function migratedDatabase() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role;
    create table auth.users (id uuid primary key);
    create table public.fathom_calls (id uuid primary key);
    create table public.google_calendar_connections (
      user_id uuid primary key references auth.users(id) on delete cascade,
      generation uuid not null
    );
  `);
  await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
  await db.query('insert into auth.users (id) values ($1)', [USER_ID]);
  await db.query('insert into public.google_calendar_connections (user_id, generation) values ($1, $2)', [USER_ID, GENERATION]);
  return db;
}

function recordParams(overrides = {}) {
  return [
    USER_ID, GENERATION, 'primary@example.com', 'google-event-1', 'a'.repeat(64),
    'series-1', '2026-09-14T00:30:00Z', '2026-09-14T00:30:00Z', '2026-09-14T01:30:00Z',
    'America/New_York', '2026-09-13', '81234567890', 'Unverified title', 'prospect@example.com',
    '2026-09-13T13:00:00Z', 'qualifying', '2026-09-13T14:00:00Z', 'b'.repeat(64),
  ].map((value, index) => Object.hasOwn(overrides, index) ? overrides[index] : value);
}

async function record(db, params) {
  return db.query(`select public.record_calendar_appointment(
    $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::timestamptz,
    $8::timestamptz, $9::timestamptz, $10::text, $11::date, $12::text, $13::text,
    $14::text, $15::timestamptz, $16::text, $17::timestamptz, $18::text
  ) as id`, params);
}

test('real migration preserves one occurrence and immutable revisions when Google replaces its event id', async () => {
  const db = await migratedDatabase();
  try {
    const first = await record(db, recordParams());
    const second = await record(db, recordParams({
      3: 'google-event-replacement', 8: '2026-09-14T02:00:00Z', 13: null,
      14: '2026-09-13T15:00:00Z', 16: '2026-09-13T15:01:00Z', 17: 'c'.repeat(64),
    }));
    assert.equal(second.rows[0].id, first.rows[0].id);
    const current = await db.query('select provider_event_id, first_seen_at, last_seen_at from public.calendar_appointments');
    assert.equal(current.rows.length, 1);
    assert.equal(current.rows[0].provider_event_id, 'google-event-replacement');
    assert.equal(new Date(current.rows[0].first_seen_at).toISOString(), '2026-09-13T14:00:00.000Z');
    assert.equal(new Date(current.rows[0].last_seen_at).toISOString(), '2026-09-13T15:01:00.000Z');
    const history = await db.query('select provider_event_id from public.calendar_appointment_history order by observed_at');
    assert.deepEqual(history.rows.map(row => row.provider_event_id), ['google-event-1', 'google-event-replacement']);
  } finally { await db.close(); }
});

test('real migration rejects stale generations, invalid Zoom ids and client table access', async () => {
  const db = await migratedDatabase();
  try {
    await assert.rejects(record(db, recordParams({ 1: '20000000-0000-4000-8000-000000000002' })), /connection_changed/);
    await assert.rejects(record(db, recordParams({ 11: 'not-a-zoom-id' })), /calendar_appointments_zoom_meeting_id_check/);
    const security = await db.query(`
      select c.relname, c.relrowsecurity,
        has_table_privilege('anon', c.oid, 'select') as anon_select,
        has_table_privilege('authenticated', c.oid, 'select') as authenticated_select,
        has_table_privilege('service_role', c.oid, 'select') as service_select
      from pg_class c
      where c.oid in ('public.calendar_appointments'::regclass, 'public.calendar_appointment_history'::regclass)
      order by c.relname
    `);
    assert.deepEqual(security.rows.map(row => ({
      table: row.relname, rls: row.relrowsecurity, anon: row.anon_select,
      authenticated: row.authenticated_select, service: row.service_select,
    })), [
      { table: 'calendar_appointment_history', rls: true, anon: false, authenticated: false, service: true },
      { table: 'calendar_appointments', rls: true, anon: false, authenticated: false, service: true },
    ]);
  } finally { await db.close(); }
});
