import { DatabaseService, SqlQuery } from '@common/types';
import { getPrismaClient } from '@common/prisma';
import { createTypedError } from '@common/utils';
import { ErrorType } from '@common/types';
import { logDebug, logError, logInfo, logWarn } from '@common/logger';

// Map to track connection status
const connectionStatus: Record<string, boolean> = {};

/**
 * Adds quotes to table names in a PostgreSQL query
 * @param query SQL query
 * @returns Corrected SQL query
 */
const addQuotesToTableNames = (query: string): string => {
  // Regular expression to find table names after FROM and JOIN
  // Looks for table names that start with an uppercase letter and are not enclosed in quotes
  const regex = /\b(FROM|JOIN)\s+([A-Z][a-zA-Z0-9]*)\b(?!\s*AS)(?!\s*"\w+")/g;
  
  // Replace found table names, adding quotes
  const fixedQuery = query.replace(regex, (match, keyword, tableName) => {
    // If the table name is already in quotes, leave it as is
    if (tableName.startsWith('"') && tableName.endsWith('"')) {
      return match;
    }
    return `${keyword} "${tableName}"`;
  });
  
  return fixedQuery;
};

const transformBigIntToNumber = (data: any): any => {
  if (data === null || data === undefined) {
    return data;
  }
  
  if (typeof data === 'bigint') {
    // Convert BigInt to a regular number
    return Number(data);
  }
  
  if (Array.isArray(data)) {
    return data.map(transformBigIntToNumber);
  }
  
  if (typeof data === 'object') {
    const result: Record<string, any> = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        result[key] = transformBigIntToNumber(data[key]);
      }
    }
    return result;
  }
  
  return data;
};

export const listTables = async (service: DatabaseService): Promise<string[]> => {
  try {
    const prisma = getPrismaClient(service);
    logInfo(`Listing tables for database service: ${service}`);
    
    const result = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    
    // Convert result to string array
    const tableNames = Array.isArray(result) 
      ? result.map((r: any) => r.table_name || r.TABLE_NAME) 
      : [];
    
    logInfo(`Found ${tableNames.length} tables in ${service} database: ${tableNames.join(', ')}`);
    return tableNames;
  } catch (error) {
    logError(`Error listing tables for ${service}: ${(error as Error).message}`);
    return [];
  }
};

/**
 * List all schemas in a database service
 * @param service - Database service to check
 * @returns List of schema names
 */
