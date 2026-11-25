import dynamic from 'next/dynamic';
import Head from 'next/head';

// three.js needs the browser, so the app renders client-side only.
const App = dynamic(() => import('../gm/App'), { ssr: false, loading: () => <div className="fullscreen-msg"><div className="orb" /><p>載入知識圖譜…</p></div> });

export default function Page() {
  if (typeof window !== 'undefined' && !window.location.hash) window.location.replace('#/docs');
  return (
    <>
      <Head><title>股脈 GoodMind · 產業知識圖譜</title></Head>
      <App />
    </>
  );
}
