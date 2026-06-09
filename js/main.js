import { init } from './db.js';
import { register, navigate } from './router.js';
import * as home from './pages/home.js';
import * as scriptDetail from './pages/script-detail.js';
import * as setup from './pages/setup.js';
import * as chat from './pages/chat.js';
import * as settings from './pages/settings.js';

(async () => {
  // Register pages
  register('home', home.render);
  register('scriptDetail', scriptDetail.render);
  register('setup', setup.render);
  register('chat', chat.render);
  register('settings', settings.render);

  // Init DB and start
  try {
    await init();
  } catch (e) {
    console.error('DB init failed:', e);
  }

  // Keep the local preview from getting stuck on an older bundled HTML.
  if ('serviceWorker' in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('/sw.js')
      .then(reg => reg.update())
      .catch(() => {});
  }

  navigate('home');

  // Global error handler
  window.onerror = (msg, url, line) => {
    console.error('Error:', msg, 'at', url, 'line', line);
  };
})();
