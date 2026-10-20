import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const profile = await mkdtemp(join(tmpdir(), "framehush-browser-"));
const results = [];
const output = resolve(root, "verification");
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  const name = request.url === "/speech.wav" ? "speech.wav" : "player.html";
  try {
    const data = await readFile(resolve(root, "tests/fixtures", name));
    response.setHeader("Content-Type", name.endsWith(".wav") ? "audio/wav" : "text/html");
    response.end(data);
  } catch (error) {
    response.writeHead(500);
    response.end(error.message);
  }
});
server.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;

async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}

function passed(name, detail) {
  results.push({ name, status: "PASS", detail });
  console.log(`PASS ${name}`);
}

async function attach(cdp, targetId) {
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: false });
  let sequence = 0;
  const pending = new Map();
  const listener = (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  cdp.on("Target.receivedMessageFromTarget", listener);
  async function call(method, params = {}) {
    const id = ++sequence;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
    });
    await cdp.send("Target.sendMessageToTarget", {
      sessionId,
      message: JSON.stringify({ id, method, params }),
    });
    return promise;
  }
  return {
    call,
    async evaluate(expression) {
      const response = await call("Runtime.evaluate", {
        expression, returnByValue: true, awaitPromise: true, userGesture: true,
      });
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      }
      return response.result.value;
    },
    async close() {
      cdp.off("Target.receivedMessageFromTarget", listener);
      await cdp.send("Target.detachFromTarget", { sessionId }).catch(() => {});
    },
  };
}

