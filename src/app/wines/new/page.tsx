import { supabaseServer } from '@/lib/supabase/server';
import { AddWineForm } from './AddWineForm';

export const metadata = { title: 'Add a wine' };

export default async function NewWine() {
  const sb = await supabaseServer();
  const [{ data: attrs }, { data: cats }] = await Promise.all([
    sb.from('attributes').select('id,key,label,category,kind,scale_labels,sort').order('sort'),
    sb.from('attribute_categories').select('key,label,group_label,kind,sort').order('sort'),
  ]);
  return (
    <div className="container page" style={{ maxWidth: 980 }}>
      <header className="page-head">
        <div className="eyebrow">Add to the cellar</div>
        <h1 style={{ marginTop: 10 }}>Profile a bottle</h1>
        <p className="lede">Describe it as you would in a tasting note. Every note you add becomes a dimension of its vector — the more precise, the better it will be matched.</p>
      </header>
      <AddWineForm attrs={attrs ?? []} cats={cats ?? []} />
    </div>
  );
}
