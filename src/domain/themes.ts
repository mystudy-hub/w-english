import type { ThemeConfig } from '../data/content-schema.ts';
import type { WordProgress } from './models.ts';

export function themeAccess(theme: ThemeConfig, themes: readonly ThemeConfig[], progress: readonly WordProgress[]) {
  const prerequisite = theme.unlock.prerequisiteThemeId;
  if (prerequisite === null) return { unlocked: true, completed: 0, required: 0 };
  const previous = themes.find((entry) => entry.themeId === prerequisite);
  const completed = previous ? new Set(progress.filter((entry) => previous.wordIds.includes(entry.wordId) && entry.firstCorrectAt !== undefined).map((entry) => entry.wordId)).size : 0;
  return { unlocked: Boolean(previous && completed >= theme.unlock.requiredFirstCorrect), completed, required: theme.unlock.requiredFirstCorrect };
}
export function firstTheme(themes: readonly ThemeConfig[]) {
  return themes.find((theme) => theme.unlock.prerequisiteThemeId === null) ?? themes[0]!;
}
