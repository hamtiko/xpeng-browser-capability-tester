// Exercise the actual page script, including the automatic legacy bridge scan.
// No test hooks or executable native bridge mocks are added to the shipped page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function harness(configure = () => {}) {
  const elements = new Map();
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.value = ''; this.hidden = true; }
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return this.text || ''; }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    click() { if (this.listeners.click) this.listeners.click(); }
    getContext() { return null; }
    focus() { this.focused = true; }
    select() { this.selected = true; }
  }
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) elements.set(match[1], new Element());
  const links = [];
  const navigator = {
    userAgent: 'Mozilla/5.0 (Linux; Android 12; XPENG Xmart; wv) AppleWebKit/537.36 Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36',
    platform: 'Linux armv8l', vendor: 'Google Inc.', language: 'en-US', languages: ['en-US', 'hy'],
    hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 10
  };
  const sandbox = {
    navigator, document: {
      getElementById: id => elements.get(id) || null,
      createElement: () => new Element(),
      querySelectorAll: selector => selector === 'a[href], area[href]' ? links : [],
      referrer: ''
    },
    location: { href: 'https://example.test/xpeng/', protocol: 'https:' },
    screen: { width: 1920, height: 1080 }, innerWidth: 1920, innerHeight: 1080,
    console, setTimeout, clearTimeout
  };
  sandbox.window = sandbox;
  const context = { sandbox, navigator, elements, links };
  configure(context);
  vm.runInNewContext(script, sandbox, { timeout: 3000 });
  return {
    ...context,
    run() { elements.get('run-native').click(); elements.get('copy-full-report').click(); return JSON.parse(elements.get('native-full-report').value); }
  };
}

test('automatic scan and discovery do not evaluate unknown getters, coerce values, or call native methods', () => {
  let calls = 0;
  const blocked = () => { calls++; throw new Error('Must never be invoked'); };
  const host = harness(({ sandbox, navigator }) => {
    Object.defineProperty(sandbox, 'xpeng', { get: blocked });
    const bridge = Object.create(null);
    Object.defineProperties(bridge, {
      constructor: { get: blocked }, climate: { get: blocked },
      toString: { value: blocked }, toJSON: { value: blocked },
      invoke: { value: function invoke(action, args) { return blocked(); } },
      nested: { value: { get secret() { return blocked(); } } },
      scheme: { value: 'xpeng://diagnostics' }
    });
    sandbox.Android = bridge;
    navigator.carTelemetry = bridge;
    Object.defineProperty(navigator, 'vehicleState', { get: blocked });
    sandbox.vehicle = Object.create({ get speed() { return blocked(); }, openDoor: blocked });
    sandbox.webkit = { messageHandlers: { car: { postMessage: blocked } } };
  });
  assert.equal(calls, 0, 'legacy scan must be safe before discovery');
  const report = host.run();
  const data = report.nativeDiscovery;
  assert.equal(data.status, 'PASS');
  assert.equal(calls, 0, 'reflection and JSON serialization must never evaluate native objects');
  assert.equal(data.objects.find(o => o.name === 'xpeng').property.kind, 'accessor');
  const android = data.objects.find(o => o.name === 'Android');
  assert.equal(android.introspection.constructorName, '(accessor skipped)');
  assert.equal(android.introspection.own.properties.find(p => p.name === 'invoke').detail.declaredArgumentCount, 2);
  assert.deepEqual(data.webkit.handlerNames, ['car']);
  assert.equal(data.webkit.handlers[0].introspection.own.properties[0].name, 'postMessage');
  assert(data.customProtocols.observed.some(p => p.scheme === 'xpeng'));
  assert(data.navigator.nativeLookingProperties.includes('vehicleState'));
  assert(data.objects.find(o => o.name === 'vehicle').introspection.prototypes[0].properties.names.includes('openDoor'));
});

test('throwing reflection is isolated and records errors without evaluating thrown objects', () => {
  let calls = 0;
  const exception = Object.create(null, { message: { get() { calls++; throw 1; } }, toString: { value() { calls++; throw 1; } } });
  const host = harness(({ sandbox }) => {
    sandbox.Android = new Proxy({}, { ownKeys() { throw exception; }, getPrototypeOf() { throw new Error('host prototype denied'); } });
    sandbox.vehicle = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('descriptor denied'); } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke(); sandbox.Native = revoked.proxy;
    sandbox.xpeng = { harmless: 42 };
  });
  const data = host.run().nativeDiscovery;
  assert.equal(data.status, 'ERROR');
  assert(data.errors.some(e => e.message === 'host prototype denied'));
  assert(data.errors.some(e => e.path.includes('vehicle')));
  assert.equal(data.objects.find(o => o.name === 'xpeng').status, 'FOUND');
  assert.equal(calls, 0);
});

test('WebKit accessors and function metadata accessors remain unevaluated', () => {
  let calls = 0;
  const host = harness(({ sandbox }) => {
    const fn = function () {};
    Object.defineProperty(fn, 'name', { get() { calls++; return 'bad'; } });
    Object.defineProperty(fn, 'length', { get() { calls++; return 1; } });
    sandbox.JSBridge = fn;
    sandbox.webkit = { get messageHandlers() { calls++; return {}; } };
  });
  const data = host.run().nativeDiscovery;
  assert.equal(calls, 0);
  assert.match(data.webkit.note, /accessor; skipped/);
  assert.equal(data.objects.find(o => o.name === 'JSBridge').property.declaredArgumentCount, null);
});

