import { getUser } from '@/lib/supabase/server';
import { Quiz, type QuizData } from './Quiz';

export const metadata = { title: 'Map your palate' };

export default async function Onboarding() {
  const { supabase: sb, user } = await getUser();
  const [{ data: cats }, { data: attrs }, { data: wines }, { data: palate }] = await Promise.all([
    sb.from('attribute_categories').select('key,label,group_key,group_label,kind,description,sort').in('kind', ['aroma']).order('sort'),
    sb.from('attributes').select('key,label,category,kind').in('kind', ['aroma', 'texture', 'style']).order('sort'),
    sb.from('wines').select('id,name,producer,wine_type,region').order('producer'),
    sb.from('palates').select('quiz,display_name').eq('user_id', user!.id).maybeSingle(),
  ]);
  const data: QuizData = {
    categories: (cats ?? []).map((c) => ({
      ...c,
      examples: (attrs ?? []).filter((a) => a.category === c.key).slice(0, 4).map((a) => a.label),
    })),
    attributes: attrs ?? [],
    wines: wines ?? [],
    previous: palate?.quiz ?? null,
    name: palate?.display_name ?? null,
  };
  return (
    <div className="container page" style={{ maxWidth: 920 }}>
      <Quiz data={data} />
    </div>
  );
}
