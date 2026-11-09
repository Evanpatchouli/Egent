/** Only standalone Egent mentions trigger the assistant; email addresses do not. */
export function hasEgentMention(text: string) {
  return /(?:^|\s)@Egent(?=\s|$)/iu.test(text);
}

export function removeEgentMentions(text: string) {
  return text.replace(/(?<!\S)@Egent(?:[\t ]+|(?=\s|$))/giu, '');
}

export function activeMention(text: string, start: number, end = start) {
  if (start !== end) return null;
  const match = /@([^\s@]*)$/u.exec(text.slice(0, start));
  if (!match || (match.index > 0 && /[\w@]/u.test(text.charAt(match.index - 1)))) return null;
  return { start: match.index, end: start, query: match[1] ?? '' };
}

/** Mirror textarea wrapping and scrolling to anchor the menu to the actual @ glyph. */
export function mentionPosition(input: HTMLTextAreaElement, index: number) {
  const mirror = document.createElement('div');
  const style = getComputedStyle(input);
  for (const property of [
    'box-sizing',
    'width',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'line-height',
    'letter-spacing',
    'text-indent',
    'padding',
    'border',
    'word-spacing',
    'tab-size',
  ])
    mirror.style.setProperty(property, style.getPropertyValue(property));
  Object.assign(mirror.style, {
    position: 'fixed',
    visibility: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    top: '0',
    left: '0',
    width: `${input.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`,
  });
  mirror.textContent = input.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = input.value.charAt(index) || '@';
  mirror.append(marker, input.value.slice(index + 1));
  document.body.append(mirror);
  const rect = marker.getBoundingClientRect();
  const position = { left: rect.left - input.scrollLeft, top: rect.top - input.scrollTop };
  mirror.remove();
  return position;
}
