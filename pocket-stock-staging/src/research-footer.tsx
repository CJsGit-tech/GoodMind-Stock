import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

const FooterVersion = createContext<Dispatch<SetStateAction<string>>>(() => {});
export function ResearchFooterLayout({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState('');
  return <FooterVersion.Provider value={setVersion}>
    {children}
    <footer className='site-research-footer' aria-label='研究內容提醒'>
      <span>研究內容由 AI 協助整理，可能包含錯誤，重要資訊請查證來源。</span>
      {version && <span className='site-footer-version'>{version}</span>}
    </footer>
  </FooterVersion.Provider>;
}
export function useFooterVersion(version: number | null | undefined, label = '文章版本', enabled = true) {
  const setVersion = useContext(FooterVersion);
  useEffect(() => {
    if (!enabled) return;
    setVersion(version ? `${label} v${version}` : '');
    return () => setVersion('');
  }, [setVersion, version, label, enabled]);
}
