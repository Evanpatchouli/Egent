/** Only this identity marker is persisted in the browser. It is not a secret token. */
export const USER_IDENTIFIER_KEY = 'egent.userIdentifier';
/** Header used to resolve the current database identity. */
export const USER_IDENTIFIER_HEADER = 'X-Egent-User-Identifier';
/** Encode Unicode code points as reversible seven-digit chunks, never as a Number. */
export function strToNumeric(str: string): string {
  let result = '';
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) throw new Error('无效 Unicode 字符');
    result += code.toString().padStart(7, '0');
  }
  return result;
}
/** Decode seven-digit chunks; reject malformed digits and invalid Unicode scalar values. */
export function numericToStr(num: string): string {
  if (num.length % 7 !== 0) throw new Error('长度不是 7 的倍数');
  if (!/^\d*$/.test(num)) throw new Error('含非数字字符');
  let result = '';
  for (let i = 0; i < num.length; i += 7) {
    const code = parseInt(num.slice(i, i + 7), 10);
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error('无效 Unicode 字符');
    result += String.fromCodePoint(code);
  }
  return result;
}
