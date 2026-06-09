let host = null;

function ensureHost() {
  if (host && host.isConnected) return host;
  host = document.createElement('div');
  host.className = 'dialog-host';
  document.body.appendChild(host);
  return host;
}

function renderDialog({
  title = '提示',
  message = '',
  tone = 'default',
  confirmText = '确定',
  cancelText = '',
  dismissOnBackdrop = false
}) {
  const root = ensureHost();
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog-panel dialog-${tone}" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div class="dialog-body">
          <h3 id="dialog-title" class="dialog-title"></h3>
          <p class="dialog-message"></p>
        </div>
        <div class="dialog-actions">
          ${cancelText ? `<button class="btn btn-secondary dialog-cancel">${cancelText}</button>` : ''}
          <button class="btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'} dialog-confirm">${confirmText}</button>
        </div>
      </div>
    `;

    const titleEl = overlay.querySelector('.dialog-title');
    const messageEl = overlay.querySelector('.dialog-message');
    const confirmBtn = overlay.querySelector('.dialog-confirm');
    const cancelBtn = overlay.querySelector('.dialog-cancel');
    titleEl.textContent = title;
    messageEl.textContent = message;

    function close(result) {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      resolve(result);
    }

    function onKeydown(e) {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    }

    overlay.addEventListener('click', e => {
      if (dismissOnBackdrop && e.target === overlay) close(false);
    });
    confirmBtn.onclick = () => close(true);
    if (cancelBtn) cancelBtn.onclick = () => close(false);
    document.addEventListener('keydown', onKeydown);

    root.appendChild(overlay);
    (cancelBtn || confirmBtn).focus();
  });
}

export function showAlert(message, options = {}) {
  return renderDialog({
    title: options.title || '提示',
    message,
    tone: options.tone || 'default',
    confirmText: options.confirmText || '知道了',
    dismissOnBackdrop: options.dismissOnBackdrop ?? true
  });
}

export function showConfirm(message, options = {}) {
  return renderDialog({
    title: options.title || '请确认',
    message,
    tone: options.tone || 'default',
    confirmText: options.confirmText || '确认',
    cancelText: options.cancelText || '取消',
    dismissOnBackdrop: options.dismissOnBackdrop ?? true
  });
}
