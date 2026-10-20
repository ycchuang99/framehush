import createModule from './vendor/rnnoise-sync.js';
import { FrameAdapter } from './frame-adapter.js';

class DenoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.adapter = null;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'dispose') {
        this.adapter?.dispose();
        this.adapter = null;
      }
    };
    try {
      if (sampleRate !== 48000) throw new Error('errorSampleRate');
      this.adapter = new FrameAdapter(createModule());
      this.port.postMessage({ type: 'ready' });
    } catch (error) {
      this.port.postMessage({ type: 'error', message: error.message });
    }
  }

  process(inputs, outputs) {
    if (!this.adapter) return false;
    try {
      this.adapter.process(inputs[0] ?? [], outputs[0]);
      return true;
    } catch (error) {
      this.adapter.dispose();
      this.adapter = null;
      this.port.postMessage({ type: 'error', message: error.message });
      return false;
    }
  }
}

registerProcessor('framehush-denoise', DenoiseProcessor);
