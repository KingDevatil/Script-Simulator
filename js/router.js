const app = () => document.getElementById('app');
let currentPage = null;
const routes = {};
const editorPages = new Set(['scriptDetail']);

export function register(name, renderFn) {
  routes[name] = renderFn;
}

export function navigate(name, params = {}) {
  if (currentPage && currentPage.destroy) currentPage.destroy();
  const container = app();
  container.setAttribute('data-page', editorPages.has(name) ? 'editor' : 'phone');
  container.innerHTML = '';
  const page = routes[name](container, params);
  currentPage = { destroy: page?.destroy || null };
}

export function getParams() {
  return currentPage?.params || {};
}