try {
  const extension = join(profile, "extension");
  await cp(resolve(root, "dist"), extension, { recursive: true });
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROME_PATH || undefined,
    headless: process.env.HEADED !== "1",
    ignoreDefaultArgs: ["--disable-extensions", "--mute-audio"],
    args: [
      "--enable-unsafe-extension-debugging",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).hostname;
  const cdp = await context.browser().newBrowserCDPSession();
  const page = context.pages()[0];
  await page.goto(origin);
  await page.locator("#play").click();
  await page.waitForFunction(() => window.fixture && !window.fixture.video.paused);
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/popup.html?status-probe`);
  await context.setOffline(true);
  const command = (type) => control.evaluate(
    (type) => chrome.runtime.sendMessage({ target: "worker", type }), type,
  );
  const captured = () => control.evaluate(() => chrome.tabCapture.getCapturedTabs());
  const targets = async () => (await cdp.send("Target.getTargets", {
    filter: [{ exclude: false }],
  })).targetInfos;
  const status = async () => (await command("status")).state;

  async function popupFor(tab) {
    await tab.bringToFront();
    const target = (await targets()).find((target) => target.type === "tab" && target.url === tab.url());
    assert(target, "the player has a real browser tab target");
    await cdp.send("Extensions.triggerAction", { id, targetId: target.targetId });
    const popup = await until(async () => (await targets()).find(
      (target) => target.url === `chrome-extension://${id}/popup.html`,
    ), "real extension popup");
    const remote = await attach(cdp, popup.targetId);
    await until(() => remote.evaluate("!!document.querySelector('#action')"), "popup controls");
    return {
      ...remote,
      async clickAction() {
        await until(() => remote.evaluate("!document.querySelector('#action').disabled"), "enabled action");
        const point = await remote.evaluate(`(() => {
          const box = document.querySelector('#action').getBoundingClientRect();
          return {x: box.x + box.width / 2, y: box.y + box.height / 2};
        })()`);
        await remote.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
        await remote.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
      },
      async screenshot(name) {
        const shot = await remote.call("Page.captureScreenshot");
        await writeFile(resolve(output, name), Buffer.from(shot.data, "base64"));
      },
      async dismiss() {
        await remote.close();
        await cdp.send("Target.closeTarget", { targetId: popup.targetId });
      },
    };
  }

  let popup = await popupFor(page);
  assert.equal((await status()).phase, "idle");
  await popup.screenshot("popup-idle.png");
  await popup.clickAction();
  await until(async () => (await status()).phase === "running", "running capture");
  assert.equal((await captured()).filter((tab) => tab.status === "active").length, 1);
  await popup.screenshot("popup-running.png");
  passed("real popup starts a captured tab", { browser: context.browser().version() });
  await popup.dismiss();
  assert.equal((await status()).phase, "running");
  passed("processing survives popup closure");

  const offscreenTarget = await until(async () => (await targets()).find(
    (target) => target.url === `chrome-extension://${id}/offscreen.html`,
  ), "offscreen audio document");
  const offscreen = await attach(cdp, offscreenTarget.targetId);
  const prototype = await offscreen.call("Runtime.evaluate", { expression: "AudioWorkletNode.prototype" });
  const nodes = await offscreen.call("Runtime.queryObjects", { prototypeObjectId: prototype.result.objectId });
  const sourcePrototype = await offscreen.call("Runtime.evaluate", { expression: "MediaStreamAudioSourceNode.prototype" });
  const sources = await offscreen.call("Runtime.queryObjects", { prototypeObjectId: sourcePrototype.result.objectId });
  const probe = await offscreen.call("Runtime.callFunctionOn", {
    objectId: nodes.objects.objectId,
    arguments: [{ objectId: sources.objects.objectId }],
    functionDeclaration: `async function(sources) {
      const node = this[0];
      if (!node) throw new Error('No actual worklet node');
      const analyser = node.context.createAnalyser();
      const input = node.context.createAnalyser();
      analyser.fftSize = 2048;
      input.fftSize = 2048;
      node.connect(analyser);
      sources[0].connect(input);
      const data = new Float32Array(2048);
      const raw = new Float32Array(2048);
      let energy = 0, inputEnergy = 0, peak = 0, finite = true;
      for (let i = 0; i < 150; i++) {
        await new Promise(resolve => setTimeout(resolve, 20));
        analyser.getFloatTimeDomainData(data);
        input.getFloatTimeDomainData(raw);
        for (const sample of raw) inputEnergy += sample * sample;
        for (const sample of data) {
          energy += sample * sample;
          peak = Math.max(peak, Math.abs(sample));
          finite &&= Number.isFinite(sample);
        }
      }
      node.disconnect(analyser);
      sources[0].disconnect(input);
      return {energy, inputEnergy, peak, finite, sampleRate: node.context.sampleRate, state: node.context.state};
    }`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert(!probe.exceptionDetails, JSON.stringify(probe.exceptionDetails));
  console.log("Audio probe", JSON.stringify(probe.result.value));
  assert(probe.result.value.energy > 0.01, "actual denoised playback is not silent");
  assert(probe.result.value.finite && probe.result.value.peak <= 1.1, "output is finite and bounded");
  assert.equal(probe.result.value.sampleRate, 48000);
  assert.equal(probe.result.value.state, "running");
  passed("actual RNNoise worklet emits nonzero finite audio", probe.result.value);
  passed("startup and processing work without network access");

  const workerDebugger = await context.newCDPSession(control);
  const versions = new Map();
  const workerEvents = [];
  workerDebugger.on("ServiceWorker.workerVersionUpdated", ({ versions: updates }) => {
    for (const version of updates) {
      versions.set(version.versionId, version);
      workerEvents.push(version);
    }
  });
  await workerDebugger.send("ServiceWorker.enable");
  const version = await until(() => [...versions.values()].find(
    (version) => version.scriptURL === worker.url() && version.runningStatus === "running",
  ), "running service worker version");
  workerEvents.length = 0;
  await workerDebugger.send("ServiceWorker.stopWorker", { versionId: version.versionId });
  await until(() => workerEvents.some(
    (event) => event.versionId === version.versionId && event.runningStatus === "stopped",
  ), "service worker stops");
  assert.equal((await status()).phase, "running");
  assert.equal((await captured()).filter((tab) => tab.status === "active").length, 1);
  passed("worker restart reconstructs the live audio session");
  await workerDebugger.detach();

  await context.setOffline(false);
  const other = await context.newPage();
  await other.goto(`${origin}/other`);
  popup = await popupFor(other);
  assert.equal((await status()).phase, "running");
  await popup.clickAction();
  await until(async () => (await status()).phase === "idle", "stop from another tab");
  assert.equal((await captured()).filter((tab) => tab.status === "active").length, 0);
  assert(await page.evaluate(() => !document.querySelector("video").paused));
  passed("stop from another tab releases capture while video keeps playing");
  await popup.dismiss();
  await other.close();

  await offscreen.evaluate(`(() => {
    window.originalWorklet = AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource = function() { throw new Error('Injected graph failure'); };
  })()`);
  popup = await popupFor(page);
  await popup.clickAction();
  await until(async () => (await status()).phase === "error", "injected graph failure");
  assert.equal((await captured()).filter((tab) => tab.status === "active").length, 0);
  assert(await page.evaluate(() => !document.querySelector("video").paused));
  passed("failure after acquisition releases capture and reports an error");
  await popup.screenshot("popup-error.png");
  await popup.dismiss();
  await offscreen.evaluate("AudioContext.prototype.createMediaStreamSource = window.originalWorklet; delete window.originalWorklet;");

  popup = await popupFor(page);
  await popup.clickAction();
  await until(async () => (await status()).phase === "running", "restart capture");
  await popup.dismiss();
  await page.evaluate(() => document.querySelector("video").pause());
  await delay(32000);
  assert.equal((await status()).phase, "running");
  await page.evaluate(() => document.querySelector("video").play());
  passed("pause beyond 30 seconds retains the audio session");

  await page.goto(`${origin}/navigated`);
  await page.locator("#play").click();
  await page.waitForFunction(() => window.fixture && !window.fixture.video.paused);
  assert.equal((await status()).phase, "running");
  passed("capture survives navigation within its tab");
  await page.close();
  await until(async () => (await status()).phase !== "running", "closed captured tab releases session");
  assert.equal((await captured()).filter((tab) => tab.status === "active").length, 0);
  passed("closing captured tab releases the session");
  await offscreen.close();
} catch (error) {
  results.push({ name: "browser run", status: "FAIL", detail: error.stack });
  throw error;
} finally {
  await writeFile(resolve(output, "browser-results.json"), JSON.stringify({
    checkedAt: new Date().toISOString(),
    results,
    limitations: [
      "Graph output and capture release are observed. Physical speaker playback is not recorded.",
      "Speech intelligibility, perceived audio/video delay, and DRM websites need listening tests.",
    ],
  }, null, 2));
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
