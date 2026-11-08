import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/noto-sans-arabic/arabic-400.css';
import '@fontsource/noto-sans-arabic/arabic-600.css';
import '@fontsource/noto-sans-devanagari/devanagari-400.css';
import '@fontsource/noto-sans-devanagari/devanagari-600.css';
import './languages.css';
import {holdApprovalReturn, isNearLoginCallback} from './lib/near-login';

const search = window.location.search,
  callback = isNearLoginCallback(search);
// Remove authorization codes before loading other screens or their assets.
if (callback) window.history.replaceState(null, '', window.location.pathname);
if (callback && !holdApprovalReturn(search)) {
  void import('./lib/near-login-callback').then(({showNearLoginCallback}) => showNearLoginCallback(search));
} else {
  void import('./App').then(({default: App}) => {
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
}
