import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Explore from './pages/Explore';
import Workspace from './pages/Workspace';
import DocsPage from './pages/DocsPage';
import { Navigate } from 'react-router-dom';
import './i18n';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Explore />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/workspace" element={<Workspace />} />{/* admin only: sign-in required */}
        <Route path="/query" element={<Navigate to="/" replace />} />{/* query now lives in the research assistant (⚙) */}
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
