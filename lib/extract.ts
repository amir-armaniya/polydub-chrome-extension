export interface TextNodeRef {
  node: Text;
  text: string;
}

const SKIP_SELECTOR = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'code',
  'pre',
  'kbd',
  'samp',
  'var',
  'textarea',
  'select',
  'input',
  'button',
  '[hidden]',
  '[aria-hidden="true"]',
  '[contenteditable="false"]',
].join(',');

export function isSkippable(el: Element): boolean {
  return el.matches(SKIP_SELECTOR) || el.closest(SKIP_SELECTOR) !== null;
}

export function isEffectivelyVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  let cur: Element | null = el;
  while (cur) {
    const style = window.getComputedStyle(cur);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    if (cur === document.body) break;
    cur = cur.parentElement;
  }
  return true;
}

export function collectTextNodes(root: ParentNode, maxItems = 100): TextNodeRef[] {
  const found: TextNodeRef[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && found.length < maxItems) {
    const parent = node.parentElement;
    if (parent && node.nodeType === Node.TEXT_NODE && !isSkippable(parent) && isEffectivelyVisible(parent)) {
      const text = node.textContent ?? '';
      if (text.trim().length > 0) {
        found.push({ node: node as Text, text });
      }
    }
    node = walker.nextNode();
  }
  return found;
}

export function applyTranslations(refs: TextNodeRef[], translations: string[]): number {
  let count = 0;
  refs.forEach((ref, i) => {
    const tr = translations[i];
    if (tr == null || tr === ref.text) return;
    const leading = ref.text.length - ref.text.trimStart().length;
    const trailing = ref.text.length - ref.text.trimEnd().length;
    ref.node.data = ref.text.slice(0, leading) + tr.trim() + ref.text.slice(ref.text.length - trailing);
    count++;
  });
  return count;
}

export function restoreText(refs: TextNodeRef[]): number {
  let count = 0;
  for (const ref of refs) {
    if (ref.node.data !== ref.text) {
      ref.node.data = ref.text;
      count++;
    }
  }
  return count;
}
