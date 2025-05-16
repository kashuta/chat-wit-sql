import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { Language, translations, Translations } from '../localization';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Translations;
}

const defaultLanguage: Language = 'en';

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>(() => {
    const savedLanguage = localStorage.getItem('language') as Language;
    return savedLanguage && (savedLanguage === 'en' || savedLanguage === 'ru') 
      ? savedLanguage 
      : defaultLanguage;
  });

  const t = useMemo(() => translations[language], [language]);

  useEffect(() => {
    localStorage.setItem('language', language);
  }, [language]);

  const value = useMemo(() => ({
    language,
    setLanguage,
    t
  }), [language, t]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}; 