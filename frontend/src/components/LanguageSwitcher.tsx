import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Language } from '../localization';

const LanguageSwitcher: React.FC = () => {
  const { language, setLanguage } = useLanguage();

  const handleChange = (newLang: Language) => {
    setLanguage(newLang);
  };

  return (
    <div className="language-switcher">
      <button 
        className={`lang-btn ${language === 'en' ? 'active' : ''}`}
        onClick={() => handleChange('en')}
      >
        EN
      </button>
      <button 
        className={`lang-btn ${language === 'ru' ? 'active' : ''}`}
        onClick={() => handleChange('ru')}
      >
        RU
      </button>
    </div>
  );
};

export default LanguageSwitcher; 