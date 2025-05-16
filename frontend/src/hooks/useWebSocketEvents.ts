import { useState, useEffect, useRef } from 'react';

export type WebSocketEvent = {
  type: string;
  queryId: string;
  timestamp: number;
  payload: any;
};

type WebSocketEventCallback = (event: WebSocketEvent) => void;

type UseWebSocketEventsReturn = {
  connected: boolean;
  error: string | null;
  on: (eventType: string, callback: WebSocketEventCallback) => () => void;
};

/**
 * A hook for subscribing to WebSocket events for a specific queryId
 */
const useWebSocketEvents = (queryId?: string): UseWebSocketEventsReturn => {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const callbacksRef = useRef<Record<string, WebSocketEventCallback[]>>({});
  
  // Connect to WebSocket
  useEffect(() => {
    if (!queryId) return;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    // Create WebSocket connection
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    
    // Handle connection open
    ws.onopen = () => {
      setConnected(true);
      setError(null);
      
      // Subscribe to events for this queryId
      ws.send(JSON.stringify({
        type: 'subscribe',
        queryId
      }));
    };
    
    // Handle messages
    ws.onmessage = (event) => {
      try {
        const wsEvent = JSON.parse(event.data) as WebSocketEvent;
        
        // Ignore events for other queryIds
        if (wsEvent.queryId !== queryId) return;
        
        // Call registered callbacks for this event type
        const callbacks = callbacksRef.current[wsEvent.type] || [];
        callbacks.forEach(callback => callback(wsEvent));
      } catch (err) {
        console.error('Failed to parse WebSocket event:', err);
      }
    };
    
    // Handle errors
    ws.onerror = () => {
      setConnected(false);
      setError('WebSocket connection error');
    };
    
    // Handle connection close
    ws.onclose = () => {
      setConnected(false);
    };
    
    // Cleanup on unmount
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [queryId]);
  
  // Register event callback
  const on = (eventType: string, callback: WebSocketEventCallback) => {
    if (!callbacksRef.current[eventType]) {
      callbacksRef.current[eventType] = [];
    }
    
    callbacksRef.current[eventType].push(callback);
    
    // Return unsubscribe function
    return () => {
      callbacksRef.current[eventType] = callbacksRef.current[eventType].filter(cb => cb !== callback);
    };
  };
  
  return {
    connected,
    error,
    on
  };
};

export default useWebSocketEvents; 