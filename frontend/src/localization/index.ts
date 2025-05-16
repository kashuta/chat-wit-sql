import en from './en';
import ru from './ru';

export type Language = 'en' | 'ru';
export type Translations = typeof en;

export const translations = {
  en,
  ru,
};

export { en, ru }; 