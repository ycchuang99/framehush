export function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

export class AudioSession {
  constructor({
    createContext = () => new AudioContext({ sampleRate: 48000 }),
    createNode = context => new AudioWorkletNode(context, 'framehush-denoise', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    }),
    getUserMedia = constraints => navigator.mediaDevices.getUserMedia(constraints),
    timeout = 8000,
  } = {}) {
    this.dependencies = { createContext, createNode, getUserMedia, timeout };
    this.current = null;
    this.state = { phase: 'idle' };
  }

  status() {
    return { ...this.state };
  }

  async wait(session, operation) {
    const result = await withTimeout(
      Promise.race([operation, session.cancelled]),
      this.dependencies.timeout,
      'errorStartTimeout',
    );
    if (this.current !== session) throw new Error('errorStartCancelled');
    return result;
  }

  async prepare(sessionId, tabId) {
    if (this.current) throw new Error('errorTabBusy');
    const session = { sessionId, tabId };
    session.cancelled = new Promise((_, reject) => { session.cancel = reject; });
    session.cancelled.catch(() => {});
    this.current = session;
    this.state = { phase: 'starting', sessionId, tabId };
    try {
      session.context = this.dependencies.createContext();
      if (session.context.sampleRate !== 48000) throw new Error('errorSampleRate');
      await this.wait(session, session.context.audioWorklet.addModule('denoise-worklet.js'));
      session.node = this.dependencies.createNode(session.context);
      await this.wait(session, new Promise((resolve, reject) => {
        session.node.onprocessorerror = () => reject(new Error('errorProcessorStart'));
        session.node.port.onmessage = ({ data }) => {
          if (data.type === 'ready') resolve();
          if (data.type === 'error') reject(new Error(data.message));
        };
      }));
      session.node.onprocessorerror = () => { void this.fail(sessionId, 'errorProcessorInterrupted'); };
      session.node.port.onmessage = ({ data }) => {
        if (data.type === 'error') void this.fail(sessionId, data.message);
      };
      return this.status();
    } catch (error) {
      await this.fail(sessionId, error.message);
      throw error;
    }
  }

  async capture(sessionId, streamId) {
    const session = this.current;
    if (!session || session.sessionId !== sessionId) throw new Error('errorStartCancelled');
    try {
      const acquisition = this.dependencies.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
        video: false,
      }).then(stream => {
        if (this.current !== session) {
          for (const track of stream.getTracks()) track.stop();
          throw new Error('errorStartCancelled');
        }
        session.stream = stream;
        return stream;
      });
      const stream = await this.wait(session, acquisition);
      if (!stream.getAudioTracks().length) throw new Error('errorNoAudio');
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => { void this.fail(sessionId, 'errorAudioEnded'); });
        if (track.readyState === 'ended') throw new Error('errorAudioEnded');
      }
      session.source = session.context.createMediaStreamSource(stream);
      session.source.connect(session.node);
      session.node.connect(session.context.destination);
      await this.wait(session, session.context.resume());
      if (session.context.state !== 'running') throw new Error('errorPlaybackStart');
      session.context.onstatechange = () => {
        if (session.context.state !== 'running') void this.fail(sessionId, 'errorPlaybackInterrupted');
      };
      this.state = { phase: 'running', sessionId, tabId: session.tabId };
      return this.status();
    } catch (error) {
      await this.fail(sessionId, error.message);
      throw error;
    }
  }

  async release(state) {
    const session = this.current;
    this.current = null;
    this.state = state;
    if (!session) return this.status();
    // Release capture first so failed audio cleanup cannot leave the tab muted.
    for (const track of session.stream?.getTracks() ?? []) {
      try { track.stop(); } catch {}
    }
    session.cancel(new Error('errorStartCancelled'));
    if (session.context) session.context.onstatechange = null;
    if (session.node) {
      session.node.onprocessorerror = null;
      session.node.port.onmessage = null;
    }
    try { session.source?.disconnect(); } catch {}
    try { session.node?.port.postMessage({ type: 'dispose' }); } catch {}
    try { session.node?.disconnect(); } catch {}
    try {
      if (session.context) await withTimeout(session.context.close(), 1000, 'errorCloseTimeout');
    } catch {}
    return this.status();
  }

  async fail(sessionId, message) {
    if (this.current?.sessionId !== sessionId) return this.status();
    return this.release({ phase: 'error', message });
  }

  stop() {
    return this.release({ phase: 'idle' });
  }
}
