import { useState, useEffect } from 'react';
import { LogEntry } from '../components/execution/LogViewer';

type UseLogStreamOptions = {
  queryId?: string;
  autoConnect?: boolean;
};

const useLogStream = ({ queryId, autoConnect = true }: UseLogStreamOptions) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = () => {
    if (!queryId) {
      setError('No query ID provided for log streaming');
      return;
    }

    try {
      // Create SSE connection to backend
      const eventSource = new EventSource(`/api/logs/stream/${queryId}`);

      // Handle connection open
      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      // Handle log messages
      eventSource.addEventListener('log', (event) => {
        try {
          const logEntry = JSON.parse(event.data) as LogEntry;
          setLogs(prevLogs => [...prevLogs, logEntry]);
        } catch (err) {
          console.error('Failed to parse log entry:', err);
        }
      });

      // Handle errors
      eventSource.onerror = (err) => {
        setIsConnected(false);
        setError('Log stream connection failed');
        eventSource.close();
      };

      // Handle connection close on component unmount
      return () => {
        eventSource.close();
        setIsConnected(false);
      };
    } catch (err) {
      setError(`Failed to connect to log stream: ${err}`);
      return () => {};
    }
  };

  // Connect on mount if autoConnect is true
  useEffect(() => {
    if (autoConnect && queryId) {
      const cleanup = connect();
      return cleanup;
    }
  }, [queryId]);

  return {
    logs,
    isConnected,
    error,
    connect
  };
};

export default useLogStream; 