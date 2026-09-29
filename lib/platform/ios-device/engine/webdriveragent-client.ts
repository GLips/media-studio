// webdriveragent-client.ts: a small client for WebDriverAgent (Appium's fork, github.com/appium/WebDriverAgent), the
// XCUITest runner that drives an iPhone or iPad's UI from the Mac: find elements by accessibility label, tap, drag,
// type, screenshot. It speaks WDA's HTTP API at `url`, which ios-device-usb.ts forwards over USB.
//
// Touches go through W3C pointer actions, in the device's points. An app sees them as a finger: no pressure, tilt or
// azimuth.

export type WdaRect = { x: number; y: number; width: number; height: number };
export type WdaPoint = { x: number; y: number };
/** One accessibility element as `/source` describes it. */
export type WdaElement = { type: string; label: string; identifier: string; rect: WdaRect; selected: boolean; value: string };
/** A finger's path: a tap is a path of one point, held `holdMs`. */
export type WdaTouchPath = { points: readonly WdaPoint[]; msPerMove: number; holdMs?: number };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class WebDriverAgentSession {
  readonly url: string;
  readonly sessionId: string;
  private constructor(url: string, sessionId: string) {
    this.url = url;
    this.sessionId = sessionId;
  }

  static async open(url: string, bundleId: string): Promise<WebDriverAgentSession> {
    const body = await wdaRequest(url, 'POST', '/session', { capabilities: { alwaysMatch: { bundleId, shouldWaitForQuiescence: false } } });
    return new WebDriverAgentSession(url, String(body.sessionId));
  }

  private call(method: 'GET' | 'POST', path: string, payload?: unknown) {
    return wdaRequest(this.url, method, `/session/${this.sessionId}${path}`, payload);
  }

  /** Every labelled element on screen, in the active app, parsed from WDA's JSON source tree. */
  async elements(): Promise<WdaElement[]> {
    const body = await wdaRequest(this.url, 'GET', '/source?format=json');
    const out: WdaElement[] = [];
    const walk = (node: Record<string, unknown>) => {
      const label = String(node.label ?? ''), identifier = String(node.rawIdentifier ?? '');
      if (label || identifier) {
        out.push({ type: String(node.type ?? ''), label, identifier, rect: node.rect as WdaRect, selected: String(node.traits ?? '').includes('Selected'), value: String(node.value ?? '') });
      }
      for (const child of (node.children as Record<string, unknown>[] | undefined) ?? []) walk(child);
    };
    walk(body.value as Record<string, unknown>);
    return out;
  }

  /** The first element whose label or identifier is `name` (and of `type`, if given). */
  async find(name: string, type?: string): Promise<WdaElement | undefined> {
    return (await this.elements()).find((e) => (e.label === name || e.identifier === name) && (!type || e.type === type));
  }

  /** Waits for `test` to find an element, polling; throws with `what` if it never does. */
  async waitFor(what: string, test: (elements: WdaElement[]) => WdaElement | undefined, timeoutMs = 10_000): Promise<WdaElement> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = test(await this.elements());
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`WebDriverAgent: waited ${timeoutMs} ms for ${what}`);
      await pause(250);
    }
  }

  async tap(at: WdaPoint, holdMs = 60) {
    await this.touch([{ points: [at], msPerMove: 0, holdMs }]);
  }

  /** Taps the centre of the element named `name`, waiting for it to appear. */
  async tapNamed(name: string, type?: string, timeoutMs = 10_000) {
    const element = await this.waitFor(name, (all) => all.find((e) => (e.label === name || e.identifier === name) && (!type || e.type === type)), timeoutMs);
    await this.tap(centreOf(element.rect));
  }

  /** Paints `paths` one after another, the finger lifted between them. */
  async touch(paths: readonly WdaTouchPath[]) {
    const actions: Record<string, unknown>[] = [];
    for (const { points, msPerMove, holdMs = 0 } of paths) {
      const [first, ...rest] = points;
      actions.push({ type: 'pointerMove', duration: 0, x: first.x, y: first.y }, { type: 'pointerDown' });
      if (holdMs) actions.push({ type: 'pause', duration: holdMs });
      for (const p of rest) actions.push({ type: 'pointerMove', duration: msPerMove, x: p.x, y: p.y });
      actions.push({ type: 'pointerUp' }, { type: 'pause', duration: 50 });
    }
    await this.call('POST', '/actions', { actions: [{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions }] });
  }

  /** Drags from `from` to `to` in `ms`, resting before lifting so the view doesn't fling. */
  async drag(from: WdaPoint, to: WdaPoint, ms = 400) {
    await this.call('POST', '/actions', {
      actions: [{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions: [
        { type: 'pointerMove', duration: 0, ...from }, { type: 'pointerDown' }, { type: 'pointerMove', duration: ms, ...to }, { type: 'pause', duration: 200 }, { type: 'pointerUp' },
      ] }],
    });
  }

  /** Types `text` into whatever has the keyboard's focus. */
  async type(text: string) {
    await this.call('POST', '/wda/keys', { value: [text] });
  }

  async activate(bundleId: string) {
    await wdaRequest(this.url, 'POST', `/session/${this.sessionId}/wda/apps/activate`, { bundleId });
  }

  async activeBundleId(): Promise<string> {
    return String(((await wdaRequest(this.url, 'GET', '/wda/activeAppInfo')).value as { bundleId: string }).bundleId);
  }

  async windowSize(): Promise<{ width: number; height: number }> {
    return (await this.call('GET', '/window/size')).value as { width: number; height: number };
  }

  async screenshot(): Promise<Buffer> {
    return Buffer.from(String((await wdaRequest(this.url, 'GET', '/screenshot')).value), 'base64');
  }
}

export const centreOf = (r: WdaRect): WdaPoint => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** Whether a WebDriverAgent answers at `url` and is ready. */
export async function webDriverAgentReady(url: string): Promise<boolean> {
  try {
    const body = await wdaRequest(url, 'GET', '/status', undefined, 3_000);
    return Boolean((body.value as { ready?: boolean }).ready);
  } catch {
    return false;
  }
}

async function wdaRequest(url: string, method: 'GET' | 'POST', path: string, payload?: unknown, timeoutMs = 120_000): Promise<Record<string, unknown>> {
  const response = await fetch(`${url}${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json() as Record<string, unknown>;
  const value = body.value as { error?: string; message?: string } | null;
  if (!response.ok || value?.error) throw new Error(`WebDriverAgent ${method} ${path}: ${value?.error ?? response.status} ${value?.message ?? ''}`.trim());
  return body;
}
