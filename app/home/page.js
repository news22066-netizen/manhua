'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';

const TABLE_NAME = 'manga';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

function Cover({ remoteUrl, alt }) {
  const [failed, setFailed] = useState(false);

  if (!remoteUrl || !WORKER_URL || failed) {
    return <div className="cover placeholder">No cover</div>;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      className="cover"
      src={`${WORKER_URL}?url=${encodeURIComponent(remoteUrl)}`}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
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
    max-width: 1280px;
    margin: 0 auto;
  }
  .title {
    font-size: 28px;
    font-weight: 700;
    margin: 0 0 4px;
  }
  .subtitle {
    margin: 0 0 20px;
    color: #8a91a5;
    font-size: 14px;
  }
  .search {
    width: 100%;
    box-sizing: border-box;
    padding: 14px 16px;
    font-size: 16px;
    color: #e8eaf0;
    background: #151922;
    border: 1px solid #262c3a;
    border-radius: 12px;
    outline: none;
    margin-bottom: 24px;
  }
  .search:focus {
    border-color: #6c8cff;
    box-shadow: 0 0 0 3px rgba(108, 140, 255, 0.2);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 18px;
  }
  .card {
    display: block;
    color: inherit;
    text-decoration: none;
    background: #151922;
    border: 1px solid #1f2533;
    border-radius: 12px;
    overflow: hidden;
    transition: transform 0.15s ease, border-color 0.15s ease;
  }
  .card:hover {
    transform: translateY(-3px);
    border-color: #6c8cff;
  }
  .cover {
    display: block;
    width: 100%;
    aspect-ratio: 2 / 3;
    object-fit: cover;
    background: #1b2030;
  }
  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #5c647a;
    font-size: 13px;
  }
  .card-title {
    padding: 10px 12px 12px;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .message {
    text-align: center;
    color: #8a91a5;
    padding: 64px 0;
  }
  .error {
    color: #ff8a8a;
  }
`;

export default function HomePage() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!supabase) {
        setError(
          'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.'
        );
        setLoading(false);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from(TABLE_NAME)
        .select('id, title, cover_url')
        .order('title', { ascending: true })
        .limit(200);

      if (cancelled) return;

      if (fetchError) {
        setError(`Could not load manhua: ${fetchError.message}`);
      } else {
        setItems(data || []);
      }
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      (item.title || '').toLowerCase().includes(needle)
    );
  }, [items, query]);

  return (
    <div className="page">
      <style>{css}</style>
      <div className="container">
        <h1 className="title">Manhua Library</h1>
        <p className="subtitle">
          {loading
            ? 'Loading...'
            : `Showing ${filtered.length} of ${items.length} titles`}
        </p>

        <input
          className="search"
          type="text"
          placeholder="Search manhua by name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />

        {!WORKER_URL && (
          <div className="message error">
            NEXT_PUBLIC_WORKER_URL is not set, so cover images cannot load.
          </div>
        )}

        {error && <div className="message error">{error}</div>}

        {!error && loading && <div className="message">Loading titles...</div>}

        {!error && !loading && items.length === 0 && (
          <div className="message">
            The database is empty. Run <code>npm run seed</code> first.
          </div>
        )}

        {!error && !loading && items.length > 0 && filtered.length === 0 && (
          <div className="message">No titles match "{query}".</div>
        )}

        {!error && filtered.length > 0 && (
          <div className="grid">
            {filtered.map((item) => (
              <Link
                className="card"
                href={`/manhua/${item.id}`}
                key={item.id}
              >
                <Cover remoteUrl={item.cover_url} alt={item.title} />
                <div className="card-title">{item.title}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
