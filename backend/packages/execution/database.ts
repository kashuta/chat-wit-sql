import { DatabaseService, SqlQuery } from '@common/types';
import { getPrismaClient } from '@common/prisma';
import { createTypedError } from '@common/utils';
import { ErrorType } from '@common/types';

// Map to track connection status
const connectionStatus: Record<string, boolean> = {};

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
    
    // Check if the database connection is working
    if (!await isDbConnected(service)) {
      throw createTypedError(
        ErrorType.DATABASE_ERROR,
        `Database ${service} is not connected`
      );
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
    
    // In development, we could provide more detailed error info
    if (process.env.NODE_ENV === 'development') {
      throw createTypedError(
        ErrorType.DATABASE_ERROR,
        `Failed to execute query on ${query.service}: ${(error as Error).message}`
      );
    }
    
    // In production, provide a more generic error
    throw createTypedError(
      ErrorType.DATABASE_ERROR,
      `Failed to execute query on ${query.service}`
    );
  }
};

/**
 * Check if database is connected by performing a simple query
 * @param service - Database service to check
 * @returns Whether the database is connected
 */
const isDbConnected = async (service: DatabaseService): Promise<boolean> => {
  // Return cached status if available
  if (connectionStatus[service] !== undefined) {
    return connectionStatus[service];
  }
  
  try {
    const prisma = getPrismaClient(service);
    
    // Try to execute a simple query to check connection
    // This should be a lightweight query that works on any database
    await prisma.$queryRaw`SELECT 1 as connected`;
    
    // Cache the connection status
    connectionStatus[service] = true;
    return true;
  } catch (error) {
    console.error(`Database ${service} connection check failed:`, error);
    
    // Cache the connection status
    connectionStatus[service] = false;
    return false;
  }
};

/**
 * Connect to all database services at startup
 */
export const setupDatabaseConnections = async (): Promise<void> => {
  try {
    // Define all database services
    const services: DatabaseService[] = [
      'wallet',
      'bets-history',
      'user-activities',
      'financial-history',
      'affiliate',
      'casino-st8',
      'geolocation',
      'kyc',
      'notification',
      'optimove',
      'pam',
      'payment-gateway',
      'traffic'
    ];
    
    // Check environment variables
    const envPrefix = 'DATABASE_URL_';
    const missingEnvVars = services
      .map(service => {
        // Convert service name to env var name (e.g., 'bets-history' -> 'BETS_HISTORY')
        const envSuffix = service.toUpperCase().replace(/-/g, '_');
        return `${envPrefix}${envSuffix}`;
      })
      .filter(varName => !process.env[varName]);
    
    if (missingEnvVars.length > 0) {
      console.warn(`Missing database environment variables: ${missingEnvVars.join(', ')}`);
      console.warn('Some database connections may not work correctly');
    }
    
    // Check connections for all services
    console.log('Checking database connections...');
    const connectionPromises = services.map(async (service) => {
      try {
        const connected = await isDbConnected(service);
        console.log(`${service} database: ${connected ? 'Connected ✅' : 'Not connected ❌'}`);
        return { service, connected };
      } catch (error) {
        console.error(`Failed to check ${service} database connection:`, error);
        return { service, connected: false };
      }
    });
    
    const results = await Promise.all(connectionPromises);
    const connectedCount = results.filter(r => r.connected).length;
    
    console.log(`Database connections established: ${connectedCount}/${services.length}`);
    
    if (connectedCount === 0 && process.env.NODE_ENV === 'production') {
      throw new Error('No database connections could be established in production mode');
    } else if (connectedCount === 0) {
      console.warn('No database connections could be established. Running in development mode.');
    }
  } catch (error) {
    console.error('Failed to set up database connections:', error);
    
    if (process.env.NODE_ENV === 'production') {
      throw error;
    } else {
      console.warn('Running in development mode without database connections');
    }
  }
}; 