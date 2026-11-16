import { useEffect, useState } from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AlbumPage } from './components/AlbumPage.tsx';
import './index.css';

/** Личный альбом открывается ссылкой вида /#album=<токен>: тогда показываем только его, без сайта. */
function readAlbumToken(): string | null {
  const m = window.location.hash.match(/^#album=([A-Za-z0-9_-]{20,64})$/);
  return m ? m[1] : null;
}

function Root() {
  const [token, setToken] = useState<string | null>(readAlbumToken);
  useEffect(() => {
    const onChange = () => setToken(readAlbumToken());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return token ? <AlbumPage token={token} /> : <App />;
}

createRoot(document.getElementById('root')!).render(<Root />);
