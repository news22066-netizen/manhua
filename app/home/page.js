import { supabase } from '@/lib/supabase';
import GenreFilter from '@/components/GenreFilter';
import ManhuaCard from '@/components/ManhuaCard';

export const dynamic = 'force-dynamic'; // genre filter lives in the query string

export default async function Home({ searchParams }) {
  const sp = await searchParams;
  const selected = (sp?.genre ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  let query = supabase
    .from('manhuas')
    .select('id, title, cover_url, rating, genres, chapters(chapter_number, published_at)')
    .order('follows', { ascending: false })
    .limit(100)
    .order('chapter_number', { referencedTable: 'chapters', ascending: false })
    .limit(3, { referencedTable: 'chapters' });
  if (selected.length) query = query.contains('genres', selected);

  const [{ data: manhuas, error }, { data: genreRows }] = await Promise.all([
    query,
    supabase.from('manhuas').select('genres'),
  ]);

  const genres = [...new Set((genreRows ?? []).flatMap((r) => r.genres))].sort();

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <GenreFilter genres={genres} selected={selected} />

      <div className="mb-4 mt-6 flex items-baseline justify-between">
        <h1 className="text-lg font-bold">All manhua</h1>
        <span className="text-sm text-neutral-500">{manhuas?.length ?? 0} results</span>
      </div>

      {error && <p className="text-sm text-red-500">Could not load titles: {error.message}</p>}
      {!error && manhuas?.length === 0 && (
        <p className="py-16 text-center text-neutral-500">
          No titles match these genres. Clear the filter or pick fewer genres.
        </p>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-4 md:gap-x-4 lg:grid-cols-6">
        {manhuas?.map((m) => <ManhuaCard key={m.id} m={m} />)}
      </div>
    </main>
  );
}