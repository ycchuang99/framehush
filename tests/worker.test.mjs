import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let revision = 0;
async function fixture() {
  let listener;
  let documentExists = false;
  let state = { phase: 'idle' };
  const calls = [];
  globalThis.chrome = {
    runtime: {
      id: 'test',
      getURL: path => `chrome-extension://test/${path}`,
      getContexts: async () => documentExists ? [{}] : [],
      onMessage: { addListener: fn => { listener = fn; } },
      sendMessage: async message => {
        calls.push(message.type);
        if (message.type === 'prepare') state = { phase: 'starting', sessionId: message.sessionId, tabId: message.tabId };
        if (message.type === 'capture') state = { ...state, phase: 'running' };
        if (message.type === 'stop') state = { phase: 'idle' };
        if (message.type === 'fail') state = { phase: 'error', message: message.message };
        return { ok: true, state: { ...state } };
      },
    },
    offscreen: {
      createDocument: async options => { calls.push('create'); assert.deepEqual(options.reasons, ['USER_MEDIA']); documentExists = true; },
      closeDocument: async () => { calls.push('close'); documentExists = false; state = { phase: 'idle' }; },
    },
    tabCapture: { getMediaStreamId: async ({ targetTabId }) => { calls.push(`id:${targetTabId}`); return 'token'; } },
  };
  const reload = () => import(`../src/worker.js?revision=${revision++}`);
  await reload();
  const send = (type, tabId) => new Promise(resolve => listener({ target: 'worker', type, tabId }, { id: 'test' }, resolve));
  return { send, calls, reload, get listener() { return listener; } };
}

test('duplicate start captures once, a different tab cannot replace it, and restart discovers state', async () => {
  const f = await fixture();
  assert.equal((await f.send('status')).state.phase, 'idle');
  const [first, duplicate] = await Promise.all([f.send('start', 1), f.send('start', 1)]);
  assert.equal(first.state.phase, 'running');
  assert.equal(duplicate.state.phase, 'running');
  assert.equal(f.calls.filter(call => call === 'id:1').length, 1);
  assert(f.calls.indexOf('prepare') < f.calls.indexOf('id:1'));
  const busy = await f.send('start', 2);
  assert.equal(busy.ok, false);
  assert.equal(busy.state.tabId, 1);
  await f.reload();
  assert.equal((await f.send('status')).state.phase, 'running');
  assert.equal((await f.send('stop')).state.phase, 'idle');
  assert.equal((await f.send('stop')).state.phase, 'idle');
});

test('boundary rejects invalid tab IDs and ignores other contexts', async () => {
  const f = await fixture();
  assert.equal((await f.send('start', '1')).ok, false);
  assert.equal(f.calls.length, 0);
  let responded = false;
  assert.equal(f.listener({ target: 'offscreen', type: 'start' }, { id: 'test' }, () => { responded = true; }), undefined);
  assert.equal(f.listener({ target: 'worker', type: 'start' }, { id: 'other' }, () => { responded = true; }), undefined);
  assert.equal(responded, false);
});

test('stop cancels a start queued before document creation', async () => {
  const f = await fixture();
  const starting = f.send('start', 1);
  assert.equal((await f.send('stop')).state.phase, 'idle');
  await starting;
  assert(!f.calls.some(call => call.startsWith('id:')));
});

for (const command of ['status', 'start']) {
  test(`${command} releases an unresponsive document and allows a fresh start`, async () => {
    const f = await fixture();
    await f.send('start', 1);
    const sendMessage = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = message => message.type === 'status'
      ? Promise.reject(new Error('Receiving end does not exist.'))
      : sendMessage(message);
    const failed = await f.send(command, 1);
    assert.equal(failed.ok, false);
    assert.equal(failed.state.phase, 'error');
    assert.equal(f.calls.filter(call => call === 'close').length, 1);
    assert.equal((await f.send('status')).state.phase, 'idle');
    chrome.runtime.sendMessage = sendMessage;
    assert.equal((await f.send('start', 2)).state.tabId, 2);
    assert.equal(f.calls.filter(call => call === 'create').length, 2);
  });
}

test('a reported session error does not close a responsive document', async () => {
  const f = await fixture();
  await f.send('start', 1);
  await chrome.runtime.sendMessage({ type: 'fail', message: 'Device unavailable' });
  assert.equal((await f.send('status')).state.phase, 'error');
  assert.equal((await f.send('start', 2)).state.phase, 'running');
  assert(!f.calls.includes('close'));
  assert.equal(f.calls.filter(call => call === 'create').length, 1);
});

test('delayed status failure cannot close the next session after stop', async () => {
  const f = await fixture();
  await f.send('start', 1);
  const sendMessage = chrome.runtime.sendMessage;
  let rejectStatus;
  let statusRequested;
  const requested = new Promise(resolve => { statusRequested = resolve; });
  chrome.runtime.sendMessage = message => {
    if (message.type !== 'status') return sendMessage(message);
    statusRequested();
    return new Promise((resolve, reject) => { rejectStatus = reject; });
  };
  const checking = f.send('status');
  await requested;
  await f.send('stop');
  const starting = f.send('start', 2);
  chrome.runtime.sendMessage = sendMessage;
  rejectStatus(new Error('Timed out'));
  assert.equal((await checking).state.phase, 'error');
  assert.equal((await starting).state.phase, 'running');
  assert.equal((await f.send('status')).state.tabId, 2);
  assert.equal(f.calls.filter(call => call === 'close').length, 1);
});

test('built manifest has only explicit tab capture permissions and local code CSP', async () => {
  const manifest = JSON.parse(await readFile(new URL('../dist/manifest.json', import.meta.url)));
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'offscreen', 'tabCapture']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.match(manifest.content_security_policy.extension_pages, /'wasm-unsafe-eval'/);
  assert(!manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"));
});
