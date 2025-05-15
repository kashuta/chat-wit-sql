import { ConfidenceLevel, ErrorType } from './types';

/**
 * Determines if the confidence level is high enough for the agent to proceed
 * @param confidence - Confidence score (0-1)
 * @returns Whether the confidence is high enough to proceed
 */
export const isConfidentEnough = (confidence: number): boolean => {
  return confidence >= ConfidenceLevel.MEDIUM;
};

/**
 * Creates an error object with a specific type
 * @param type - Error type
 * @param message - Error message
 * @returns Error object with type
 */
export const createTypedError = (type: ErrorType, message: string): Error & { type: ErrorType } => {
  const error = new Error(message) as Error & { type: ErrorType };
  error.type = type;
  return error;
};

/**
 * Formats a date to YYYY-MM-DD format for SQL queries
 * @param date - Date to format
 * @returns Formatted date string
 */
export const formatSqlDate = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

/**
 * Gets a date N days ago
 * @param days - Number of days to go back
 * @returns Date object N days ago
 */
export const getDaysAgo = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

/**
 * Creates a safe SQL identifier by escaping special characters
 * @param identifier - SQL identifier (table name, column name, etc.)
 * @returns Safe SQL identifier
 */
export const safeSqlIdentifier = (identifier: string): string => {
  // Replace non-alphanumeric characters with underscores
  return identifier.replace(/[^a-zA-Z0-9_]/g, '_');
};

/**
 * Converts an array of objects to CSV format
 * @param data - Array of objects
 * @returns CSV formatted string
 */
export const objectsToCsv = (data: Record<string, unknown>[]): string => {
  if (data.length === 0) return '';
  
  const headers = Object.keys(data[0]);
  const rows = data.map(obj => headers.map(header => JSON.stringify(obj[header] ?? '')).join(','));
  
  return [headers.join(','), ...rows].join('\n');
}; 