/**
 * Common type definitions for the Dante AI Data Agent
 */

/**
 * Event types for WebSocket communication
 */
export enum EventType {
  PHASE_CHANGE = 'PHASE_CHANGE',
  LOG = 'LOG',
  PROGRESS = 'PROGRESS',
  ERROR = 'ERROR',
  SUBSCRIPTION_CONFIRMED = 'SUBSCRIPTION_CONFIRMED'
}

/**
 * Query request interface
 */
export interface QueryRequest {
  query: string;
  language: string;
  queryId?: string; // Optional when sent from client, will be generated if not provided
}

/**
 * Query response interface
 */
export interface QueryResponse {
  data: Record<string, unknown>;
  explanation: string;
  confidence: number;
  sql?: string;
  visualization?: {
    type: 'table' | 'line' | 'bar' | 'pie';
    data: unknown;
  };
  queryId?: string;
}

/**
 * Log entry interface
 */
export interface LogEntry {
  id: string;
  timestamp: number;
  message: string;
  level: 'info' | 'warning' | 'error' | 'debug';
  category?: string;
  step?: string;
  details?: string;
}

/**
 * WebSocket event interface
 */
export interface WebSocketEvent {
  type: EventType;
  queryId: string;
  timestamp: number;
  payload: any;
}

/**
 * Progress update interface
 */
export interface ProgressUpdate {
  step: number;
  total: number;
  description?: string;
}

/**
 * Phase change payload interface
 */
export interface PhaseChangePayload {
  phase: string;
  result?: any;
  plan?: any;
}

/**
 * Data type detection flags
 */
export interface DataTypeFlags {
  hasUserInfo: boolean;
  hasBalance: boolean;
  hasTransactions: boolean;
  hasLogs: boolean;
} 