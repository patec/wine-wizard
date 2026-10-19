import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-400-italic.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-500-italic.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-600-italic.css';
import '@fontsource/cormorant-garamond/latin-700.css';
import '@fontsource/cormorant-garamond/latin-ext-400.css';
import '@fontsource/cormorant-garamond/latin-ext-500.css';
import '@fontsource/cormorant-garamond/latin-ext-600.css';
import '@fontsource-variable/inter/index.css';
import './globals.css';
import { Header } from '@/components/Header';
import { getUser } from '@/lib/supabase/server';


export const metadata: Metadata = {
  title: { default: 'Wine Wizard — a cellar that knows your palate', template: '%s · Wine Wizard' },
  description: 'Personal wine recommendations from a 300-dimension map of aroma, structure and style.',
};
export const viewport: Viewport = {
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f6f1e7' }, { media: '(prefers-color-scheme: dark)', color: '#14100e' }],
};

const themeScript = `try{var t=localStorage.getItem('ww-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getUser();
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>
        <Header signedIn={!!user} />
        <main>{children}</main>
        <footer className="site-footer">
          <div className="container inner">
            <span><span className="display" style={{ fontSize: '1.1rem' }}>Wine <i>Wizard</i></span> — a cellar that knows your palate.</span>
            <span className="row" style={{ gap: 18 }}>
              <Link href="/lexicon">The lexicon</Link>
              <Link href="/cellar">The cellar</Link>
              <span className="faint">Prices are approximate US retail. Drink thoughtfully.</span>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
