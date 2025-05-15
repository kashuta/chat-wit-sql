import React, { useState } from 'react';

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

const App: React.FC = () => {
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
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });
      
      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError((err as Error).message || 'Failed to process query');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <header className="header">
        <h1>Dante AI Data Agent</h1>
        <p>Ask questions about your data using natural language</p>
      </header>
      
      <form onSubmit={handleSubmit} className="query-form">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g., Show me the top 10 users by deposit amount for the last week"
          className="query-input"
        />
        <button type="submit" disabled={loading} className="submit-button">
          {loading ? 'Processing...' : 'Ask'}
        </button>
      </form>
      
      {error && <div className="error-message">{error}</div>}
      
      {result && (
        <div className="result-container">
          <div className="explanation">
            <h2>Explanation</h2>
            <p>{result.explanation}</p>
            <div className="confidence">
              Confidence: {(result.confidence * 100).toFixed(0)}%
            </div>
          </div>
          
          {result.sql && (
            <div className="sql-query">
              <h3>SQL Query</h3>
              <pre>{result.sql}</pre>
            </div>
          )}
          
          <div className="data-section">
            <h3>Data</h3>
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