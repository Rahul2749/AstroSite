export type Language = 'en' | 'hi';

export function translate(language: Language) {
  return (english: string, hindi: string) => language === 'hi' ? hindi : english;
}

export function localeFor(language: Language) {
  return language === 'hi' ? 'hi-IN' : 'en-IN';
}
