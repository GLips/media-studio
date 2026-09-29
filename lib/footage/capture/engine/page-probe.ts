// page-probe.ts: a look at a page the way a project's capture sees it (signed in by its `prepare`, with its css and
// devices), for writing shots without guessing selectors. `studio probe` runs it.
//
// It saves a viewport screenshot, numbered to match what it lists: the element under a point, with the meaningful
// elements around it, or every interactive and landmark element in view. Each comes with a selector suggestion that
// capture.ts accepts as a rect spec, and how many elements that selector matches.
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from 'playwright';
import { importProjectCaptureShots } from './capture.ts';

export type ProbedElement = {
  role: string;
  name: string;
  /** A rect spec for capture.ts, as source: `'#total'` or `['button', { text: '^Sign in$' }]`. */
  selector: string;
  /** How many visible elements the selector matches; 1 is what a rect wants. */
  matches: number;
  /** Viewport CSS pixels. */
  rect: { x: number; y: number; w: number; h: number };
  /** Set on the element under `--at`; the rest are its meaningful ancestors. */
  hit?: boolean;
};

export type PageProbe = { screenshot: string; url: string; scrollY: number; elements: ProbedElement[]; beyondView: number };

/**
 * Opens `target` (a URL, an HTML file, or a URL path on the site `prepare` signs in to) as the project's capture
 * would, waits `wait` seconds for it to settle, and describes it.
 */
export async function probeProjectPage(project: string, target: string, { at, device, wait }: { at?: { x: number; y: number }; device?: string; wait: number }): Promise<PageProbe> {
  const shots = await importProjectCaptureShots(project);
  const url = /^[a-z][a-z0-9+.-]*:/i.test(target) ? target : existsSync(resolve(target)) ? pathToFileURL(resolve(target)).href : target;
  if (!url.includes(':') && !url.startsWith('/')) throw new Error(`probe: ${target} is neither a URL, a file, nor a path starting with /`);
  const { page, browser } = await shots.openPreparedPage(url, { device });
  try {
    await page.waitForTimeout(wait * 1000);
    await page.evaluate(() => document.fonts.ready);
    const { elements, beyondView, scrollY } = await describePage(page, at);
    await markScreenshot(page, elements, at);
    const dir = join(project, 'out', 'probe');
    mkdirSync(dir, { recursive: true });
    const slug = new URL(page.url()).pathname.replace(/\.html?$/, '').split('/').filter(Boolean).slice(-2).join('-').replace(/[^a-z0-9-]+/gi, '-') || 'home';
    const screenshot = join(dir, `${slug}${at ? `-at-${at.x}-${at.y}` : ''}${device ? `-${device}` : ''}.png`);
    await page.screenshot({ path: screenshot, scale: 'css' });
    return { screenshot, url: page.url(), scrollY, elements, beyondView };
  } finally {
    await browser.close();
  }
}

/** The probe as lines: the page, then one line per element, numbered as on the screenshot. */
export function formatPageProbe({ url, scrollY, elements, beyondView }: PageProbe): string[] {
  const nameWidth = Math.min(40, Math.max(0, ...elements.map((e) => e.name.length + 2)));
  const roleWidth = Math.max(0, ...elements.map((e) => e.role.length));
  const lines = elements.map((e, i) => {
    const name = e.name ? JSON.stringify(e.name.length > 38 ? `${e.name.slice(0, 37)}…` : e.name) : '';
    const count = e.matches === 1 ? '' : `  (matches ${e.matches})`;
    const { x, y, w, h } = e.rect;
    return `${String(i + 1).padStart(3)}${e.hit ? '*' : ' '} ${e.role.padEnd(roleWidth)}  ${name.padEnd(nameWidth)}  ${Math.round(x)},${Math.round(y)} ${Math.round(w)}×${Math.round(h)}  ${e.selector}${count}`;
  });
  const beyond = beyondView ? [`     … ${beyondView} more outside the viewport`] : [];
  return [`${url}${scrollY ? `  (scrolled ${Math.round(scrollY)}px)` : ''}`, ...lines, ...beyond];
}

type Described = { elements: ProbedElement[]; beyondView: number; scrollY: number };

