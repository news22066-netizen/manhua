/**
 * Incremental seeder. Seeds Supabase with metadata ONLY (no images are downloaded).
 * Run:  npm run seed     (Node 20.6+, reads .env.local)
 *
 * Two phases, so existing data is never lost:
 *
 *   Phase A (update existing)
 *     Walks every manhua already in Supabase and checks that `cover_url` has the form
 *       https://uploads.mangadex.org/covers/<source_id>/<fileName>.512.jpg
 *     Rows that don't match are repaired (only `cover_url` is touched) using the
 *     cover filename from MangaDex. Titles, ratings, chapters etc. are never modified.
 *
 *   Phase B (append new English batch)
 *     Finds NEW_BATCH_SIZE popular Chinese-origin series that are NOT in the database yet
 *     and have readable English chapters, then appends them (plus their chapters).
 *     Titles come from `attributes.title.en` only, so no raw CJK text reaches the UI.
 *     Inserts use upsert on `source_id` with duplicates ignored (never overwritten).
 */
const { createClient } = require('@supabase/supabase-js');

const API = 'https://api.mangadex.org';
const UA = 'ManhuaReaderSeed/1.0 (personal project)';

const NEW_BATCH_SIZE = 100; // brand-new titles to append in Phase B
const PAGE_SIZE = 100; // MangaDex /manga max page size
const MAX_SCAN = 2000; // never scan deeper than the top 2000 followed titles
const DB_PAGE = 1000; // Supabase default max rows per request

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** GET with repeated query keys, polite pacing (MangaDex ~5 req/s) and 429 retry. */
async function md(path, pairs = []) {
  const u = new URL(API + path);
  for (const [k, v] of pairs) u.searchParams.append(k, v);
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(u, { headers: { 'User-Agent': UA } });
    if (res.status === 429) {
      await sleep(2000 * attempt);
      continue;
    }
    if (!res.ok) throw new Error(`MangaDex ${res.status} for ${u}`);
    await sleep(250);
    return res.json();
  }
  throw new Error(`MangaDex rate-limited too long: ${u}`);
}

/* ------------------------------------------------------------------------- */
/* Shared helpers                                                            */
/* ------------------------------------------------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Canonical cover URL the proxy streams: uploads.mangadex.org/covers/<mangaId>/<fileName>.512.jpg
const COVER_RE = /^https:\/\/uploads\.mangadex\.org\/covers\/([0-9a-f-]{36})\/([^/?#]+)\.512\.jpg$/i;
const buildCoverUrl = (mangaId, fileName) => `https://uploads.mangadex.org/covers/${mangaId}/${fileName}.512.jpg`;

// Hiragana/Katakana, CJK ideographs (incl. extension A), Hangul.
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

function hasCorrectCoverShape(coverUrl, sourceId) {
  if (typeof coverUrl !== 'string') return false;
  const match = COVER_RE.exec(coverUrl);
  return Boolean(match) && match[1].toLowerCase() === String(sourceId).toLowerCase();
}

function coverFileName(manga) {
  return manga.relationships?.find((r) => r.type === 'cover_art')?.attributes?.fileName || null;
}

/** Reads every row of `manhuas` (paginated so we never silently stop at 1000). */
async function loadAllManhuas(columns) {
  const rows = [];
  for (let from = 0; ; from += DB_PAGE) {
    const { data, error } = await supabase
      .from('manhuas')
      .select(columns)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + DB_PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < DB_PAGE) break;
  }
  return rows;
}

/* ------------------------------------------------------------------------- */
/* Phase A: verify / repair cover_url on existing rows                       */
/* ------------------------------------------------------------------------- */

/** Map<mangaId, fileName> for the given MangaDex manga ids. */
async function fetchCoverFileNames(ids) {
  const out = new Map();
  for (const part of chunk(ids, 50)) {
    const json = await md('/manga', [
      ['limit', '50'],
      ...part.map((id) => ['ids[]', id]),
      ['includes[]', 'cover_art'],
      ['contentRating[]', 'safe'],
      ['contentRating[]', 'suggestive'],
    ]);
    for (const m of json.data) {
      const file = coverFileName(m);
      if (file) out.set(m.id, file);
    }
  }
  return out;
}

