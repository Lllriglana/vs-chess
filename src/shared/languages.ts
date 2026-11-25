export const languages = ['en', 'ru', 'es', 'pt-BR', 'fr', 'de', 'zh-CN'] as const;

export type Language = typeof languages[number];

export const languageNames: Record<Language, string> = {
  en: 'English',
  ru: 'Русский',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  fr: 'Français',
  de: 'Deutsch',
  'zh-CN': '简体中文'
};