// One self-contained function, since Playwright sends its source to the page: nothing outside it is in scope there.
function describePage(page: Page, at: { x: number; y: number } | undefined): Promise<Described> {
  return page.evaluate((at) => {
    const INTERACTIVE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=switch], [role=option], [role=combobox], [role=textbox], [tabindex]:not([tabindex="-1"]), [contenteditable=true]';
    const LANDMARK = 'header, nav, main, aside, footer, form, dialog, h1, h2, h3, [role=banner], [role=navigation], [role=main], [role=complementary], [role=contentinfo], [role=dialog], [role=region][aria-label], [role=heading], [role=tablist], [role=list][aria-label]';
    const IMPLICIT: Record<string, string> = {
      a: 'link', button: 'button', select: 'combobox', textarea: 'textbox', summary: 'button', nav: 'navigation', main: 'main',
      header: 'banner', footer: 'contentinfo', aside: 'complementary', form: 'form', dialog: 'dialog', h1: 'heading',
      h2: 'heading', h3: 'heading', h4: 'heading', img: 'img', ul: 'list', ol: 'list', li: 'listitem', table: 'table',
    };
    const INPUT_ROLES: Record<string, string> = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', range: 'slider', search: 'searchbox' };
    const tagOf = (el: Element) => el.tagName.toLowerCase();
    const roleOf = (el: Element) => {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit.split(' ')[0];
      if (tagOf(el) === 'input') return INPUT_ROLES[(el as HTMLInputElement).type] ?? 'textbox';
      return IMPLICIT[tagOf(el)] ?? (clickable(el) ? `clickable ${tagOf(el)}` : tagOf(el));
    };
    const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const nameOf = (el: Element) => {
      const labelledBy = el.getAttribute('aria-labelledby');
      const labels = (el as HTMLInputElement).labels;
      return flat(el.getAttribute('aria-label'))
        || flat(labelledBy?.split(' ').map((id) => document.getElementById(id)?.textContent).join(' '))
        || flat(labels?.[0]?.innerText)
        || flat(el.getAttribute('alt'))
        || flat(el.getAttribute('placeholder'))
        || flat(el.getAttribute('title'))
        || (tagOf(el) === 'select' ? flat((el as HTMLSelectElement).selectedOptions[0]?.text) : '')
        || (tagOf(el) === 'input' ? flat((el as HTMLInputElement).value) : '')
        // A landmark's text is everything inside it, which names nothing.
        || (el.matches(LANDMARK) && roleOf(el) !== 'heading' ? '' : flat((el as HTMLElement).innerText).slice(0, 80));
    };
    // What a React app makes clickable with an onClick on a div: the outermost element under a pointer cursor.
    const clickable = (el: Element) => getComputedStyle(el).cursor === 'pointer' && (!el.parentElement || getComputedStyle(el.parentElement).cursor !== 'pointer');
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const count = (selector: string) => {
      try {
        return [...document.querySelectorAll(selector)].filter(visible).length;
      } catch {
        return 0;
      }
    };
    // Generated names (React's :r1:, CSS-in-JS hashes, Mantine's m_8bffd616) change between builds.
    const generated = (s: string) => /[:]|\d{3,}|[0-9a-f]{6,}|^(css|sc|jsx|emotion|styled|tw)-|^m_|^_|__[\w-]{5}$|^(radix|mantine|headlessui|react|rc)-.*\d/i.test(s);
    const attr = (name: string, value: string) => `[${name}="${value.replace(/["\\]/g, '\\$&')}"]`;
    const quote = (s: string) => `'${s.replace(/['\\]/g, '\\$&')}'`;
    const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // A unique selector an element earns by what it is, not where it sits, to hang a path of positions from.
    const anchorOf = (el: Element): string | null => {
      for (const name of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
        const v = el.getAttribute(name);
        if (v && count(attr(name, v)) === 1) return attr(name, v);
      }
      if (el.id && !generated(el.id) && count(`#${CSS.escape(el.id)}`) === 1) return `#${CSS.escape(el.id)}`;
      const label = el.getAttribute('aria-label');
      if (label && count(`${tagOf(el)}${attr('aria-label', label)}`) === 1) return `${tagOf(el)}${attr('aria-label', label)}`;
      return null;
    };

    // The simplest selector unique among visible elements, else the least ambiguous, as rect-spec source.
    const selectorFor = (el: Element): { selector: string; matches: number } => {
      const tag = tagOf(el);
      const candidates: string[] = [];
      for (const name of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
        const v = el.getAttribute(name);
        if (v) candidates.push(attr(name, v));
      }
      if (el.id && !generated(el.id)) candidates.push(`#${CSS.escape(el.id)}`);
      const label = el.getAttribute('aria-label');
      if (label) candidates.push(`${tag}${attr('aria-label', label)}`, `${el.getAttribute('role') ? attr('role', el.getAttribute('role')!) : tag}${attr('aria-label', label)}`);
      const name = el.getAttribute('name');
      if (name) candidates.push(`${tag}${attr('name', name)}`);
      candidates.push(tag);
      const href = el.getAttribute('href');
      if (tag === 'a' && href && href.length < 80 && !href.startsWith('javascript:')) candidates.push(`a${attr('href', href)}`);
      const classes = [...el.classList].filter((c) => !generated(c) && c.length < 40).map((c) => `.${CSS.escape(c)}`);
      if (classes.length) candidates.push(`${tag}${classes[0]}`);
      const data = [...el.attributes].filter((a) => a.name.startsWith('data-') && a.value && a.value.length < 40 && !generated(a.value));
      for (const a of data) candidates.push(`${tag}${classes[0] ?? ''}${attr(a.name, a.value)}`);
      // Last, since the classes beyond the first are often state (`.on`, `.active`) that a click changes.
      if (classes.length > 1) candidates.push(`${tag}${classes.join('')}`);
      let best: { selector: string; matches: number } | null = null;
      for (const c of candidates) {
        const n = count(c);
        if (n === 1) return { selector: quote(c), matches: 1 };
        if (n > 0 && (!best || n < best.matches)) best = { selector: quote(c), matches: n };
      }
      // By its words, as capture.ts's `text` option matches them: innermost elements of the tag whose text fits.
      const text = flat((el as HTMLElement).innerText);
      if (text && text.length <= 60) {
        const re = new RegExp(`^${reEscape(text)}$`, 'i');
        let els = [...document.querySelectorAll(tag)].filter(visible).filter((e) => re.test(flat((e as HTMLElement).innerText)));
        els = els.filter((e) => !els.some((other) => other !== e && e.contains(other)));
        if (els.length === 1 || (els.length && (!best || els.length < best.matches))) {
          best = { selector: `[${quote(tag)}, { text: ${quote(`^${reEscape(text)}$`)} }]`, matches: els.length };
          if (els.length === 1) return best;
        }
      }
      // A path of child positions from the nearest ancestor that has a unique selector of its own.
      const steps: string[] = [];
      for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
        const parent: Element | null = node.parentElement;
        const sameTag = parent ? [...parent.children].filter((c) => c.tagName === node!.tagName) : [];
        steps.unshift(sameTag.length > 1 ? `${tagOf(node)}:nth-of-type(${sameTag.indexOf(node) + 1})` : tagOf(node));
        const anchor = parent && parent !== document.body ? anchorOf(parent) : 'body';
        if (anchor) {
          const path = `${anchor} > ${steps.join(' > ')}`;
          const n = count(path);
          if (n >= 1 && (!best || n < best.matches)) return { selector: quote(path), matches: n };
          break;
        }
      }
      return best ?? { selector: quote(tag), matches: count(tag) };
    };

    const describe = (el: Element, hit = false) => {
      const r = el.getBoundingClientRect();
      return { role: roleOf(el), name: nameOf(el), ...selectorFor(el), rect: { x: r.left, y: r.top, w: r.width, h: r.height }, ...(hit && { hit }) };
    };
    const meaningful = (el: Element) => el.matches(INTERACTIVE) || clickable(el) || el.matches(LANDMARK) || el.hasAttribute('aria-label') || el.hasAttribute('data-testid') || (!!el.id && !generated(el.id));

    if (at) {
      const hit = document.elementFromPoint(at.x, at.y);
      if (!hit) throw new Error(`probe: nothing at ${at.x},${at.y}; the viewport is ${innerWidth}×${innerHeight}`);
      const around: Element[] = [];
      for (let node = hit.parentElement; node && node !== document.body && around.length < 4; node = node.parentElement) {
        if (meaningful(node)) around.push(node);
      }
      return { elements: [describe(hit, true), ...around.map((el) => describe(el))], beyondView: 0, scrollY };
    }
    const all = [...document.querySelectorAll('body *')].filter((el) => (el.matches(INTERACTIVE) || el.matches(LANDMARK) || clickable(el)) && visible(el));
    const inView = all.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    });
    const LIMIT = 80;
    return { elements: inView.slice(0, LIMIT).map((el) => describe(el)), beyondView: all.length - inView.length + Math.max(0, inView.length - LIMIT), scrollY };
  }, at);
}