async function phaseA() {
  console.log('\n=== Phase A: verifying cover_url on existing manhuas ===');
  const existing = await loadAllManhuas('id, source_id, title, cover_url');
  console.log(`Found ${existing.length} existing manhuas.`);

  const needsFix = [];
  let ok = 0;
  let badSourceId = 0;
  for (const row of existing) {
    if (!UUID_RE.test(String(row.source_id))) {
      badSourceId++;
      console.warn(`  skip "${row.title}": source_id is not a MangaDex UUID (${row.source_id})`);
      continue;
    }
    if (hasCorrectCoverShape(row.cover_url, row.source_id)) ok++;
    else needsFix.push(row);
  }
  console.log(`${ok} already correct, ${needsFix.length} need repair.`);

  let fixed = 0;
  let unresolved = 0;
  if (needsFix.length) {
    const fileNames = await fetchCoverFileNames(needsFix.map((r) => r.source_id));
    for (const row of needsFix) {
      const file = fileNames.get(row.source_id);
      if (!file) {
        unresolved++;
        console.warn(`  could not resolve a cover for "${row.title}" (${row.source_id}); left unchanged`);
        continue;
      }
      const cover_url = buildCoverUrl(row.source_id, file);
      // Only cover_url is written, so nothing else on the row can be lost.
      const { error } = await supabase.from('manhuas').update({ cover_url }).eq('id', row.id);
      if (error) throw error;
      fixed++;
      console.log(`  fixed "${row.title}": ${row.cover_url ?? '(empty)'} -> ${cover_url}`);
    }
  }

  console.log(
    `Phase A done. correct=${ok} fixed=${fixed} unresolved=${unresolved} invalid_source_id=${badSourceId}`
  );
}

/* ------------------------------------------------------------------------- */
/* Phase B: append new English-readable Chinese-origin series                */
/* ------------------------------------------------------------------------- */

/**
 * Strict English title: attributes.title.en first, then an English alt title.
 * Never falls back to another language, and rejects anything containing CJK characters.
 */
function pickEnglishTitle(attributes) {
  const candidates = [attributes.title?.en, ...(attributes.altTitles || []).map((t) => t?.en)];
  const found = candidates.find((t) => typeof t === 'string' && t.trim() && !CJK_RE.test(t));
  return found ? found.trim() : null;
}

/** All readable English chapters for one manga, de-duplicated by chapter number. */
async function fetchChapters(mangaSourceId) {
  const byNumber = new Map();
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const json = await md(`/manga/${mangaSourceId}/feed`, [
      ['translatedLanguage[]', 'en'],
      ['order[chapter]', 'desc'],
      ['limit', '500'],
      ['offset', String(offset)],
      ['includeExternalUrl', '0'],
      ['contentRating[]', 'safe'],
      ['contentRating[]', 'suggestive'],
    ]);
    total = json.total;
    offset += 500;
    for (const c of json.data) {
      const a = c.attributes;
      const n = a.chapter == null ? NaN : Number(a.chapter);
      if (Number.isNaN(n) || !a.pages || a.externalUrl) continue;
      if (!byNumber.has(n)) {
        byNumber.set(n, {
          chapter_number: n,
          title: a.title || null,
          source_chapter_id: c.id,
          published_at: a.publishAt || null,
        });
      }
    }
  }
  return [...byNumber.values()];
}

async function fetchStats(ids) {
  const out = {};
  for (const part of chunk(ids, 50)) {
    const json = await md('/statistics/manga', part.map((id) => ['manga[]', id]));
    Object.assign(out, json.statistics);
  }
  return out;
}

/**
 * Walks MangaDex's most-followed Chinese-origin list (English chapters available) and
 * collects NEW_BATCH_SIZE series that are not in the database, have a clean English title,
 * a cover, and at least one readable English chapter.
 */
