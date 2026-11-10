'use client';
import { supabase } from '@/lib/supabase';
import GenreFilter from '@/components/GenreFilter';
import ManhuaCard from '@/components/ManhuaCard';
import { useEffect, useState } from 'react';

export default function Home({ searchParams }) {
  const [manhuas, setManhuas] = useState([]);
  const [genres, setGenres] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadData() {
      const sp = await searchParams;
      const selected = (sp?.genre ?? '').split(',').map((s) => s.trim()).filter(Boolean);

      let query = supabase
        .from('manhuas')
        .select('id, title, cover_url, rating, genres, chapters(chapter_number, published_at)')
        .order('follows', { ascending: false })
        .limit(200) // 🚀 Upgraded from 100 to 200 items
        .order('chapter_number', { referencedTable: 'chapters', ascending: false })
        .limit(3, { referencedTable: 'chapters' });
      
      if (selected.length) query = query.contains('genres', selected);

      const [resData, resGenres] = await Promise.all([
        query,
        supabase.from('manhuas').select('genres'),
      ]);

      if (resData.error) setError(resData.error);
      if (resData.data) setManhuas(resData.data);
      if (resGenres.data) {
        const uniqueGenres = [...new Set(resGenres.data.flatMap((r) => r.genres))].sort();
        setGenres(uniqueGenres);
      }
    }
    loadData();
  }, [searchParams]);

  // Client-side real-time filtering logic matching the text bar input keyword
  const filteredManhuas = manhuas.filter((m) =>
    m.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <GenreFilter genres={genres} selected={[]} />

      {/* 🔍 Inline Search Bar added right below the genre selection container */}
      <div className="mt-4 max-w-md">
        <input
          type="text"
          placeholder="Search 200+ viral titles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-[#00B4D8] transition-colors"
        />
      </div>

      <div className="mb-4 mt-6 flex items-baseline justify-between">
        <h1 className="text-lg font-bold">All manhua</h1>
        <span className="text-sm text-neutral-500">{filteredManhuas.length} results</span>
      </div>

      {error && <p className="text-sm text-red-500">Could not load titles: {error.message}</p>}
      {filteredManhuas.length === 0 && (
        <p className="py-16 text-center text-neutral-500">
          No titles match your search criteria.
        </p>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-4 md:gap-x-4 lg:grid-cols-6">
        {filteredManhuas.map((m) => (
          <ManhuaCard key={m.id} m={m} />
        ))}
      </div>
    </main>
  );
}
