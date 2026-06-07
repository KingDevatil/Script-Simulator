const app = () => document.getElementById('app');
let currentPage = null;
const routes = {};

export function register(name, renderFn) {
  routes[name] = renderFn;
}

export function navigate(name, params = {}) {
  if (currentPage && currentPage.destroy) currentPage.destroy();
  const container = app();
  container.innerHTML = '';
  const page = routes[name](container, params);
  currentPage = { destroy: page?.destroy || null };
}

export function getParams() {
  return currentPage?.params || {};
}
