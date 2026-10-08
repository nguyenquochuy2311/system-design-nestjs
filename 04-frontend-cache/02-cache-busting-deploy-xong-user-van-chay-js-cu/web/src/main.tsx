import { createRoot } from 'react-dom/client';
import { App } from './app';
import { installChunkErrorHandler } from './sau/chunk-error-handler';
import { startVersionCheck } from './sau/version-check';
import './styles.css';

window.__APP__ = { version: __RELEASE__, site: __SITE__ };

// __SITE__ là hằng số lúc build: bản trước không chứa hai module này trong bundle.
if (__SITE__ === 'sau') {
  installChunkErrorHandler();
  startVersionCheck();
}

createRoot(document.getElementById('root')!).render(<App />);
