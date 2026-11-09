import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

// Page image URLs from MangaDex expire, so this page must never be cached.
export const dynamic = 'force-dynamic';

const MANHUA_TABLE = 'manga';
const CHAPTERS_TABLE = 'chapters';
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL;
const CHAPTER_PAGE_SIZE = 1000; // Supabase returns at most 1000 rows per request
const AT_HOME_URL = 'https://api.mangadex.org/at-home/server';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.'
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Numeric chapter numbers sort numerically (2 before 10); text ones go last.
function compareChapterNumbers(a, b) {
  const aText = String(a).trim();
  const bText = String(b).trim();
  const aNum = Number(aText);
  const bNum = Number(bText);
  const aIsNum = aText !== '' && Number.isFinite(aNum);
  const bIsNum = bText !== '' && Number.isFinite(bNum);

  if (aIsNum && bIsNum) return aNum - bNum;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return aText.localeCompare(bText);
}

async function fetchAllChapters(supabase, manhuaId) {
  const all = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(CHAPTERS_TABLE)
      .select('chapter_number, title, source_chapter_id')
      .eq('manhua_id', manhuaId)
      .order('chapter_number', { ascending: true })
      .range(from, from + CHAPTER_PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Could not load chapters: ${error.message}`);
    }

    const rows = data || [];
    all.push(...rows);

    if (rows.length < CHAPTER_PAGE_SIZE) break;
    from += CHAPTER_PAGE_SIZE;
  }

  return all.sort((a, b) => compareChapterNumbers(a.chapter_number, b.chapter_number));
}

// Asks MangaDex where this chapter's page images live and returns their URLs.
async function fetchPageImageUrls(sourceChapterId) {
  const res = await fetch(`${AT_HOME_URL}/${sourceChapterId}`, {
    headers: {
      'User-Agent': 'manhua-reader/1.0',
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`MangaDex responded with HTTP ${res.status}`);
  }

  const json = await res.json();
  const baseUrl = json && json.baseUrl;
  const chapter = (json && json.chapter) || {};
  const hash = chapter.hash;

  if (!baseUrl || !hash) {
    throw new Error('MangaDex returned no image server for this chapter.');
  }

  let folder = 'data';
  let files = Array.isArray(chapter.data) ? chapter.data : [];

  if (files.length === 0 && Array.isArray(chapter.dataSaver)) {
    folder = 'data-saver';
    files = chapter.dataSaver;
  }

  return files.map((fileName) => `${baseUrl}/${folder}/${hash}/${fileName}`);
}

function chapterHref(manhuaId, chapterNumber) {
  return `/manhua/${manhuaId}/${encodeURIComponent(chapterNumber)}`;
}

const css = `
  body {
    margin: 0;
    background: #0b0d12;
  }
  .page {
    min-height: 100vh;
    background: #0b0d12;
    color: #e8eaf0;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  .topbar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    background: rgba(11, 13, 18, 0.92);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid #1f2533;
  }
  .topbar-title {
    flex: 1;
    min-width: 0;
    text-align: center;
  }
  .topbar-title .name {
    font-size: 15px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .topbar-title .chapter {
    font-size: 12px;
    color: #8a91a5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .link {
    color: #8aa4ff;
    text-decoration: none;
    font-size: 14px;
    white-space: nowrap;
  }
  .link:hover {
    text-decoration: underline;
  }
  .reader {
    max-width: 820px;
    margin: 0 auto;
    background: #000;
  }
  .panel {
    display: block;
    width: 100%;
    height: auto;
    margin: 0;
  }
  .nav {
    display: flex;
    justify-content: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 24px 16px 56px;
  }
  .button {
    display: inline-block;
    padding: 12px 20px;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 600;
    text-decoration: none;
    background: #6c8cff;
    color: #0b0d12;
  }
  .button.secondary {
    background: #151922;
    color: #e8eaf0;
    border: 1px solid #262c3a;
  }
  .button.disabled {
    opacity: 0.35;
    pointer-events: none;
  }
  .message {
    text-align: center;
    color: #8a91a5;
    padding: 64px 20px;
  }
  .error {
    color: #ff8a8a;
  }
`;

function ChapterNav({ manhuaId, prev, next }) {
  return (
    <div className="nav">
      {prev ? (
        <Link className="button secondary" href={chapterHref(manhuaId, prev.chapter_number)}>
          &larr; Chapter {prev.chapter_number}
        </Link>
      ) : (
        <span className="button secondary disabled">&larr; Previous</span>
      )}
      <Link className="button secondary" href={`/manhua/${manhuaId}`}>
        All chapters
      </Link>
      {next ? (
        <Link className="button" href={chapterHref(manhuaId, next.chapter_number)}>
          Chapter {next.chapter_number} &rarr;
        </Link>
      ) : (
        <span className="button disabled">Next &rarr;</span>
      )}
    </div>
  );
}

export default async function ChapterReaderPage({ params }) {
  const resolved = await params;
  const manhuaId = resolved.id;
  const chapterNumber = safeDecode(resolved.chapter);
  const supabase = getSupabase();

  const { data: manhua, error: manhuaError } = await supabase
    .from(MANHUA_TABLE)
    .select('id, title')
    .eq('id', manhuaId)
    .maybeSingle();

  if (manhuaError) {
    throw new Error(`Could not load manhua: ${manhuaError.message}`);
  }
  if (!manhua) {
    notFound();
  }

  const chapters = await fetchAllChapters(supabase, manhuaId);
  const index = chapters.findIndex(
    (chapter) => String(chapter.chapter_number) === chapterNumber
  );

  if (index === -1) {
    notFound();
  }

  const current = chapters[index];
  const prev = index > 0 ? chapters[index - 1] : null;
  const next = index < chapters.length - 1 ? chapters[index + 1] : null;

  let imageUrls = [];
  let loadError = '';

  try {
    imageUrls = await fetchPageImageUrls(current.source_chapter_id);
    if (imageUrls.length === 0) {
      loadError = 'This chapter has no readable pages.';
    }
  } catch (err) {
    loadError = `Could not load pages: ${err.message}`;
  }

  return (
    <div className="page">
      <style>{css}</style>

      <div className="topbar">
        <Link className="link" href={`/manhua/${manhuaId}`}>
          &larr; Chapters
        </Link>
        <div className="topbar-title">
          <div className="name">{manhua.title}</div>
          <div className="chapter">
            Chapter {current.chapter_number}
            {current.title && current.title !== `Chapter ${current.chapter_number}`
              ? ` - ${current.title}`
              : ''}
          </div>
        </div>
        <Link className="link" href="/home">
          Library
        </Link>
      </div>

      {!WORKER_URL && (
        <div className="message error">
          NEXT_PUBLIC_WORKER_URL is not set, so page images cannot load.
        </div>
      )}

      {loadError ? (
        <div className="message error">{loadError}</div>
      ) : (
        WORKER_URL && (
          <div className="reader">
            {imageUrls.map((remoteUrl, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="panel"
                key={remoteUrl}
                src={`${WORKER_URL}?url=${encodeURIComponent(remoteUrl)}`}
                alt={`Page ${i + 1}`}
                loading={i < 3 ? 'eager' : 'lazy'}
                decoding="async"
              />
            ))}
          </div>
        )
      )}

      <ChapterNav manhuaId={manhuaId} prev={prev} next={next} />
    </div>
  );
}
