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
 * Safely serializes an object to JSON, properly handling BigInt values
 * @param data - Any data structure that may contain BigInt values
 * @returns JSON string with BigInt values converted to strings
 */
export const safeJsonStringify = (data: any): string => {
  return JSON.stringify(data, (_, value) => 
    typeof value === 'bigint' ? value.toString() : value
  );
};

/**
 * Transforms any object with BigInt values to have string representations instead
 * @param data - Data object or array that may contain BigInt values
 * @returns Same structure with BigInt values converted to strings
 */
export const serializeBigInt = (data: any): any => {
  if (data === null || data === undefined) {
    return data;
  }
  
  if (typeof data === 'bigint') {
    return data.toString();
  }
  
  if (Array.isArray(data)) {
    return data.map(serializeBigInt);
  }
  
  if (typeof data === 'object') {
    const result: Record<string, any> = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        result[key] = serializeBigInt(data[key]);
      }
    }
    return result;
  }
  
  return data;
};

/**
 * Converts an array of objects to CSV format
 * @param data - Array of objects
 * @returns CSV formatted string
 */
export const objectsToCsv = (data: Record<string, unknown>[]): string => {
  if (data.length === 0) return '';
  
  const headers = Object.keys(data[0]);
  const rows = data.map(obj => 
    headers.map(header => {
      const value = obj[header];
      return typeof value === 'bigint' 
        ? `"${value.toString()}"` 
        : JSON.stringify(value ?? '');
    }).join(',')
  );
  
  return [headers.join(','), ...rows].join('\n');
}; 