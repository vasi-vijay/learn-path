import { createRoot } from 'react-dom/client';
import AdminPortal from './components/AdminPortal';
import './index.css';

const container = document.getElementById('admin-portal-root');
if (container) {
  createRoot(container).render(<AdminPortal />);
}
