import { DatabaseService, SqlQuery } from '@common/types';
import { getPrismaClient } from '@common/prisma';
import { createTypedError } from '@common/utils';
import { ErrorType } from '@common/types';

/**
 * Execute a raw SQL query against a database service
 * @param query - SQL query object with service and query string
 * @returns Query results
 */
export const executeSqlQuery = async (
  query: SqlQuery
): Promise<Record<string, unknown>[]> => {
  try {
    const { service, query: sqlString, params } = query;
    const prisma = getPrismaClient(service);
    
    console.log(`Executing query on ${service} database:`);
    console.log(sqlString);
    
    // If we have connection issues or Prisma errors, we'll use mock data in development
    if (process.env.NODE_ENV === 'development' && !isDbConnected(service)) {
      console.warn(`Database ${service} not connected, using mock data`);
      return getMockData(service);
    }
    
    // Execute the query
    const result = await prisma.$queryRawUnsafe(sqlString, ...(params ? Object.values(params) : []));
    
    // Validate and transform the result
    if (!result || !Array.isArray(result)) {
      throw createTypedError(
        ErrorType.DATABASE_ERROR,
        `Invalid result format from database ${service}`
      );
    }
    
    return result;
  } catch (error) {
    console.error(`Error executing SQL query on ${query.service}:`, error);
    
    if (process.env.NODE_ENV === 'development') {
      // In development, return mock data if query fails
      return getMockData(query.service);
    }
    
    throw createTypedError(
      ErrorType.DATABASE_ERROR,
      `Failed to execute query on ${query.service}: ${(error as Error).message}`
    );
  }
};

/**
 * Check if database is connected
 * @param service - Database service to check
 * @returns Whether the database is connected
 */
const isDbConnected = (service: DatabaseService): boolean => {
  try {
    // This is a simplified check - in production you would want a more robust check
    const prisma = getPrismaClient(service);
    return !!prisma;
  } catch (error) {
    return false;
  }
};

/**
 * Get mock data for a service when the database is not available
 * @param service - Database service to get mock data for
 * @returns Mock data for the service
 */
const getMockData = (service: DatabaseService): Record<string, unknown>[] => {
  switch (service) {
    case 'wallet':
      return [
        { user_id: 1, balance: 1000, currency: 'USD' },
        { user_id: 2, balance: 2500, currency: 'EUR' },
        { user_id: 3, balance: 500, currency: 'USD' },
      ];
    
    case 'bets-history':
      return [
        { user_id: 1, bet_amount: 100, game_type: 'slots', created_at: new Date().toISOString() },
        { user_id: 2, bet_amount: 50, game_type: 'poker', created_at: new Date().toISOString() },
        { user_id: 3, bet_amount: 200, game_type: 'sports', created_at: new Date().toISOString() },
      ];
    
    case 'user-activities':
      return [
        { user_id: 1, action: 'login', created_at: new Date().toISOString() },
        { user_id: 2, action: 'deposit', created_at: new Date().toISOString() },
        { user_id: 3, action: 'bet', created_at: new Date().toISOString() },
      ];
    
    case 'financial-history':
      return [
        { user_id: 1, amount: 500, record_type: 'deposit', created_at: new Date().toISOString() },
        { user_id: 2, amount: 100, record_type: 'withdrawal', created_at: new Date().toISOString() },
        { user_id: 3, amount: 1000, record_type: 'deposit', created_at: new Date().toISOString() },
      ];
    
    default:
      return [];
  }
};

/**
 * Connect to all database services at startup
 */
export const setupDatabaseConnections = async (): Promise<void> => {
  try {
    // Check environment variables
    const requiredEnvVars = [
      'DATABASE_URL_WALLET',
      'DATABASE_URL_BETS_HISTORY',
      'DATABASE_URL_USER_ACTIVITIES',
      'DATABASE_URL_FINANCIAL_HISTORY',
    ];
    
    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingEnvVars.length > 0) {
      console.warn(`Missing database environment variables: ${missingEnvVars.join(', ')}`);
      console.warn('Some database connections may not work correctly');
    }
    
    // Initialize Prisma clients
    const services: DatabaseService[] = [
      'wallet',
      'bets-history',
      'user-activities',
      'financial-history',
    ];
    
    // Pre-initialize clients
    for (const service of services) {
      try {
        getPrismaClient(service);
        console.log(`Initialized ${service} database client`);
      } catch (error) {
        console.error(`Failed to initialize ${service} database client:`, error);
      }
    }
    
    console.log('Database setup complete');
  } catch (error) {
    console.error('Failed to set up database connections:', error);
    
    if (process.env.NODE_ENV === 'production') {
      throw error;
    } else {
      console.warn('Running in development mode with mocked data');
    }
  }
}; 