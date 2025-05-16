import React, { useEffect, useState, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';

type EventStatus = 'started' | 'in_progress' | 'completed' | 'error';

type EventType = 
  | 'query_received'
  | 'perception_analysis'
  | 'planning'
  | 'conflict_detection'
  | 'conflict_resolution'
  | 'sql_execution'
  | 'step_execution'
  | 'result_processing'
  | 'response_generation'
  | 'completion';

interface BaseEvent {
  id: string;
  queryId: string;
  timestamp: number;
  type: EventType;
  status: EventStatus;
  payload: Record<string, any>;
}

interface QueryExecutionLogProps {
  queryId: string | null;
  isActive: boolean;
  onResult?: (result: any) => void;
}

// Map event types to human-readable names
const eventNames: Record<EventType, string> = {
  query_received: 'Query Received',
  perception_analysis: 'Understanding Query',
  planning: 'Planning Execution',
  conflict_detection: 'Detecting Conflicts',
  conflict_resolution: 'Resolving Conflicts',
  sql_execution: 'Executing SQL Query',
  step_execution: 'Executing Step',
  result_processing: 'Processing Results',
  response_generation: 'Generating Response',
  completion: 'Query Completed'
};

// Status colors for the events
const statusColors: Record<EventStatus, string> = {
  started: '#ffb74d', // Orange
  in_progress: '#64b5f6', // Blue
  completed: '#81c784', // Green
  error: '#e57373' // Red
};

const QueryExecutionLog: React.FC<QueryExecutionLogProps> = ({ queryId, isActive, onResult }) => {
  const [events, setEvents] = useState<BaseEvent[]>([]);
  const [lastTimestamp, setLastTimestamp] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const lastResultEventRef = useRef<string | null>(null);
  const [visibleEvent, setVisibleEvent] = useState<BaseEvent | null>(null);
  const [fade, setFade] = useState(false);
  const prevEventId = useRef<string | null>(null);
  
  // Format timestamp to relative time
  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    return formatDistanceToNow(date, { addSuffix: true });
  };
  
  // Get events from the API
  const fetchEvents = async () => {
    if (!queryId) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`/api/events/${queryId}`);
      
      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      setEvents(data.events);
      
      // Update the timestamp of the last event
      if (data.events.length > 0) {
        const timestamps = data.events.map((event: BaseEvent) => event.timestamp);
        setLastTimestamp(Math.max(...timestamps));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  
  // Poll for new events
  const pollEvents = async () => {
    if (!queryId || !isActive || lastTimestamp === 0) return;
    
    try {
      const response = await fetch(`/api/events/${queryId}/poll?since=${lastTimestamp}`);
      
      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.hasNewEvents) {
        setEvents(prevEvents => {
          // Merge existing events with new ones based on ID
          const existingIds = new Set(prevEvents.map(e => e.id));
          const newEvents = data.events.filter((e: BaseEvent) => !existingIds.has(e.id));
          return [...prevEvents, ...newEvents];
        });
        
        // Update the timestamp
        setLastTimestamp(data.currentTimestamp);
        
        // Scroll to bottom to show latest events
        if (logContainerRef.current) {
          logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
      }
    } catch (err) {
      console.error('Error polling events:', err);
      // Don't set error state to avoid disrupting the UI during polling
    }
  };
  
  // Initial fetch of events
  useEffect(() => {
    if (queryId) {
      fetchEvents();
    } else {
      setEvents([]);
      setLastTimestamp(0);
    }
  }, [queryId]);
  
  // Set up polling for new events
  useEffect(() => {
    if (!isActive || !queryId) return;
    
    const pollInterval = setInterval(pollEvents, 1000); // Poll every second
    
    return () => {
      clearInterval(pollInterval);
    };
  }, [isActive, queryId, lastTimestamp]);
  
  // Scroll to bottom when new events are added
  useEffect(() => {
    if (logContainerRef.current && events.length > 0) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [events.length]);
  
  // Call onResult when response_generation/completed event is added
  useEffect(() => {
    if (!onResult) return;
    const lastResultEvent = [...events].reverse().find(
      e => e.type === 'response_generation' && e.status === 'completed'
    );
    if (lastResultEvent && lastResultEvent.id !== lastResultEventRef.current) {
      lastResultEventRef.current = lastResultEvent.id;
      onResult(lastResultEvent.payload);
    }
  }, [events, onResult]);
  
  useEffect(() => {
    if (events.length === 0) return;
    const lastEvent = events[events.length - 1];
    if (lastEvent.id !== prevEventId.current) {
      setFade(true);
      setTimeout(() => {
        setVisibleEvent(lastEvent);
        setFade(false);
        prevEventId.current = lastEvent.id;
      }, 200); // fade out old, then fade in new
    }
  }, [events]);
  
  if (!queryId) {
    return null;
  }
  
  return (
    <div className="query-execution-log">
      <h3>Query Execution Progress</h3>
      {loading && !visibleEvent && <div className="loading">Loading...</div>}
      {error && <div className="error-message">{error}</div>}
      <div
        className="event-fade-container"
        style={{
          opacity: fade ? 0 : 1,
          transition: 'opacity 0.3s',
          minHeight: 80,
        }}
      >
        {visibleEvent ? (
          <div className={`event-item ${visibleEvent.status}`}>
            <div className="event-header">
              <span
                className="event-status-indicator"
                style={{ backgroundColor: statusColors[visibleEvent.status] }}
              />
              <span className="event-name">{eventNames[visibleEvent.type] || visibleEvent.type}</span>
              <span className="event-timestamp">{formatTimestamp(visibleEvent.timestamp)}</span>
            </div>
            <div className="event-details">
              <span className="event-status">Status: {visibleEvent.status}</span>
              {visibleEvent.type === 'step_execution' && visibleEvent.payload.stepNumber && (
                <div className="step-info">
                  Step {visibleEvent.payload.stepNumber} of {visibleEvent.payload.totalSteps}: {visibleEvent.payload.description || 'Executing step'}
                </div>
              )}
              {visibleEvent.type === 'sql_execution' && visibleEvent.payload.sql && (
                <div className="sql-info">
                  <div>Service: {visibleEvent.payload.service}</div>
                  <pre>{visibleEvent.payload.sql}</pre>
                </div>
              )}
              {visibleEvent.type === 'completion' && visibleEvent.status === 'completed' && (
                <div className="completion-info">
                  <div>Total Time: {((visibleEvent.payload.totalTime || 0) / 1000).toFixed(2)}s</div>
                  <div>Steps Executed: {visibleEvent.payload.stepCount}</div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="empty-log">No execution events available</div>
        )}
      </div>
    </div>
  );
};

export default QueryExecutionLog; 