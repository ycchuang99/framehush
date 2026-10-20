export const FRAME_SIZE = 480;
export const PCM_SCALE = 32768;

export class FrameAdapter {
  constructor(module, channels = 2) {
    this.module = module;
    this.offset = 0;
    this.channels = [];
    try {
      for (let channel = 0; channel < channels; channel++) {
        const entry = { state: module._rnnoise_create(0), pointer: 0, output: new Float32Array(FRAME_SIZE) };
        this.channels.push(entry);
        entry.pointer = module._malloc(FRAME_SIZE * Float32Array.BYTES_PER_ELEMENT);
        if (!entry.state || !entry.pointer) throw new Error('errorMemory');
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  process(input, output) {
    for (let sample = 0; sample < output[0].length; sample++) {
      for (let channel = 0; channel < this.channels.length; channel++) {
        const entry = this.channels[channel];
        const source = input[channel] ?? input[0];
        output[channel][sample] = entry.output[this.offset];
        this.module.HEAPF32[entry.pointer / 4 + this.offset] = (source?.[sample] ?? 0) * PCM_SCALE;
      }
      if (++this.offset === FRAME_SIZE) {
        for (const entry of this.channels) {
          this.module._rnnoise_process_frame(entry.state, entry.pointer, entry.pointer);
          const heap = this.module.HEAPF32;
          for (let index = 0; index < FRAME_SIZE; index++) {
            const value = heap[entry.pointer / 4 + index] / PCM_SCALE;
            if (!Number.isFinite(value)) throw new Error('errorInvalidAudio');
            entry.output[index] = Math.max(-1, Math.min(1, value));
          }
        }
        this.offset = 0;
      }
    }
  }

  dispose() {
    for (const entry of this.channels) {
      if (entry.state) this.module._rnnoise_destroy(entry.state);
      if (entry.pointer) this.module._free(entry.pointer);
    }
    this.channels = [];
  }
}
