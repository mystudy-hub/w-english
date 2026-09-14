import type { Page } from '@playwright/test';

export async function auditChildPage(page: Page, mode: 'tap' | 'drag') {
  return page.evaluate(({ minimum, gap }) => {
    const root = document.querySelector('dialog[open]') ?? document.querySelector('.app')!;
    const issues: Array<{ rule: string; label: string; actual: string }> = [];
    const visible = (element: Element) => Boolean(element.getClientRects().length) && getComputedStyle(element).visibility === 'visible';
    const name = (element: Element) => (element.getAttribute('aria-label') || (element as HTMLElement).innerText || element.getAttribute('alt') || '').trim().slice(0, 70);
    const rgb = (input: string) => {
      const values = input.match(/[\d.]+/g)?.map(Number);
      return values && values.length >= 3 ? [values[0]! / 255, values[1]! / 255, values[2]! / 255, values[3] ?? 1] : [0, 0, 0, 0];
    };
    const blend = (front: number[], back: number[]) => [0, 1, 2].map((index) => front[index]! * front[3]! + back[index]! * (1 - front[3]!)).concat(1);
    const light = (color: number[]) => color.slice(0, 3).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
    const contrast = (a: number[], b: number[]) => (Math.max(light(a), light(b)) + .05) / (Math.min(light(a), light(b)) + .05);
    const backgrounds = (element: Element) => {
      const ancestors: Element[] = []; let current: Element | null = element;
      while (current) { ancestors.unshift(current); current = current.parentElement; }
      let colors = [[1, 1, 1, 1]];
      for (const node of ancestors) {
        const style = getComputedStyle(node); colors = colors.map((color) => blend(rgb(style.backgroundColor), color));
        if (style.backgroundImage !== 'none') {
          if (!style.backgroundImage.includes('gradient')) return undefined;
          const stops = [...style.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map((match) => rgb(match[0]));
          const alternatives = [...colors, ...stops.flatMap((stop) => colors.map((base) => blend(stop, base)))];
          // Conservative channel bounds cover the pale decorative gradients as well as solid surfaces.
          colors = [0, 1].map((end) => [0, 1, 2].map((channel) => (end ? Math.max : Math.min)(...alternatives.map((color) => color[channel]!))).concat(1));
        }
      }
      return colors;
    };
    const controls = [...root.querySelectorAll('button, a.brand')].filter((element) => visible(element) && !element.matches(':disabled'));
    for (const control of controls) {
      const box = control.getBoundingClientRect();
      if (box.width < minimum - .5 || box.height < minimum - .5) issues.push({ rule: 'target', label: name(control), actual: `${box.width.toFixed(1)}×${box.height.toFixed(1)}` });
      if (!name(control)) issues.push({ rule: 'name', label: control.tagName, actual: 'empty' });
      if (control.querySelector('svg')) {
        const bases = backgrounds(control);
        if (bases) {
          const ratio = Math.min(...bases.map((base) => contrast(blend(rgb(getComputedStyle(control).color), base), base)));
          if (ratio < 3) issues.push({ rule: 'icon-contrast', label: name(control), actual: ratio.toFixed(2) });
        }
      }
    }
    for (const group of root.querySelectorAll('.word-grid, .audio-controls, .word-activities, .button-row, .spelling-bank, .blend-bubbles, .header-start, .header-end')) {
      const children = [...group.querySelectorAll('button, a.brand')].filter(visible);
      const style = getComputedStyle(group);
      if (children.length > 1 && parseFloat(style.columnGap) < gap - .5) issues.push({ rule: 'gap', label: group.className, actual: style.columnGap });
    }
    for (const element of root.querySelectorAll('.hint-star, .end-stars>svg, .lesson-dots .done svg, .blend-bubble.active, .timer-wrap>span')) {
      if (!visible(element) || element.closest('button:disabled')) continue;
      const style = getComputedStyle(element); const bar = element.matches('.timer-wrap>span');
      const color = bar ? style.backgroundColor : element.matches('.blend-bubble') ? style.outlineColor : style.stroke.toLowerCase() === 'currentcolor' ? style.color : style.stroke;
      const bases = backgrounds(bar ? element.parentElement! : element); if (!bases) continue;
      const ratio = Math.min(...bases.map((base) => contrast(blend(rgb(color), base), base)));
      if (ratio < 3) issues.push({ rule: 'feedback-contrast', label: element.getAttribute('class') || element.tagName, actual: ratio.toFixed(2) });
    }
    let checkedText = 0; const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode; const element = node.parentElement; const text = node.textContent?.trim() ?? '';
      if (!element || !/[\p{L}\p{N}]/u.test(text) || !visible(element) || element.closest('button:disabled, [aria-hidden="true"], script, style')) continue;
      const style = getComputedStyle(element); const bases = backgrounds(element); if (!bases) continue;
      const size = parseFloat(style.fontSize); const large = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight) >= 700);
      const ratio = Math.min(...bases.map((base) => contrast(blend(rgb(style.color), base), base))); checkedText += 1;
      if (ratio < (large ? 3 : 4.5)) issues.push({ rule: 'text-contrast', label: text.slice(0, 65), actual: `${ratio.toFixed(2)} (${style.color})` });
    }
    for (const element of root.querySelectorAll('.word-definition, .word-example, .word-details h1, .phonics-practice h2, .orientation-overlay p')) {
      if (!visible(element)) continue;
      const size = parseFloat(getComputedStyle(element).fontSize); const wholeWord = element.matches('h1, h2');
      if (size < (wholeWord ? 48 : 20) || (wholeWord && size > 64)) issues.push({ rule: 'learning-font', label: name(element), actual: `${size}px` });
    }
    return { controls: controls.length, checkedText, issues };
  }, { minimum: mode === 'tap' ? 80 : 64, gap: mode === 'tap' ? 16 : 12 });
}
