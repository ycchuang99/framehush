import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import createModule from '../dist/vendor/rnnoise-sync.js';
import { FrameAdapter, FRAME_SIZE } from '../src/frame-adapter.js';

function render(adapter, channels, sizes = [64, 128, 256, 1024, 97]) {
  const output = channels.map(channel => new Float32Array(channel.length));
  let position = 0;
  let block = 0;
  while (position < channels[0].length) {
    const count = Math.min(sizes[block++ % sizes.length], channels[0].length - position);
    adapter.process(
      channels.map(channel => channel.subarray(position, position + count)),
      output.map(channel => channel.subarray(position, position + count)),
    );
    position += count;
  }
  return output;
}

test('frame adapter preserves stereo order with exactly 480 samples of delay across variable blocks', () => {
  let pointer = 4;
  let states = 0;
  const processed = [];
  const destroyed = [];
  const freed = [];
  const module = {
    HEAPF32: new Float32Array(2000),
    _malloc: bytes => { const address = pointer; pointer += bytes; return address; },
    _rnnoise_create: () => ++states,
    _rnnoise_process_frame: (state, address) => { processed.push([state, module.HEAPF32[address / 4]]); },
    _rnnoise_destroy: state => destroyed.push(state),
    _free: address => freed.push(address),
  };
  const adapter = new FrameAdapter(module);
  const left = Float32Array.from({ length: 5000 }, (_, i) => (i % 100 + 1) / 128);
  const right = Float32Array.from(left, value => -value);
  const output = render(adapter, [left, right]);
  for (let channel = 0; channel < 2; channel++) {
    assert(output[channel].subarray(0, FRAME_SIZE).every(value => value === 0));
    assert.deepEqual(output[channel].subarray(FRAME_SIZE), [left, right][channel].subarray(0, 5000 - FRAME_SIZE));
  }
  assert.equal(processed.length, 20);
  assert.equal(processed[0][1], left[0] * 32768);
  assert.equal(processed[1][1], right[0] * 32768);
  adapter.dispose();
  adapter.dispose();
  assert.deepEqual(destroyed, [1, 2]);
  assert.equal(freed.length, 2);
});

test('real RNNoise suppresses deterministic background noise and retains speech energy', async () => {
  const wav = await readFile(new URL('./fixtures/speech.wav', import.meta.url));
  let cursor = 12;
  let pcm;
  while (cursor + 8 <= wav.length) {
    const length = wav.readUInt32LE(cursor + 4);
    const type = wav.toString('ascii', cursor, cursor + 4);
    if (type === 'fmt ') {
      assert.equal(wav.readUInt16LE(cursor + 8), 1);
      assert.equal(wav.readUInt16LE(cursor + 10), 1);
      assert.equal(wav.readUInt32LE(cursor + 12), 48000);
      assert.equal(wav.readUInt16LE(cursor + 22), 16);
    }
    if (type === 'data') pcm = wav.subarray(cursor + 8, cursor + 8 + length);
    cursor += 8 + length + (length % 2);
  }
  assert(pcm);
  const prelude = 48000 * 2;
  const input = new Float32Array(prelude + pcm.length / 2 + 48000);
  const reference = new Float32Array(input.length);
  let seed = 17;
  for (let i = 0; i < input.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    input[i] = (seed / 4294967296 * 2 - 1) * 0.035;
  }
  for (let i = 0; i < pcm.length / 2; i++) {
    reference[prelude + i] = pcm.readInt16LE(i * 2) / 32768;
    input[prelude + i] += reference[prelude + i];
  }
  const module = createModule();
  const adapter = new FrameAdapter(module);
  const [left, right] = render(adapter, [input, new Float32Array(input.length)]);
  adapter.dispose();
  assert(left.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
  const energy = (values, start, end) => values.subarray(start, end).reduce((sum, value) => sum + value * value, 0) / (end - start);
  const inputNoise = energy(input, 48000, prelude);
  const outputNoise = energy(left, 48000, prelude);
  assert(outputNoise < inputNoise * 0.25, `background energy ratio ${outputNoise / inputNoise}`);
  assert(energy(left, prelude + 4800, input.length - 48000) > energy(reference, prelude + 4800, input.length - 48000) * 0.08);
  assert(energy(right, 48000, input.length) < 1e-10, 'independent right channel must stay silent');
  let bestCorrelation = 0;
  for (let lag = 0; lag <= 1920; lag += 120) {
    let dot = 0;
    let cleanPower = 0;
    let outputPower = 0;
    for (let i = prelude; i < reference.length - 48000; i += 4) {
      dot += reference[i] * left[i + lag];
      cleanPower += reference[i] ** 2;
      outputPower += left[i + lag] ** 2;
    }
    bestCorrelation = Math.max(bestCorrelation, dot / Math.sqrt(cleanPower * outputPower));
  }
  assert(bestCorrelation > 0.35, `speech correlation ${bestCorrelation}`);
});

test('worklet ready handshake initializes actual WASM and reports invalid sample rates', async () => {
  let Processor;
  globalThis.AudioWorkletProcessor = class {
    constructor() { this.messages = []; this.port = { postMessage: data => this.messages.push(data) }; }
  };
  globalThis.registerProcessor = (_, constructor) => { Processor = constructor; };
  globalThis.sampleRate = 48000;
  await import('../dist/denoise-worklet.js');
  const processor = new Processor();
  assert.deepEqual(processor.messages, [{ type: 'ready' }]);
  assert.equal(processor.process([[new Float32Array(128)]], [[new Float32Array(128), new Float32Array(128)]]), true);
  processor.port.onmessage({ data: { type: 'dispose' } });
  assert.equal(processor.process([], []), false);
  globalThis.sampleRate = 44100;
  assert.equal(new Processor().messages[0].type, 'error');
});
