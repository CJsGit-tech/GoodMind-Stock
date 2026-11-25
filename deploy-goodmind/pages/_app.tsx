import type { AppProps } from 'next/app';
import '../styles/galaxy.css';

export default function GoodMindApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
