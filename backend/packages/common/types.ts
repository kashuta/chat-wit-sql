/**
 * Query request from the user
 */
export interface QueryRequest {
  query: string;
}

/**
 * Query response with results and metadata
 */
export interface QueryResponse {
  data: unknown;
  explanation: string;
  confidence: number;
  sql?: string;
  visualization?: {
    type: 'table' | 'line' | 'bar' | 'pie';
    data: unknown;
  };
}

/**
 * Database service identifiers 
 */
export type DatabaseService = 'wallet' | 'bets-history' | 'user-activities' | 'financial-history';

/**
 * SQL query with metadata
 */
export interface SqlQuery {
  service: DatabaseService;
  query: string;
  params?: Record<string, unknown>;
}

/**
 * Agent confidence levels
 */
export enum ConfidenceLevel {
  LOW = 0.3,
  MEDIUM = 0.7,
  HIGH = 0.9,
}

/**
 * Query plan for execution
 */
export interface QueryPlan {
  steps: Array<{
    service: DatabaseService;
    description: string;
    sqlQuery?: string;
  }>;
  requiredServices: DatabaseService[];
}

/**
 * Error types for fallback handling
 */
export enum ErrorType {
  INVALID_QUERY = 'invalid_query',
  SCHEMA_MISMATCH = 'schema_mismatch',
  DATABASE_ERROR = 'database_error',
  PROCESSING_ERROR = 'processing_error',
}

/**
 * Result from the perception module
 */
export interface PerceptionResult {
  intent: string;
  confidence: number;
  entities: Record<string, unknown> | null;
  requiredServices: DatabaseService[];
  sqlQuery?: string | null;
} 