export const listSchemas = async (service: DatabaseService): Promise<string[]> => {
  try {
    const prisma = getPrismaClient(service);
    logInfo(`Listing schemas for database service: ${service}`);
    
    const result = await prisma.$queryRawUnsafe(
      `SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema'`
    );
    
    // Convert result to string array
    const schemaNames = Array.isArray(result)
      ? result.map((r: any) => r.nspname) 
      : [];
    
    logInfo(`Found ${schemaNames.length} schemas in ${service} database: ${schemaNames.join(', ')}`);
    return schemaNames;
  } catch (error) {
    logError(`Error listing schemas for ${service}: ${(error as Error).message}`);
    return [];
  }
};

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
    
    // Add quotes to table names if they start with an uppercase letter
    const modifiedSqlString = addQuotesToTableNames(sqlString);
    
    // Log the original query
    logInfo(`Executing SQL query on ${service} database:`);
    logInfo(`Query: ${sqlString}`);
    
    // If the query was modified, log the changes
    if (modifiedSqlString !== sqlString) {
      logInfo(`Modified query: ${modifiedSqlString}`);
      logInfo(`Added quotes to table names for PostgreSQL compatibility`);
    }
    
    if (params) {
      logDebug(`Query parameters: ${JSON.stringify(params)}`);
    }
    
    // Check if the database connection is working
    if (!await isDbConnected(service)) {
      logError(`Database ${service} is not connected`);
      throw createTypedError(
        ErrorType.DATABASE_ERROR,
        `Database ${service} is not connected`
      );
    }
    
    // DEBUG: Try to discover tables if query fails
    const tryAlternativeQuery = async (error: Error): Promise<Record<string, unknown>[] | null> => {
      logWarn(`Original query failed: ${error.message}. Attempting to discover tables...`);
      
      if (sqlString.includes('"User"') || sqlString.includes('FROM User')) {
        // Query might be looking for a User table - let's explore alternatives
        logInfo(`Query appears to target User table. Checking table existence...`);
        
        try {
          // Check if any user-related tables exist
          const userTablesQuery = `
            SELECT table_name, table_schema 
            FROM information_schema.tables 
            WHERE table_name ILIKE '%user%'
          `;
          const userTables = await prisma.$queryRawUnsafe(userTablesQuery);
          logInfo(`Found user-related tables: ${JSON.stringify(userTables)}`);
          
          if (Array.isArray(userTables) && userTables.length > 0) {
            // Found some user tables, let's try with the first one
            const firstUserTable = userTables[0];
            const tableName = firstUserTable.table_name || firstUserTable.TABLE_NAME;
            const schemaName = firstUserTable.table_schema || firstUserTable.TABLE_SCHEMA || 'public';
            
            logInfo(`Trying with alternative table: "${schemaName}"."${tableName}"`);
            
            // Create alternative query
            let alternativeQuery = sqlString;
            
            if (sqlString.includes('"User"')) {
              alternativeQuery = sqlString.replace('"User"', `"${tableName}"`);
            } else if (sqlString.includes('FROM User')) {
              alternativeQuery = sqlString.replace('FROM User', `FROM "${tableName}"`);
            }
            
            logInfo(`Executing alternative query: ${alternativeQuery}`);
            try {
              const result = await prisma.$queryRawUnsafe(alternativeQuery);
              logInfo(`Alternative query succeeded with ${Array.isArray(result) ? result.length : 0} results`);
              return Array.isArray(result) ? result : [{ result }];
            } catch (altError) {
              logWarn(`Alternative query failed: ${(altError as Error).message}`);
            }
          }
        } catch (discoveryError) {
          logWarn(`Error during table discovery: ${(discoveryError as Error).message}`);
        }
      }
      
      return null;
    };
    
    // Execute the query
    const startTime = Date.now();
    
    try {
      // Use the modified query with quotes for tables
      const result = await prisma.$queryRawUnsafe(modifiedSqlString, ...(params ? Object.values(params) : []));
      const executionTime = Date.now() - startTime;
      
      // Validate and transform the result
      if (!result) {
        logWarn(`Query returned null or undefined result from database ${service}`);
        return [];
      }
      
      if (!Array.isArray(result)) {
        logWarn(`Query returned non-array result from database ${service}: ${typeof result}`);
        // Convert non-array result to array with a single item
        return [{ result }];
      }
      
      logInfo(`Query executed successfully in ${executionTime}ms`);
      logInfo(`Result rows: ${result.length}`);
      
      // Convert BigInt values for safe JSON serialization
      const transformedResult = transformBigIntToNumber(result);
      
      if (result.length === 0) {
        logWarn(`Query returned empty result set. This might indicate:
        - Table exists but is empty
        - Table exists but query conditions matched no records
        - Table name might be correct but in a different case (PostgreSQL is case-sensitive)`);
        
        // If query was looking for users, try alternative ways to find users
        if (sqlString.toLowerCase().includes('user') && 
            (sqlString.toLowerCase().includes('count') || sqlString.toLowerCase().includes('select'))) {
          logInfo(`Query appears to be looking for users but returned empty. Trying diagnostic queries...`);
          
          try {
            // Check for tables matching user pattern
            const tableCheck = await prisma.$queryRawUnsafe(`
              SELECT table_name, table_schema 
              FROM information_schema.tables 
              WHERE table_name ILIKE '%user%'
            `);
            
            logInfo(`Tables matching 'user' pattern: ${JSON.stringify(tableCheck)}`);
            
            // If we found user tables, suggest them
            if (Array.isArray(tableCheck) && tableCheck.length > 0) {
              const tableNames = tableCheck.map(t => `${t.table_schema}.${t.table_name}`).join(', ');
              logInfo(`Found user-related tables: ${tableNames}. Consider using these table names instead.`);
            }
          } catch (checkError) {
            logWarn(`Error checking for user tables: ${(checkError as Error).message}`);
          }
        }
      } else if (result.length <= 5) {
        // Only log full results for small result sets
        logDebug(`Query results: ${JSON.stringify(transformedResult, null, 2)}`);
      } else {
        // For larger result sets, log only the first few items
        logDebug(`First 5 results: ${JSON.stringify(transformedResult.slice(0, 5), null, 2)}`);
      }
      
      // Always return transformed result to handle BigInt values
      return transformedResult;
    } catch (queryError) {
      // Enhanced logging for SQL syntax errors
      logError(`SQL Error in query: ${sqlString}`);
      logError(`SQL Error details: ${(queryError as Error).message}`);
      
      // Try to provide more helpful context about the error
      if ((queryError as Error).message.includes('relation') && (queryError as Error).message.includes('does not exist')) {
        logError(`Table name might be incorrect. In PostgreSQL, table names are case-sensitive and may need quotes for capitalized names.`);
        logError(`Try using "TableName" instead of TableName for capitalized table names.`);
        
        // Try alternative tables
        const alternativeResult = await tryAlternativeQuery(queryError as Error);
        if (alternativeResult) {
          logInfo(`Successfully executed query with alternative table name`);
          return alternativeResult;
        }
      } else if ((queryError as Error).message.includes('column') && (queryError as Error).message.includes('does not exist')) {
        logError(`Column name might be incorrect. Check the column names in the database schema.`);
      } else if ((queryError as Error).message.includes('syntax error')) {
        logError(`SQL syntax error detected. Please review the query syntax.`);
      }
      
      throw queryError;
    }
  } catch (error) {
    logError(`Error executing SQL query on ${query.service}: ${(error as Error).message}`);
    
    // In development, we could provide more detailed error info
    if (process.env.NODE_ENV === 'development') {
      if (error instanceof Error && error.stack) {
        logDebug(`Error stack trace: ${error.stack}`);
      }
      
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
  // Check if connection is already established
  if (connectionStatus[service]) {
    logInfo(`Database ${service} is already connected.`);
    return true;
  }

  logInfo(`Checking database connection for service: ${service}`);
  const prisma = getPrismaClient(service);
  
  // Try a simple query to check the connection
  await prisma.$queryRawUnsafe(`SELECT 1`);
  logInfo(`Database connection to ${service} successful.`);
  connectionStatus[service] = true; // Mark as connected
  return true;
};

/**
 * Connect to all database services at startup
 */
export const setupDatabaseConnections = async (): Promise<void> => {
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
  logInfo('Setting up database connections for all services...');

  for (const service of services) {
    try {
      // Don't await here to allow parallel connection checks
      isDbConnected(service);
    } catch (error) {
      // Error logging is handled within isDbConnected
      // Continue to attempt connections for other services
      logWarn(`Initial connection check for ${service} failed, will retry on demand.`);
    }
  }
  logInfo('Finished initial database connection checks.');
}; 