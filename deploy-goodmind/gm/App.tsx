import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import './i18n';
import Explore from './pages/Explore';
import Workspace from './pages/Workspace';
import DocsPage from './pages/DocsPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Explore />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/workspace" element={<Workspace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