// Numbers each listed element on the page before the screenshot, and crosses the probed point, so the image and the
// list read together.
function markScreenshot(page: Page, elements: readonly ProbedElement[], at: { x: number; y: number } | undefined) {
  return page.evaluate(([elements, at]) => {
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    elements.forEach((e, i) => {
      const box = document.createElement('div');
      box.style.cssText = `position:absolute;left:${e.rect.x}px;top:${e.rect.y}px;width:${e.rect.w}px;height:${e.rect.h}px;outline:2px solid ${e.hit ? '#e0245e' : 'rgba(224,36,94,.55)'};`;
      const tag = document.createElement('span');
      tag.textContent = String(i + 1);
      tag.style.cssText = `position:absolute;left:-2px;top:${e.rect.y > 14 ? -16 : -2}px;background:#e0245e;color:#fff;font:bold 11px/14px system-ui;padding:0 3px;border-radius:3px;`;
      box.appendChild(tag);
      layer.appendChild(box);
    });
    if (at) {
      const cross = document.createElement('div');
      cross.style.cssText = `position:absolute;left:${at.x - 9}px;top:${at.y - 9}px;width:14px;height:14px;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 2px #e0245e;`;
      layer.appendChild(cross);
    }
    document.body.appendChild(layer);
  }, [elements, at] as const);
}
