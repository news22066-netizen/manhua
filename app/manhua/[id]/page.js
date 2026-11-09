import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

export const revalidate = 300;

const MANHUA_TABLE = 'manga';
const CHAPTERS_TABLE = 'chapters';
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL;
const CHAPTER_PAGE_SIZE = 1000; // Supabase returns at most 1000 rows per request

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
      .select('chapter_number, title, published_at')
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

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
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
    padding: 24px 20px 64px;
  }
  .container {
    max-width: 1100px;
    margin: 0 auto;
  }
  .back {
    display: inline-block;
    color: #8aa4ff;
    text-decoration: none;
    font-size: 14px;
    margin-bottom: 20px;
  }
  .back:hover {
    text-decoration: underline;
  }
  .hero {
    display: flex;
    gap: 28px;
    align-items: flex-start;
    margin-bottom: 36px;
  }
  .cover {
    flex: 0 0 220px;
    width: 220px;
    aspect-ratio: 2 / 3;
    object-fit: cover;
    border-radius: 12px;
    border: 1px solid #1f2533;
    background: #1b2030;
  }
  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #5c647a;
    font-size: 13px;
  }
  .info {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-size: 30px;
    font-weight: 700;
    margin: 0 0 8px;
    line-height: 1.2;
  }
  .meta {
    color: #8a91a5;
    font-size: 14px;
    margin: 0 0 16px;
  }
  .description {
    color: #c3c8d6;
    font-size: 15px;
    line-height: 1.6;
    white-space: pre-wrap;
    margin: 0 0 20px;
  }
  .actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
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
  .section-title {
    font-size: 20px;
    font-weight: 700;
    margin: 0 0 16px;
  }
  .chapter-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 10px;
  }
  .chapter {
    display: block;
    color: inherit;
    text-decoration: none;
    background: #151922;
    border: 1px solid #1f2533;
    border-radius: 10px;
    padding: 12px 14px;
    transition: border-color 0.15s ease, transform 0.15s ease;
  }
  .chapter:hover {
    border-color: #6c8cff;
    transform: translateY(-2px);
  }
  .chapter-number {
    font-size: 14px;
    font-weight: 700;
  }
  .chapter-title {
    font-size: 13px;
    color: #aab0c2;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chapter-date {
    font-size: 12px;
    color: #6f768b;
    margin-top: 4px;
  }
  .message {
    color: #8a91a5;
    padding: 32px 0;
  }
  .error {
    color: #ff8a8a;
  }
  @media (max-width: 640px) {
    .hero {
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .cover {
      flex-basis: auto;
    }
    .actions {
      justify-content: center;
    }
  }
`;

export default async function ManhuaDetailPage({ params }) {
  const { id } = await params;
  const supabase = getSupabase();

  const { data: manhua, error: manhuaError } = await supabase
    .from(MANHUA_TABLE)
    .select('id, title, description, cover_url')
    .eq('id', id)
    .maybeSingle();

  if (manhuaError) {
    throw new Error(`Could not load manhua: ${manhuaError.message}`);
  }
  if (!manhua) {
    notFound();
  }

  const chapters = await fetchAllChapters(supabase, id);
  const first = chapters[0];
  const latest = chapters[chapters.length - 1];

  return (
    <div className="page">
      <style>{css}</style>
      <div className="container">
        <Link className="back" href="/home">
          &larr; Back to library
        </Link>

        {!WORKER_URL && (
          <div className="message error">
            NEXT_PUBLIC_WORKER_URL is not set, so the cover image cannot load.
          </div>
        )}

        <div className="hero">
          {manhua.cover_url && WORKER_URL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="cover"
              src={`${WORKER_URL}?url=${encodeURIComponent(manhua.cover_url)}`}
              alt={manhua.title}
            />
          ) : (
            <div className="cover placeholder">No cover</div>
          )}

          <div className="info">
            <h1 className="title">{manhua.title}</h1>
            <p className="meta">
              {chapters.length} English chapter{chapters.length === 1 ? '' : 's'}
            </p>
            {manhua.description ? (
              <p className="description">{manhua.description}</p>
            ) : null}

            {first && latest && (
              <div className="actions">
                <Link
                  className="button"
                  href={chapterHref(manhua.id, first.chapter_number)}
                >
                  Start reading (Ch. {first.chapter_number})
                </Link>
                {latest.chapter_number !== first.chapter_number && (
                  <Link
                    className="button secondary"
                    href={chapterHref(manhua.id, latest.chapter_number)}
                  >
                    Latest (Ch. {latest.chapter_number})
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        <h2 className="section-title">Chapters</h2>

        {chapters.length === 0 ? (
          <div className="message">
            No chapters saved for this title yet. Run{' '}
            <code>node scripts/seed.js --chapters-only</code>.
          </div>
        ) : (
          <div className="chapter-grid">
            {chapters.map((chapter) => (
              <Link
                className="chapter"
                key={chapter.chapter_number}
                href={chapterHref(manhua.id, chapter.chapter_number)}
              >
                <div className="chapter-number">Chapter {chapter.chapter_number}</div>
                <div className="chapter-title">{chapter.title}</div>
                {chapter.published_at ? (
                  <div className="chapter-date">{formatDate(chapter.published_at)}</div>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
