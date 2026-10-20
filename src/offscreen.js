import { AudioSession } from './session.js';

const session = new AudioSession();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'offscreen') return;
  let operation;
  switch (message.type) {
    case 'status': operation = Promise.resolve(session.status()); break;
    case 'prepare': operation = session.prepare(message.sessionId, message.tabId); break;
    case 'capture': operation = session.capture(message.sessionId, message.streamId); break;
    case 'fail': operation = session.fail(message.sessionId, message.message); break;
    case 'stop': operation = session.stop(); break;
    default: return;
  }
  operation.then(
    state => respond({ ok: true, state }),
    error => respond({ ok: false, state: session.status(), error: error.message }),
  );
  return true;
});
