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
  return withTimeout(chrome.runtime.sendMessage({ target: 'offscreen', type, ...data }), 10000, 'errorProcessorTimeout');
}

async function status() {
  if (!await exists()) return { ok: true, state: { phase: 'idle' } };
  try {
    return await request('status');
  } catch {
    await chrome.offscreen.closeDocument();
    const message = 'errorProcessorUnresponsive';
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
    return { ok: false, state: current.state, error: 'errorTabBusy' };
  }
  const sessionId = crypto.randomUUID();
  try {
    const prepared = await request('prepare', { sessionId, tabId });
    if (!prepared.ok || prepared.state.sessionId !== sessionId || prepared.state.phase !== 'starting') return prepared;
    if (generation !== requestedGeneration) return status();
    const streamId = await withTimeout(chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }), 8000, 'errorCaptureTimeout');
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
    respond({ ok: false, state: { phase: 'error', message: 'errorNoTab' }, error: 'errorNoTab' });
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
