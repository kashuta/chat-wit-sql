import React, { useState } from 'react';
import { useLanguage } from './contexts/LanguageContext';
import LanguageSwitcher from './components/LanguageSwitcher';
import { Language } from './localization';
import { languageInstructions } from './config/languageConfig';

type QueryResult = {
  data: Record<string, unknown>;
  explanation: string;
  confidence: number;
  sql?: string;
  visualization?: {
    type: 'table' | 'line' | 'bar' | 'pie';
    data: unknown;
  };
};

type QueryRequest = {
  query: string;
  language: Language;
};

const App: React.FC = () => {
  const { t, language } = useLanguage();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!query.trim()) return;
    
    setLoading(true);
    setError(null);
    setResult(null);
    
    try {
      let modifiedQuery = query;
      if (language === 'ru' && languageInstructions.ru) {
        modifiedQuery = `${query} ${languageInstructions.ru}`;
      }

      const queryRequest: QueryRequest = {
        query: modifiedQuery,
        language
      };

      const response = await fetch('/api/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(queryRequest),
      });
      
      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError((err as Error).message || t.errorDefault);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <header className="header">
        <div className="header-top">
          <h1>{t.title}</h1>
          <LanguageSwitcher />
        </div>
        <p>{t.subtitle}</p>
      </header>
      
      <form onSubmit={handleSubmit} className="query-form">
        <div className="input-container">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.inputPlaceholder}
            className="query-input"
          />
        </div>
        <button 
          type="submit" 
          disabled={loading} 
          className="submit-button"
          key={`submit-btn-${language}`} 
        >
          {loading ? t.processingButton : t.askButton}
        </button>
      </form>
      
      {error && <div className="error-message">{error}</div>}
      
      {result && (
        <div className="result-container">
          <div className="explanation">
            <h2>{t.explanationTitle}</h2>
            <p>{result.explanation}</p>
            <div className="confidence">
              {t.confidenceLabel}: {(result.confidence * 100).toFixed(0)}%
            </div>
          </div>
          
          {result.sql && (
            <div className="sql-query">
              <h3>{t.sqlQueryTitle}</h3>
              <pre>{result.sql}</pre>
            </div>
          )}
          
          <div className="data-section">
            <h3>{t.dataTitle}</h3>
            {Object.entries(result.data).map(([service, data]) => (
              <div key={service} className="service-data">
                <h4>{service}</h4>
                <pre>{JSON.stringify(data, null, 2)}</pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default App; 