// One-off migration: extract inlined base64 photos from the local Supabase
// dump file (the production rows are too large to read back through the
// PostgREST 8s timeout), upload each to the inspection-photos Storage bucket,
// then UPDATE the storage_path column to the new object path.
//
// Run with:
//   node scripts/migrate-photos-to-storage.mjs [path/to/data-dump.sql]
//
// If no dump path is given, picks the most recent
//   backups/vistoria-obras-*-data.sql
//
// Requires EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

function loadDotEnv() {
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadDotEnv();

const BUCKET = 'inspection-photos';
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}
const supabase = createClient(url, key);

function pickLatestDump() {
  const dir = new URL('../backups/', import.meta.url);
  const entries = readdirSync(dir)
    .filter((n) => /vistoria-obras-.*-data\.sql$/.test(n))
    .map((n) => ({ name: n, mtime: statSync(new URL(n, dir)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!entries.length) throw new Error('No data dump found in backups/');
  return join(dir.pathname.replace(/^\/+([A-Za-z]:)/, '$1'), entries[0].name);
}

// Parse a Postgres INSERT VALUES block into rows of strings/nulls.
// Handles only the syntax pg_dump emits: single-quoted strings with '' escape,
// NULL keyword, no functions/casts (which our table doesn't have).
function parseInsertValues(sql) {
  // Strip everything up to the first '(' after 'VALUES'
  const valuesIdx = sql.indexOf('VALUES');
  if (valuesIdx < 0) return [];
  const body = sql.slice(valuesIdx + 'VALUES'.length);

  const rows = [];
  let i = 0;
  const n = body.length;

  while (i < n) {
    // Skip whitespace and commas between tuples
    while (i < n && /[\s,;]/.test(body[i])) i++;
    if (i >= n || body[i] !== '(') break;
    i++; // consume '('

    const cols = [];
    let buf = '';
    let inStr = false;

    while (i < n) {
      const c = body[i];
      if (inStr) {
        if (c === "'") {
          // doubled '' = literal '
          if (body[i + 1] === "'") { buf += "'"; i += 2; continue; }
          inStr = false; i++; continue;
        }
        buf += c; i++; continue;
      }
      if (c === "'") { buf = ''; inStr = true; i++; continue; }
      if (c === ',') { cols.push(finalize(buf)); buf = ''; i++; continue; }
      if (c === ')') { cols.push(finalize(buf)); i++; break; }
      buf += c; i++;
    }
    rows.push(cols);
  }
  return rows;

  function finalize(raw) {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.toUpperCase() === 'NULL') return null;
    return raw; // string contents (already unescaped)
  }
}

function extractInsertBlock(sqlText, tableName) {
  const startMarker = `INSERT INTO "public"."${tableName}"`;
  const start = sqlText.indexOf(startMarker);
  if (start < 0) return null;
  // Find the terminating semicolon at end-of-line for this statement.
  // pg_dump may continue across multiple lines for multi-row inserts.
  let i = start;
  let inStr = false;
  while (i < sqlText.length) {
    const c = sqlText[i];
    if (inStr) {
      if (c === "'") {
        if (sqlText[i + 1] === "'") { i += 2; continue; }
        inStr = false; i++; continue;
      }
      i++; continue;
    }
    if (c === "'") { inStr = true; i++; continue; }
    if (c === ';') { return sqlText.slice(start, i + 1); }
    i++;
  }
  return sqlText.slice(start);
}

function parseDataUri(value) {
  const m = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) return null;
  const mime = m[1] || 'image/jpeg';
  const isBase64 = Boolean(m[2]);
  const payload = m[3];
  const bytes = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'binary');
  return { mime, bytes };
}

function extFor(mime) {
  if (!mime) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic')) return 'heic';
  if (mime.includes('heif')) return 'heif';
  return 'jpg';
}

async function main() {
  const dumpPath = process.argv[2] || pickLatestDump();
  console.log(`Reading dump: ${dumpPath}`);
  const sql = readFileSync(dumpPath, 'utf8');

  const block = extractInsertBlock(sql, 'inspection_photos');
  if (!block) { console.error('No inspection_photos INSERT found in dump'); process.exit(1); }
  const rows = parseInsertValues(block);
  console.log(`Parsed ${rows.length} inspection_photos rows from dump.`);

  // Column order from the dump header:
  // id, obra_id, tower_id, apartment_id, item_id, service_id, service,
  // storage_path, file_name, comment, visit_id, created_at
  const COL = { id: 0, apartment_id: 3, item_id: 4, service_id: 5, storage_path: 7 };

  let migrated = 0, skipped = 0, failed = 0;

  for (const cols of rows) {
    const id = cols[COL.id];
    const apartmentId = cols[COL.apartment_id];
    const itemId = cols[COL.item_id] || cols[COL.service_id] || 'misc';
    const storagePath = cols[COL.storage_path] || '';

    if (!storagePath.startsWith('data:')) { skipped++; continue; }
    const parsed = parseDataUri(storagePath);
    if (!parsed) { skipped++; continue; }

    const objectPath = `${apartmentId}/${itemId}/${id}.${extFor(parsed.mime)}`;

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, parsed.bytes, { contentType: parsed.mime, upsert: true });
    if (upErr) {
      console.error(`  upload failed for ${id}: ${upErr.message}`);
      failed++;
      continue;
    }

    const { error: updErr } = await supabase
      .from('inspection_photos')
      .update({ storage_path: objectPath })
      .eq('id', id);
    if (updErr) {
      console.error(`  row update failed for ${id}: ${updErr.message}`);
      failed++;
      continue;
    }

    migrated++;
    console.log(`  ✓ ${id} → ${objectPath} (${(parsed.bytes.length / 1024).toFixed(0)} KB)`);
  }

  console.log(`\nDone. migrated=${migrated} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
