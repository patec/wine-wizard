import { getUser } from '@/lib/supabase/server';
import { Quiz, type QuizData } from './Quiz';

export const metadata = { title: 'Map your palate' };

export default async function Onboarding() {
  const { supabase: sb, user } = await getUser();
  // "Bottles you love" picks from the curated benchmarks plus the most-rated imports (the whole catalogue is too big to ship).
  const [{ data: cats }, { data: attrs }, { data: curated }, { data: popular }, { data: palate }] = await Promise.all([
    sb.from('attribute_categories').select('key,label,group_key,group_label,kind,description,sort').in('kind', ['aroma']).order('sort'),
    sb.from('attributes').select('key,label,category,kind').in('kind', ['aroma', 'texture', 'style']).order('sort'),
    sb.from('wines').select('id,name,producer,wine_type,region').eq('source', 'curated'),
    sb.from('wines').select('id,name,producer,wine_type,region').neq('source', 'curated').order('community_ratings', { ascending: false, nullsFirst: false }).limit(1000),
    sb.from('palates').select('quiz,display_name').eq('user_id', user!.id).maybeSingle(),
  ]);
  const data: QuizData = {
    categories: (cats ?? []).map((c) => ({
      ...c,
      examples: (attrs ?? []).filter((a) => a.category === c.key).slice(0, 4).map((a) => a.label),
    })),
    attributes: attrs ?? [],
    wines: [...new Map([...(curated ?? []), ...(popular ?? [])].map((w) => [w.id, w])).values()].sort((a, b) => a.producer.localeCompare(b.producer)),
    previous: palate?.quiz ?? null,
    name: palate?.display_name ?? null,
  };
  return (
    <div className="container page" style={{ maxWidth: 920 }}>
      <Quiz data={data} />
    </div>
  );
}
