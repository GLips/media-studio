// main.tsx: the Studio Lab's page. Fonts load first, so every tab's stage sets Archivo and JetBrains Mono exactly as
// a render does.
import '#studio/fonts/fonts.ts';
import './lab.css';
import { createRoot } from 'react-dom/client';
import { StudioLab } from './StudioLab.tsx';

createRoot(document.getElementById('root')!).render(<StudioLab />);
