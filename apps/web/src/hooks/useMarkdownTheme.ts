import { useState } from 'react';

export const markdownThemes = [
  { id: 'github', name: 'GitHub 明亮' },
  { id: 'paper', name: '纸页' },
  { id: 'midnight', name: '夜航' },
  { id: 'classic', name: '经典' },
] as const;

export type MarkdownTheme = (typeof markdownThemes)[number]['id'];
const storageKey = 'egent.markdownTheme';

export function parseMarkdownTheme(value: string | null): MarkdownTheme {
  return markdownThemes.find((theme) => theme.id === value)?.id ?? 'github';
}

export function useMarkdownTheme() {
  const [theme, setTheme] = useState(() => parseMarkdownTheme(localStorage.getItem(storageKey)));

  function changeTheme(value: MarkdownTheme) {
    localStorage.setItem(storageKey, value);
    setTheme(value);
  }

  return [theme, changeTheme] as const;
}
