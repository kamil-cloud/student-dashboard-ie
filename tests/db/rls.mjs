// Checks supabase/schema.sql on a real PostgreSQL: Row Level Security keeps every student to
// their own rows, logged-out visitors see nothing, and "Delete my account" only deletes the caller.
//
// Usage: node tests/db/rls.mjs        (needs a local PostgreSQL ≥ 14)
// Env:   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres   (the default)
//
// The database is a throwaway one (sd_rls_test). Supabase's `auth` schema and roles are
// recreated the way Supabase defines them (auth.uid() reads the JWT claims of the request).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8');
const ADMIN_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'sd_rls_test';

const admin = new pg.Client({ connectionString: ADMIN_URL });
try {
  await admin.connect();
} catch (err) {
  console.log(`⚠ No PostgreSQL reachable at ${ADMIN_URL.replace(/:[^:@/]+@/, ':***@')} — skipped (${err.message})`);
  process.exit(0);
}
await admin.query(`drop database if exists ${DB} with (force)`);
await admin.query(`create database ${DB}`);
await admin.end();

const url = new URL(ADMIN_URL);
url.pathname = `/${DB}`;
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();

// --- what a Supabase project already has --------------------------------------------------
await db.query(`
  do $$ begin
    if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  -- Supabase grants everything on new public tables to the API roles; RLS is what protects them.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`);

// The schema runs twice: pasting it again must not fail.
await db.query(SCHEMA);
await db.query(SCHEMA);

const A = crypto.randomUUID();
const B = crypto.randomUUID();
await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [A, 'a@example.com', B, 'b@example.com']);

/** Run `sql` as a logged-in student (`uid`) or as a logged-out visitor (`uid` null). */
async function as(uid, sql, params = []) {
  await db.query('begin');
  try {
    await db.query(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' })]);
    const res = await db.query(sql, params);
    await db.query('commit');
    return res;
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}
const rows = async (uid, sql, params) => (await as(uid, sql, params)).rows;
const fails = async (uid, sql, params) => {
  try {
    await as(uid, sql, params);
  } catch (err) {
    return err.message;
  }
  return null;
};

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.log(`  ✗ ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('\nDatabase rules (Row Level Security)');

await check('a student saves their dashboard (user_id filled in by the database)', async () => {
  const r = await rows(A, `insert into public.dashboards (data) values ('{"items":[{"title":"QA test A"}]}') returning user_id, revision`);
  assert.equal(r[0].user_id, A);
  assert.equal(Number(r[0].revision), 1);
  await rows(B, `insert into public.dashboards (data) values ('{"items":[{"title":"QA test B"}]}')`);
});

await check('each student reads only their own dashboard', async () => {
  const a = await rows(A, 'select user_id, data from public.dashboards');
  assert.equal(a.length, 1);
  assert.equal(a[0].user_id, A);
  assert.equal(a[0].data.items[0].title, 'QA test A');
  const b = await rows(B, 'select user_id from public.dashboards');
  assert.deepEqual(b.map((x) => x.user_id), [B]);
});

await check('logged-out visitors cannot read, write or delete anything', async () => {
  for (const sql of [
    'select * from public.dashboards',
    'select * from public.backups',
    `insert into public.dashboards (user_id, data) values ('${A}', '{}')`,
    `update public.dashboards set data = '{}'`,
    'delete from public.dashboards',
  ]) {
    const err = await fails(null, sql);
    assert.match(err ?? 'allowed', /permission denied/, sql);
  }
});

await check('a student cannot change, delete or create another student’s data', async () => {
  assert.equal((await as(B, `update public.dashboards set data = '{"hacked":true}' where user_id = $1`, [A])).rowCount, 0);
  assert.equal((await as(B, 'delete from public.dashboards where user_id = $1', [A])).rowCount, 0);
  assert.match((await fails(B, `insert into public.dashboards (user_id, data) values ($1, '{}')`, [A])) ?? 'allowed', /row-level security|duplicate key/);
  assert.match((await fails(B, `update public.dashboards set user_id = $1`, [A])) ?? 'allowed', /row-level security|duplicate key/);
  assert.match((await fails(B, `insert into public.backups (user_id, name, kind, data) values ($1, 'x', 'manual', '{}')`, [A])) ?? 'allowed', /row-level security/);
  const a = await rows(A, 'select data from public.dashboards');
  assert.equal(a[0].data.items[0].title, 'QA test A');
});

await check('a save based on an old version is refused (no silent overwrite between devices)', async () => {
  const first = await as(A, `update public.dashboards set data = '{"v":2}', revision = 2 where revision = 1`);
  assert.equal(first.rowCount, 1);
  const stale = await as(A, `update public.dashboards set data = '{"v":"stale"}', revision = 2 where revision = 1`);
  assert.equal(stale.rowCount, 0);
});

await check('backups are private too', async () => {
  await rows(A, `insert into public.backups (name, kind, data, course_count, item_count) values ('auto-1', 'auto', '{"items":[]}', 0, 0)`);
  assert.equal((await rows(A, 'select name from public.backups')).length, 1);
  assert.equal((await rows(B, 'select name from public.backups')).length, 0);
  assert.equal((await as(B, 'delete from public.backups')).rowCount, 0);
  assert.equal((await rows(A, 'select name from public.backups')).length, 1);
});

await check('"Delete my account" only works signed in, and only deletes the caller', async () => {
  assert.match((await fails(null, 'select public.delete_my_account()')) ?? 'allowed', /permission denied/);
  await as(A, 'select public.delete_my_account()');
  const users = await db.query('select id from auth.users');
  assert.deepEqual(users.rows.map((u) => u.id), [B]);
  const left = await db.query('select user_id from public.dashboards union all select user_id from public.backups');
  assert.deepEqual(left.rows.map((r) => r.user_id), [B]);
});

await check('every table in public has Row Level Security on', async () => {
  const r = await db.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
  assert.deepEqual(r.rows, []);
});

await db.end();
const admin2 = new pg.Client({ connectionString: ADMIN_URL });
await admin2.connect();
await admin2.query(`drop database if exists ${DB} with (force)`);
await admin2.end();
console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
