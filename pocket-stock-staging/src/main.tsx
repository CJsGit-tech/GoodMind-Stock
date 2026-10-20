import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ResearchFooterLayout } from './research-footer';
import './index.css';
import './loading.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ResearchFooterLayout><App /></ResearchFooterLayout>
    <div className="staging-environment-indicator" role="status">
      <span>PocketStocks · 本機 Staging</span>
    </div>
  </StrictMode>
);
