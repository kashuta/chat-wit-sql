import React, { useState } from 'react';

export type LogEntry = {
  id: string;
  timestamp: number;
  message: string;
  level: 'info' | 'warning' | 'error' | 'debug';
  category: string;
  step?: string;
  details?: string;
};

type LogViewerProps = {
  logs: LogEntry[];
  groupByCategory?: boolean;
};

const LogViewer: React.FC<LogViewerProps> = ({ 
  logs,
  groupByCategory = true
}) => {
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [showDetails, setShowDetails] = useState<Record<string, boolean>>({});

  if (!logs || logs.length === 0) {
    return <div className="no-logs">No logs available</div>;
  }

  // Group logs by category if needed
  const getGroupedLogs = (): Record<string, LogEntry[]> => {
    if (!groupByCategory) {
      return { 'All Logs': logs };
    }
    
    return logs.reduce((groups, log) => {
      const category = log.category || 'Other';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(log);
      return groups;
    }, {} as Record<string, LogEntry[]>);
  };

  const groupedLogs = getGroupedLogs();
  
  // Format timestamp to readable format
  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  // Get CSS class for log level
  const getLogLevelClass = (level: string): string => {
    switch (level) {
      case 'error':
        return 'log-error';
      case 'warning':
        return 'log-warning';
      case 'debug':
        return 'log-debug';
      default:
        return 'log-info';
    }
  };

  // Toggle category collapse
  const toggleCategory = (category: string) => {
    setCollapsedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  // Toggle log details
  const toggleDetails = (logId: string) => {
    setShowDetails(prev => ({
      ...prev,
      [logId]: !prev[logId]
    }));
  };

  return (
    <div className="log-viewer">
      <h3 className="log-title">Execution Logs</h3>
      <div className="log-controls">
        <button 
          onClick={() => setCollapsedCategories({})}
          className="log-control-button"
        >
          Expand All
        </button>
        <button 
          onClick={() => {
            const allCollapsed = Object.fromEntries(
              Object.keys(groupedLogs).map(category => [category, true])
            );
            setCollapsedCategories(allCollapsed);
          }}
          className="log-control-button"
        >
          Collapse All
        </button>
      </div>
      
      <div className="logs-container">
        {Object.entries(groupedLogs).map(([category, categoryLogs]) => (
          <div key={category} className="log-category">
            <div 
              className="category-header" 
              onClick={() => toggleCategory(category)}
            >
              <span className="category-indicator">
                {collapsedCategories[category] ? '▶' : '▼'}
              </span>
              <h4 className="category-title">{category}</h4>
              <span className="category-count">{categoryLogs.length}</span>
            </div>
            
            {!collapsedCategories[category] && (
              <div className="category-logs">
                {categoryLogs.map((log) => (
                  <div key={log.id} className={`log-entry ${getLogLevelClass(log.level)}`}>
                    <div className="log-main" onClick={() => log.details && toggleDetails(log.id)}>
                      <span className="log-time">{formatTimestamp(log.timestamp)}</span>
                      {log.step && <span className="log-step">{log.step}</span>}
                      <span className="log-message">{log.message}</span>
                      {log.details && (
                        <span className="details-toggle">
                          {showDetails[log.id] ? '▲' : '▼'}
                        </span>
                      )}
                    </div>
                    {log.details && showDetails[log.id] && (
                      <div className="log-details">
                        <pre>{log.details}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default LogViewer; 