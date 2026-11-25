import { LocaleProvider } from '../components/i18n';
import type { AppProps } from 'next/app';
import '../styles/global.css';
import '../styles/workspace-filters.css';
import '../styles/ux-refinement.css';
import '../styles/research.css';
import '../styles/question-research.css';

export default function App({ Component, pageProps }: AppProps) {
  return <LocaleProvider><Component {...pageProps} /></LocaleProvider>;
}
