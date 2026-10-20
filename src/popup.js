const button = document.querySelector('#action');
const statusText = document.querySelector('#status');
const detail = document.querySelector('#detail');
const message = key => chrome.i18n.getMessage(key);
document.documentElement.lang = message('uiLanguage');
for (const element of document.querySelectorAll('[data-i18n]')) {
  element.textContent = message(element.dataset.i18n);
}
let state = { phase: 'idle' };
let pending = false;
let commandError = '';

function render(result) {
  state = result.state;
  document.body.dataset.phase = state.phase;
  const active = state.phase === 'running' || state.phase === 'starting';
  statusText.textContent = message(`status_${state.phase}`);
  const error = commandError || result.error || state.message;
  detail.textContent = error
    ? message(error) || message('errorUnexpected')
    : message(`detail_${state.phase}`);
  button.textContent = message(active ? 'buttonStop' : 'buttonStart');
  button.disabled = pending;
}

async function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ target: 'worker', type, ...extra });
}

async function refresh() {
  if (pending) return;
  try { render(await send('status')); }
  catch (error) { render({ state: { phase: 'error', message: error.message } }); }
}

button.addEventListener('click', async () => {
  pending = true;
  commandError = '';
  button.disabled = true;
  try {
    const active = state.phase === 'running' || state.phase === 'starting';
    const [tab] = active ? [] : await chrome.tabs.query({ active: true, currentWindow: true });
    statusText.textContent = message(active ? 'statusStopping' : 'status_starting');
    detail.textContent = message(active ? 'detailStopping' : 'detail_starting');
    button.textContent = message(active ? 'buttonStopping' : 'buttonStarting');
    const result = await send(active ? 'stop' : 'start', active ? {} : { tabId: tab?.id });
    commandError = result.ok ? '' : result.error;
    pending = false;
    render(result);
  } catch (error) {
    pending = false;
    commandError = error.message;
    render({ state: { phase: 'error', message: error.message } });
  }
});

void refresh();
setInterval(refresh, 750);
