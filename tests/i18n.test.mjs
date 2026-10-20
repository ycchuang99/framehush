import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('src/manifest.json'));
const html = await read('src/popup.html');
const popup = await read('src/popup.js');
const locales = Object.fromEntries(await Promise.all(['en', 'zh_TW', 'zh_CN'].map(async locale => [
  locale, JSON.parse(await read(`src/_locales/${locale}/messages.json`)),
])));
const flush = () => new Promise(resolve => setImmediate(resolve));

test('packaged locale catalogs cover manifest, popup, and audio errors with an English fallback', async () => {
  assert.equal(manifest.default_locale, 'en');
  assert(!html.includes('<footer>'));
  const keys = new Set([
    ...[...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map(match => match[1]),
    ...[...html.matchAll(/data-i18n="(\w+)"/g)].map(match => match[1]),
    ...['idle', 'starting', 'running', 'error'].flatMap(phase => [`status_${phase}`, `detail_${phase}`]),
    ...[...popup.matchAll(/['"]((?:uiLanguage|button\w+|statusStopping|detailStopping|error\w+))['"]/g)].map(match => match[1]),
  ]);
  for (const file of ['worker.js', 'session.js', 'denoise-worklet.js', 'frame-adapter.js']) {
    const source = await read(`src/${file}`);
    for (const [, key] of source.matchAll(/['"](error\w+)['"]/g)) keys.add(key);
  }
  for (const [locale, catalog] of Object.entries(locales)) {
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(locales.en).sort());
    for (const key of keys) assert(catalog[key]?.message, `${locale}: ${key} has a translation`);
    assert.deepEqual(JSON.parse(await read(`dist/_locales/${locale}/messages.json`)), catalog);
  }
});

for (const [locale, catalog] of Object.entries(locales)) {
  test(`${locale} localizes popup states, commands, and errors from the audio session`, async () => {
    const elements = {};
    const localized = [...html.matchAll(/<[^>]*data-i18n="(\w+)"[^>]*>/g)].map(([tag, key]) => {
      const element = { dataset: { i18n: key }, textContent: '', addEventListener: (type, fn) => { element[type] = fn; } };
      const id = tag.match(/id="(\w+)"/)?.[1];
      if (id) elements[id] = element;
      return element;
    });
    const document = {
      body: { dataset: {} },
      documentElement: {},
      querySelector: selector => elements[selector.slice(1)],
      querySelectorAll: () => localized,
    };
    let response = { ok: true, state: { phase: 'idle' } };
    let refresh;
    let failure;
    const requests = [];
    runInNewContext(popup, {
      document,
      chrome: {
        i18n: { getMessage: key => catalog[key]?.message ?? '' },
        tabs: { query: async () => [{ id: 7 }] },
        runtime: { sendMessage: async request => {
          requests.push(request);
          if (failure) throw failure;
          return response;
        } },
      },
      setInterval: callback => { refresh = callback; },
    });
    await flush();
    assert.equal(document.documentElement.lang, catalog.uiLanguage.message);
    for (const element of localized.filter(item => !Object.values(elements).includes(item))) {
      assert.equal(element.textContent, catalog[element.dataset.i18n].message);
    }
    assert.equal(elements.status.textContent, catalog.status_idle.message);
    assert.equal(elements.detail.textContent, catalog.detail_idle.message);
    assert.equal(elements.action.textContent, catalog.buttonStart.message);

    let resolveStart;
    response = new Promise(resolve => { resolveStart = resolve; });
    const starting = elements.action.click();
    await flush();
    assert.equal(elements.status.textContent, catalog.status_starting.message);
    assert.equal(elements.detail.textContent, catalog.detail_starting.message);
    assert.equal(elements.action.textContent, catalog.buttonStarting.message);
    assert.equal(elements.action.disabled, true);
    assert.equal(requests.at(-1).type, 'start');
    assert.equal(requests.at(-1).tabId, 7);
    resolveStart({ ok: true, state: { phase: 'running' } });
    await starting;
    assert.equal(elements.status.textContent, catalog.status_running.message);
    assert.equal(elements.detail.textContent, catalog.detail_running.message);
    assert.equal(elements.action.textContent, catalog.buttonStop.message);

    let resolveStop;
    response = new Promise(resolve => { resolveStop = resolve; });
    const stopping = elements.action.click();
    await flush();
    assert.equal(elements.status.textContent, catalog.statusStopping.message);
    assert.equal(elements.detail.textContent, catalog.detailStopping.message);
    assert.equal(elements.action.textContent, catalog.buttonStopping.message);
    assert.equal(requests.at(-1).type, 'stop');
    resolveStop({ ok: true, state: { phase: 'idle' } });
    await stopping;
    assert.equal(elements.action.textContent, catalog.buttonStart.message);

    response = { ok: true, state: { phase: 'error', message: 'errorAudioEnded' } };
    await refresh();
    assert.equal(elements.status.textContent, catalog.status_error.message);
    assert.equal(elements.detail.textContent, catalog.errorAudioEnded.message);

    response = { ok: false, state: { phase: 'running' }, error: 'errorTabBusy' };
    await elements.action.click();
    assert.equal(elements.detail.textContent, catalog.errorTabBusy.message);
    assert.equal(elements.action.textContent, catalog.buttonStop.message);

    failure = new Error('Unknown browser or library error');
    await elements.action.click();
    assert.equal(elements.detail.textContent, catalog.errorUnexpected.message);
    assert.equal(elements.action.disabled, false);
  });
}
