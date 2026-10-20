import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSession } from '../src/session.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(options = {}) {
  const events = [];
  const track = {
    readyState: 'live',
    stop() { events.push('stop'); this.readyState = 'ended'; },
    addEventListener(name, handler) { this[name] = handler; },
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const source = { connect() {}, disconnect() { events.push('disconnect'); } };
  const context = {
    sampleRate: options.sampleRate ?? 48000,
    state: 'suspended',
    audioWorklet: { addModule: () => options.modulePromise ?? Promise.resolve() },
    destination: {},
    createMediaStreamSource: () => source,
    resume: async () => { context.state = 'running'; },
    close: async () => { events.push('close'); if (options.closeError) throw Error('close failed'); context.state = 'closed'; },
  };
  const node = {
    connect() {},
    disconnect() {},
    port: { postMessage() {} },
  };
  let acquisitions = 0;
  const owner = new AudioSession({
    createContext: () => context,
    createNode: () => {
      if (!options.noReady) queueMicrotask(() => node.port.onmessage({ data: { type: 'ready' } }));
      return node;
    },
    getUserMedia: async constraints => {
      acquisitions++;
      assert.equal(constraints.audio.mandatory.chromeMediaSource, 'tab');
      assert.equal(constraints.video, false);
      return options.acquisition ?? stream;
    },
    timeout: 30,
  });
  return { owner, track, stream, context, node, events, acquisitions: () => acquisitions };
}

test('start, stop, and repeated stop release capture before closing audio', async () => {
  const { owner, events } = fixture();
  await owner.prepare('a', 1);
  assert.equal(owner.status().phase, 'starting');
  await owner.capture('a', 'token');
  assert.equal(owner.status().phase, 'running');
  await owner.stop();
  await owner.stop();
  assert.deepEqual(events, ['stop', 'disconnect', 'close']);
  assert.deepEqual(owner.status(), { phase: 'idle' });
});

test('readiness and rate failures happen before any capture', async () => {
  for (const configure of [() => ({ sampleRate: 44100 }), () => ({ noReady: true }), () => ({ modulePromise: Promise.reject(Error('module failure')) })]) {
    const options = configure();
    const { owner, acquisitions } = fixture(options);
    await assert.rejects(owner.prepare('a', 1));
    assert.equal(owner.status().phase, 'error');
    assert.equal(acquisitions(), 0);
  }
});

test('capture rejection releases prepared context and retains error', async () => {
  const acquisition = deferred();
  const { owner, events } = fixture({ acquisition: acquisition.promise });
  await owner.prepare('a', 1);
  const capturing = owner.capture('a', 'token');
  acquisition.reject(Error('capture rejected'));
  await assert.rejects(capturing, /capture rejected/);
  assert.deepEqual(events, ['close']);
  assert.equal(owner.status().message, 'capture rejected');
});

test('stop during capture stops late tracks and cannot revive the session', async () => {
  const acquisition = deferred();
  const { owner, stream, events } = fixture({ acquisition: acquisition.promise });
  await owner.prepare('a', 1);
  const capturing = owner.capture('a', 'token');
  const rejected = assert.rejects(capturing, /errorStartCancelled/);
  await owner.stop();
  acquisition.resolve(stream);
  await rejected;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(owner.status(), { phase: 'idle' });
  assert.equal(events.filter(event => event === 'stop').length, 1);
});

test('capture timeout stops a late stream', async () => {
  const acquisition = deferred();
  const { owner, stream, track } = fixture({ acquisition: acquisition.promise });
  await owner.prepare('a', 1);
  await assert.rejects(owner.capture('a', 'token'), /errorStartTimeout/);
  acquisition.resolve(stream);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(track.readyState, 'ended');
  assert.equal(owner.status().phase, 'error');
});

test('runtime errors, track end, and interrupted contexts release tracks despite close failure', async () => {
  for (const trigger of [
    f => f.node.onprocessorerror(),
    f => f.node.port.onmessage({ data: { type: 'error', message: 'wasm failure' } }),
    f => f.track.ended(),
    f => { f.context.state = 'suspended'; f.context.onstatechange(); },
  ]) {
    const f = fixture({ closeError: true });
    await f.owner.prepare('a', 1);
    await f.owner.capture('a', 'token');
    trigger(f);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.track.readyState, 'ended');
    assert.equal(f.owner.status().phase, 'error');
    assert.equal(f.events[0], 'stop');
  }
});

test('stale failures cannot stop a later session and duplicate prepare preserves the current session', async () => {
  const { owner } = fixture();
  await owner.prepare('a', 1);
  await assert.rejects(owner.prepare('b', 2), /errorTabBusy/);
  await owner.stop();
  await owner.prepare('b', 2);
  await owner.fail('a', 'stale event');
  assert.equal(owner.status().sessionId, 'b');
  await owner.stop();
});

test('stop interrupts a worklet that never becomes ready', async () => {
  const { owner } = fixture({ noReady: true });
  const preparing = owner.prepare('a', 1);
  const rejected = assert.rejects(preparing, /errorStartCancelled/);
  await owner.stop();
  await rejected;
  assert.deepEqual(owner.status(), { phase: 'idle' });
});