async function collectNewBatch(knownSourceIds) {
  const seen = new Set(knownSourceIds);
  const accepted = [];
  const skipped = { alreadyKnown: 0, noEnglishTitle: 0, noCover: 0, noReadableChapters: 0 };

  let offset = 0;
  let total = Infinity;
  while (accepted.length < NEW_BATCH_SIZE && offset < Math.min(total, MAX_SCAN)) {
    const json = await md('/manga', [
      ['limit', String(PAGE_SIZE)],
      ['offset', String(offset)],
      ['originalLanguage[]', 'zh'],
      ['availableTranslatedLanguage[]', 'en'],
      ['hasAvailableChapters', 'true'],
      ['order[followedCount]', 'desc'],
      ['includes[]', 'cover_art'],
      ['contentRating[]', 'safe'],
      ['contentRating[]', 'suggestive'],
    ]);
    total = json.total;
    offset += PAGE_SIZE;
    if (!json.data.length) break;

    for (const m of json.data) {
      if (accepted.length >= NEW_BATCH_SIZE) break;
      if (seen.has(m.id)) {
        skipped.alreadyKnown++;
        continue;
      }
      seen.add(m.id);

      const title = pickEnglishTitle(m.attributes);
      if (!title) {
        skipped.noEnglishTitle++;
        continue;
      }
      const file = coverFileName(m);
      if (!file) {
        skipped.noCover++;
        continue;
      }
      const chapters = await fetchChapters(m.id);
      if (!chapters.length) {
        skipped.noReadableChapters++;
        continue;
      }
      accepted.push({ manga: m, title, cover_url: buildCoverUrl(m.id, file), chapters });
      console.log(`  [${accepted.length}/${NEW_BATCH_SIZE}] ${title}: ${chapters.length} chapters`);
    }
  }
  return { accepted, skipped };
}

function toRow(item, stats) {
  const a = item.manga.attributes;
  const s = stats[item.manga.id] || {};
  const rating = s.rating?.bayesian ?? s.rating?.average ?? null;
  return {
    source_id: item.manga.id,
    title: item.title,
    description: a.description?.en || null,
    cover_url: item.cover_url,
    rating: rating ? Number(rating.toFixed(1)) : null,
    follows: s.follows ?? 0,
    genres: (a.tags || [])
      .filter((t) => ['genre', 'theme'].includes(t.attributes.group))
      .map((t) => t.attributes.name.en)
      .filter(Boolean),
    status: a.status || null,
  };
}

async function phaseB() {
  console.log('\n=== Phase B: appending new English-readable Chinese-origin titles ===');
  const existing = await loadAllManhuas('source_id');
  console.log(`${existing.length} titles already in the database will be skipped.`);

  console.log(`Searching MangaDex for ${NEW_BATCH_SIZE} new titles...`);
  const { accepted, skipped } = await collectNewBatch(existing.map((r) => r.source_id));
  console.log(
    `Collected ${accepted.length} new titles. Skipped: ${skipped.alreadyKnown} already in DB, ` +
      `${skipped.noEnglishTitle} without a clean English title, ${skipped.noCover} without a cover, ` +
      `${skipped.noReadableChapters} without readable English chapters.`
  );
  if (accepted.length < NEW_BATCH_SIZE) {
    console.warn(`Only ${accepted.length} of ${NEW_BATCH_SIZE} qualifying new titles were found.`);
  }
  if (!accepted.length) {
    console.log('Phase B done. Nothing to append.');
    return;
  }

  const stats = await fetchStats(accepted.map((i) => i.manga.id));
  const rows = accepted.map((i) => toRow(i, stats));

  // Upsert on source_id; ignoreDuplicates => ON CONFLICT DO NOTHING, so existing rows are never overwritten.
  const { error: upsertError } = await supabase
    .from('manhuas')
    .upsert(rows, { onConflict: 'source_id', ignoreDuplicates: true });
  if (upsertError) throw upsertError;

  // Look the rows up again to get their database ids (works whether inserted now or already present).
  const idBySource = new Map();
  for (const part of chunk(rows.map((r) => r.source_id), 50)) {
    const { data, error } = await supabase.from('manhuas').select('id, source_id').in('source_id', part);
    if (error) throw error;
    for (const r of data) idBySource.set(r.source_id, r.id);
  }

  let totalChapters = 0;
  for (const item of accepted) {
    const manhuaId = idBySource.get(item.manga.id);
    if (!manhuaId) throw new Error(`Row for ${item.manga.id} (${item.title}) is missing after upsert`);
    const chapterRows = item.chapters.map((c) => ({ ...c, manhua_id: manhuaId }));
    for (const part of chunk(chapterRows, 500)) {
      const { error } = await supabase
        .from('chapters')
        .upsert(part, { onConflict: 'manhua_id,chapter_number' });
      if (error) throw error;
    }
    totalChapters += chapterRows.length;
  }
  console.log(`Phase B done. ${rows.length} manhuas appended, ${totalChapters} chapters stored.`);
}

/* ------------------------------------------------------------------------- */

(async () => {
  await phaseA();
  await phaseB();
  console.log('\nAll done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});