test('report includes metadata, UA indicators, all required API flags, unknown globals and observed schemes', () => {
  const host = harness(({ sandbox, navigator, elements, links }) => {
    for (const key of ['bluetooth', 'usb', 'serial', 'hid', 'geolocation', 'mediaDevices', 'serviceWorker', 'clipboard', 'permissions']) Object.defineProperty(navigator, key, { get() { return {}; } });
    sandbox.someInjectedControl = { version: '1' };
    sandbox['native-title'] = elements.get('native-title');
    elements.set('car', {}); sandbox.car = { nativeProperty: 'value' }; // ID collision must not hide a bridge.
    for (const key of ['indexedDB', 'localStorage', 'sessionStorage']) sandbox[key] = {};
    for (const key of ['NDEFReader', 'DeviceOrientationEvent', 'DeviceMotionEvent', 'WebSocket']) sandbox[key] = function () { throw Error('Do not construct'); };
    links.push({ getAttribute: () => 'custom-car:diagnostics' }, { getAttribute: () => 'vehicle://settings' }, { getAttribute: () => 'https://ordinary.test' });
  });
  const report = host.run(), data = report.nativeDiscovery;
  assert(data.timestamp && data.url === 'https://example.test/xpeng/');
  assert.equal(data.userAgent, host.navigator.userAgent);
  assert.equal(data.navigator.values.vendor, 'Google Inc.');
  assert.deepEqual(data.navigator.values.languages, ['en-US', 'hy']);
  assert.equal(data.androidWebView.likelyAndroidWebView, true);
  assert.equal(data.androidWebView.reportedChromiumVersion, '108.0.5359.128');
  assert(data.potentialNativeGlobals.some(g => g.name === 'someInjectedControl'));
  assert(data.potentialNativeGlobals.some(g => g.name === 'car'));
  assert(!data.potentialNativeGlobals.some(g => g.name === 'native-title'));
  assert(!data.potentialNativeGlobals.some(g => g.name === 'Array'));
  assert.equal(data.deviceAPIs.length, 16);
  assert(data.deviceAPIs.every(api => api.status === 'FOUND'));
  assert.deepEqual(data.customProtocols.observed.map(p => p.scheme).sort(), ['custom-car', 'vehicle']);
  assert.equal(host.sandbox.location.href, 'https://example.test/xpeng/');
});

test('unknown navigator and storage getters are not invoked by discovery', () => {
  let calls = 0;
  const host = harness();
  for (const key of ['localStorage', 'sessionStorage', 'indexedDB']) Object.defineProperty(host.sandbox, key, { get() { calls++; throw Error('Must not read'); } });
  for (const key of ['bluetooth', 'usb', 'serial', 'hid', 'geolocation', 'mediaDevices', 'serviceWorker', 'permissions', 'xpengNative']) Object.defineProperty(host.navigator, key, { get() { calls++; throw Error('Must not read'); } });
  const data = host.run().nativeDiscovery;
  assert.equal(calls, 0);
  assert.equal(data.deviceAPIs.find(a => a.name === 'localStorage').status, 'FOUND');
  assert.equal(data.deviceAPIs.find(a => a.name === 'Web Serial').kind, 'accessor (not evaluated)');
});

test('full report preserves earlier capability data, handles clipboard rejection and rescans cleanly', async () => {
  const host = harness(({ navigator }) => { navigator.clipboard = { writeText: () => Promise.reject(new Error('denied')) }; });
  const report = host.run();
  await new Promise(resolve => setImmediate(resolve));
  assert(report.capabilities && report.environment && report.bridges && report.nativeDiscovery);
  assert.equal(host.elements.get('native-full-report').selected, true);
  assert.equal(host.elements.get('native-report-panel').hidden, false);
  host.sandbox.xpeng = { version: 1 };
  assert.equal(host.run().nativeDiscovery.objects.find(o => o.name === 'xpeng').status, 'FOUND');
  delete host.sandbox.xpeng;
  assert.equal(host.run().nativeDiscovery.objects.find(o => o.name === 'xpeng').status, 'NOT FOUND');
});

test('large and cyclic objects are bounded, and explicit bridges are prioritized', () => {
  const host = harness(({ sandbox }) => {
    for (let i = 0; i < 170; i++) sandbox['unknown' + i] = {};
    const bridge = {};
    for (let i = 0; i < 220; i++) bridge['property' + i] = i;
    bridge.self = bridge;
    sandbox.xpeng = bridge;
  });
  const data = host.run().nativeDiscovery;
  assert.equal(data.objects.length, 150);
  assert(data.omittedObjectDetails > 0);
  assert(data.globalNames.includes('unknown169'));
  const bridge = data.objects.find(o => o.name === 'xpeng');
  assert.equal(bridge.introspection.own.names.length, 221);
  assert.equal(bridge.introspection.own.properties.length, 180);
  assert.equal(bridge.introspection.own.omittedDetails, 41);
});
