// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  collectTextNodes,
  applyTranslations,
  restoreText,
  isSkippable,
} from '../lib/extract';

describe('collectTextNodes', () => {
  it('collects visible text nodes in order', () => {
    document.body.innerHTML = '<p>Hello</p><div>World</div>';
    const refs = collectTextNodes(document.body);
    expect(refs.map((r) => r.text)).toEqual(['Hello', 'World']);
  });

  it('skips script/style/svg/code/pre and hidden elements', () => {
    document.body.innerHTML = [
      '<script>var x = 1;</script>',
      '<style>p { color: red }</style>',
      '<svg><text>svg text</text></svg>',
      '<code>code text</code>',
      '<pre>pre text</pre>',
      '<div hidden>hidden text</div>',
      '<p>Real text</p>',
    ].join('');
    const refs = collectTextNodes(document.body);
    expect(refs.map((r) => r.text)).toEqual(['Real text']);
  });

  it('skips elements with display:none', () => {
    document.body.innerHTML = '<p>Visible</p><p style="display:none">Invisible</p>';
    const refs = collectTextNodes(document.body);
    expect(refs.map((r) => r.text)).toEqual(['Visible']);
  });

  it('skips whitespace-only text', () => {
    document.body.innerHTML = '<p>   </p><p>Real</p>';
    const refs = collectTextNodes(document.body);
    expect(refs.map((r) => r.text)).toEqual(['Real']);
  });

  it('respects maxItems', () => {
    document.body.innerHTML = ['<p>1</p>', '<p>2</p>', '<p>3</p>', '<p>4</p>', '<p>5</p>'].join('');
    const refs = collectTextNodes(document.body, 3);
    expect(refs.map((r) => r.text)).toEqual(['1', '2', '3']);
  });
});

describe('isSkippable', () => {
  it('detects skippable elements and descendants', () => {
    document.body.innerHTML = '<code><span>inner</span></code><p>ok</p>';
    const code = document.querySelector('code');
    const span = document.querySelector('span');
    const p = document.querySelector('p');
    expect(code && isSkippable(code)).toBe(true);
    expect(span && isSkippable(span)).toBe(true);
    expect(p && isSkippable(p)).toBe(false);
  });
});

describe('applyTranslations', () => {
  it('replaces text keeping surrounding whitespace', () => {
    document.body.innerHTML = '<p>Hello </p>';
    const refs = collectTextNodes(document.body);
    const count = applyTranslations(refs, ['سلام']);
    expect(count).toBe(1);
    expect(document.body.textContent).toBe('سلام ');
  });

  it('does not touch already-translated text', () => {
    document.body.innerHTML = '<p>Hello</p>';
    const refs = collectTextNodes(document.body);
    const count = applyTranslations(refs, ['Hello']);
    expect(count).toBe(0);
    expect(document.body.textContent).toBe('Hello');
  });
});

describe('restoreText', () => {
  it('restores original text after translation', () => {
    document.body.innerHTML = '<p>Hello</p>';
    const refs = collectTextNodes(document.body);
    applyTranslations(refs, ['سلام']);
    const count = restoreText(refs);
    expect(count).toBe(1);
    expect(document.body.textContent).toBe('Hello');
    expect(restoreText(refs)).toBe(0);
  });
});
