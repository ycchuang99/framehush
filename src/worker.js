import { withTimeout } from './session.js';

let queue = Promise.resolve();
let creating;
let generation = 0;
const offscreenURL = chrome.runtime.getURL('offscreen.html');

async function exists() {
  return (await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenURL],
  })).length > 0;
}

async function ensureOffscreen() {
  if (await exists()) return;
  creating ??= chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Process user-selected tab audio locally with RNNoise.',
  }).finally(() => { creating = null; });
  await creating;
}

function request(type, data = {}) {
  return withTimeout(chrome.runtime.sendMessage({ target: 'offscreen', type, ...data }), 10000, '音訊處理未回應，請按停止後重試。');
}

async function status() {
  if (!await exists()) return { ok: true, state: { phase: 'idle' } };
  try {
    return await request('status');
  } catch {
    await chrome.offscreen.closeDocument();
    const message = '音訊處理未回應，已停止降噪，請重新啟用。';
    return { ok: false, state: { phase: 'error', message }, error: message };
  }
}

async function start(tabId, requestedGeneration) {
  if (generation !== requestedGeneration) return status();
  await ensureOffscreen();
  if (generation !== requestedGeneration) return status();
  const current = await status();
  if (!current.ok) return current;
  if (generation !== requestedGeneration) return status();
  if (current.state.phase === 'running' && current.state.tabId === tabId) return current;
  if (current.state.phase === 'running' || current.state.phase === 'starting') {
    return { ok: false, state: current.state, error: '已有分頁正在降噪，請先停止再切換。' };
  }
  const sessionId = crypto.randomUUID();
  try {
    const prepared = await request('prepare', { sessionId, tabId });
    if (!prepared.ok || prepared.state.sessionId !== sessionId || prepared.state.phase !== 'starting') return prepared;
    if (generation !== requestedGeneration) return status();
    const streamId = await withTimeout(chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }), 8000, '分頁音訊授權逾時。');
    return await request('capture', { sessionId, streamId });
  } catch (error) {
    const failed = await request('fail', { sessionId, message: error.message });
    return { ok: false, state: failed.state, error: error.message };
  }
}

async function stop() {
  if (creating) await creating;
  if (!await exists()) return { ok: true, state: { phase: 'idle' } };
  try {
    return await request('stop');
  } catch {
    await chrome.offscreen.closeDocument();
    return { ok: true, state: { phase: 'idle' } };
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'worker') return;
  if (!['status', 'start', 'stop'].includes(message.type)) return;
  if (message.type === 'start' && (!Number.isInteger(message.tabId) || message.tabId < 0)) {
    respond({ ok: false, state: { phase: 'error', message: '找不到目前分頁。' }, error: '找不到目前分頁。' });
    return;
  }
  if (message.type === 'stop') generation++;
  const requestedGeneration = generation;
  const operation = message.type === 'stop' ? stop()
    : queue.then(() => message.type === 'status' ? status() : start(message.tabId, requestedGeneration));
  queue = message.type === 'stop' ? Promise.allSettled([queue, operation]) : operation.catch(() => {});
  operation.then(respond, error => respond({
    ok: false, state: { phase: 'error', message: error.message }, error: error.message,
  }));
  return true;
});
