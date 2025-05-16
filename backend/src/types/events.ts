/**
 * Event tracking system for SQL query execution
 */

export enum EventStatus {
  STARTED = 'started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ERROR = 'error'
}

export enum EventType {
  QUERY_RECEIVED = 'query_received',
  PERCEPTION_ANALYSIS = 'perception_analysis',
  PLANNING = 'planning',
  CONFLICT_DETECTION = 'conflict_detection',
  CONFLICT_RESOLUTION = 'conflict_resolution',
  SQL_EXECUTION = 'sql_execution',
  STEP_EXECUTION = 'step_execution',
  RESULT_PROCESSING = 'result_processing',
  RESPONSE_GENERATION = 'response_generation',
  COMPLETION = 'completion'
}

export interface BaseEvent {
  id: string;
  queryId: string;
  timestamp: number;
  type: EventType;
  status: EventStatus;
}

export interface QueryReceivedEvent extends BaseEvent {
  type: EventType.QUERY_RECEIVED;
  payload: {
    query: string;
    language: string;
  };
}

export interface PerceptionAnalysisEvent extends BaseEvent {
  type: EventType.PERCEPTION_ANALYSIS;
  payload: {
    intent?: string;
    confidence?: number;
    requiredServices?: string[];
    requiredTables?: string[];
  };
}

export interface PlanningEvent extends BaseEvent {
  type: EventType.PLANNING;
  payload: {
    planId?: string;
    stepCount?: number;
    requiredServices?: string[];
  };
}

export interface ConflictEvent extends BaseEvent {
  type: EventType.CONFLICT_DETECTION | EventType.CONFLICT_RESOLUTION;
  payload: {
    conflicts?: Array<{
      type: string;
      description: string;
    }>;
    hasConflicts?: boolean;
  };
}

export interface SQLExecutionEvent extends BaseEvent {
  type: EventType.SQL_EXECUTION;
  payload: {
    service?: string;
    sql?: string;
  };
}

export interface StepExecutionEvent extends BaseEvent {
  type: EventType.STEP_EXECUTION;
  payload: {
    stepId: string;
    stepNumber: number;
    totalSteps: number;
    service?: string;
    operation?: string;
    description?: string;
  };
}

export interface ResultProcessingEvent extends BaseEvent {
  type: EventType.RESULT_PROCESSING;
  payload: {
    resultCount?: number;
    services?: string[];
  };
}

export interface ResponseGenerationEvent extends BaseEvent {
  type: EventType.RESPONSE_GENERATION;
  payload: {
    confidence?: number;
  };
}

export interface CompletionEvent extends BaseEvent {
  type: EventType.COMPLETION;
  payload: {
    totalTime?: number;
    stepCount?: number;
  };
}

export type QueryEvent = 
  | QueryReceivedEvent
  | PerceptionAnalysisEvent
  | PlanningEvent
  | ConflictEvent
  | SQLExecutionEvent
  | StepExecutionEvent
  | ResultProcessingEvent
  | ResponseGenerationEvent
  | CompletionEvent; 