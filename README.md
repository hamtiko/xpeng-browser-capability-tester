# XPeng Browser Capability Tester

Single-file browser diagnostics, hosted at <https://hamtiko.github.io/xpeng-browser-capability-tester/>. No build step or external JavaScript dependencies.

## Native API discovery

Open the page in the car browser, select **Run XPENG Discovery**, and then **Copy Full Report**. A selectable JSON field appears as a fallback when clipboard access is unavailable. The existing **Export JSON** and **Copy JSON** controls also include discovery results after a run.

The added group preserves the original layout and reports:

- Every own global name, explicit bridge-name checks, and anomalies against a versioned Chromium baseline. Naming clues appear first. The baseline includes a curated list plus browser names observed in a Chromium 153 desktop reference, excluding browser-tool injections.
- Object and function types, constructor names, own and prototype property names, descriptor kinds, and declared function argument counts. Arity is metadata, not a verified callable signature.
- Accessible WebKit message-handler names and descriptors, navigator metadata, Android/WebView UA clues, Chromium version, and 16 browser/device API presence checks.
- Custom schemes observed in link attributes or inspected string values, plus unverified known scheme hints and method-name clues. It does not crawl function source or nested object graphs.
- Timestamp, page URL, all discovery errors, scan limits, and earlier capability/interactive-test results.

`PASS` means inspection completed. `FOUND` means a property is exposed, not that vehicle integration works. `NOT FOUND` means the check did not find it. `ERROR` means reflection failed; other results remain available. `UNKNOWN` can occur when descriptor lookup reaches its prototype depth limit.

The baseline is intentionally incomplete. New standard APIs, extensions, and page scripts may appear as anomalies. An injected object that reuses a standard name without a native naming clue may be missed. Anomaly names alone never establish access to a vehicle API.

## Passive inspection and safety review

The discovery engine uses property descriptors and guarded own-name/prototype reflection. It never evaluates unknown property getters, calls bridge methods, invokes message handlers, constructs native functions, stringifies raw host objects, or launches URL schemes. Function names and arity, constructor names, and exception messages are read through descriptors. Report data contains only newly created records and primitive values, so export cannot invoke an inspected object's `toJSON` or `toString`.

The original automatic bridge scan now uses this same descriptor-based engine, replacing its direct `window[name]` reads. Known standard navigator metadata properties (`userAgent`, `platform`, `vendor`, `language`, `languages`, `hardwareConcurrency`, `deviceMemory`, `maxTouchPoints`) are explicitly allowlisted read-only property reads; other navigator accessors remain unevaluated. Discovery performs no permission requests, network probes, storage writes, or vehicle actions. **Copy Full Report** writes the clipboard only after a tap. Existing interactive tests retain their original explicit-button behavior.

JavaScript reflection can trigger a Proxy's or host object's internal reflection traps. Their implementation is outside the page's control; `try/catch` isolates thrown errors but cannot guarantee a trap has no side effects or interrupt a trap that hangs. Accessor-only bridges are therefore reported as present but uninspected.

To keep reports and car-browser work bounded, details cover at most 150 candidate globals (explicit and native-looking names first), 180 properties per object/prototype, and 3 prototype levels. Full enumerated name lists are preserved; omitted-detail counts and other limits are exported. No native API behavior has been verified in an actual XPeng vehicle.

Reports can include the page URL, inspected string values, browser/device information, and location or clipboard content from earlier interactive tests. Review before sharing.

## Local verification

Run the dependency-free regression suite with Node.js:

```sh
node --test tests/native-discovery.test.cjs
```

The suite executes the actual page script, covering automatic and manual discovery, hostile getters, throwing/revoked proxies, conversion hooks, native methods and handlers, inherited properties, API states, custom schemes, report copying, rescans, and bounded cyclic/large objects.

Serve `index.html` with any static server to inspect it locally. GitHub Pages uses the root of `main`.
