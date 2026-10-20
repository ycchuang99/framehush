const button = document.querySelector('#action');
const statusText = document.querySelector('#status');
const detail = document.querySelector('#detail');
let state = { phase: 'idle' };
let pending = false;
let commandError = '';

function render(result) {
  state = result.state;
  document.body.dataset.phase = state.phase;
  const active = state.phase === 'running' || state.phase === 'starting';
  statusText.textContent = ({
    idle: '讓人聲更清楚',
    starting: '正在準備降噪',
    running: '降噪已開啟',
    error: '降噪已停止',
  })[state.phase];
  detail.textContent = commandError || result.error || state.message || ({
    idle: '播放影片後，啟用目前分頁的降噪。',
    starting: '正在載入裝置上的音訊處理器。',
    running: '正在處理已啟用分頁的聲音。關閉此面板後仍會繼續。',
    error: '請重新啟用，或換一個有聲音的分頁。',
  })[state.phase];
  button.textContent = active ? '停止降噪' : '啟用降噪';
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
    statusText.textContent = active ? '正在停止降噪' : '正在準備降噪';
    detail.textContent = active ? '正在釋放分頁音訊。' : '正在載入裝置上的音訊處理器。';
    button.textContent = active ? '正在停止' : '正在啟用';
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
