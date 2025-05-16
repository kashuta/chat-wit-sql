import { DatabaseService, ErrorType, SqlQuery } from '@common/types';
import { getPrismaClient } from '@common/prisma';
import { createTypedError, serializeBigInt } from '@common/utils';
import { logDebug, logError, logInfo, logWarn } from '@common/logger';
import { databaseKnowledge } from '@common/knowledge';

const connectionStatus: Record<string, boolean> = {};
const databaseClients: Record<string, any> = {};
const databaseConnections: Record<string, boolean> = {
  wallet: false,
  'bets-history': false,
  'user-activities': false,
  'financial-history': false,
  affiliate: false,
  'casino-st8': false,
  geolocation: false,
  kyc: false,
  notification: false,
  optimove: false,
  pam: false,
  'payment-gateway': false,
  traffic: false
};

const transformBigIntToNumber = (data: any): any => {
  if (data === null || data === undefined) {
    return data;
  }
  
  if (typeof data === 'bigint') {
    return data.toString();
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

export const serializeQueryResults = (results: any[]): any[] => {
  try {
    return serializeBigInt(results);
  } catch (error) {
    logError(`Error serializing query results: ${(error as Error).message}`);
    return results;
  }
};

export const listTables = async (service: DatabaseService): Promise<string[]> => {
  try {
    const prisma = getPrismaClient(service);
    logInfo(`Listing tables for database service: ${service}`);
    
    const result = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    
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

export const listSchemas = async (service: DatabaseService): Promise<string[]> => {
  try {
    const prisma = getPrismaClient(service);
    logInfo(`Listing schemas for database service: ${service}`);
    
    const result = await prisma.$queryRawUnsafe(
      `SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema'`
    );
    
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

export const executeSqlQuery = async ({ service, query }: SqlQuery): Promise<any[]> => {
  try {
    logInfo(`Executing SQL query on ${service} database:`);
    logInfo(`Query: ${query}`);
    
    if (!connectionStatus[service]) {
      logWarn(`Database ${service} is not connected. Connecting now...`);
      await testConnection(service);
    }
    
    logInfo(`Database ${service} is already connected.`);
    
    const prismaClient = getPrismaClient(service);
    if (!prismaClient) {
      throw createTypedError(
        ErrorType.DATABASE_ERROR,
        `Could not get prisma client for service: ${service}`
      );
    }
    
    const result = await executeAndValidateQuery(service, query, prismaClient);
    const duration = result.duration;
    
    logInfo(`Query executed successfully in ${duration}ms`);
    
    if (Array.isArray(result.data) && result.data.length === 0) {
      logInfo(`Result rows: ${result.data.length}`);
      logWarn(`Query returned empty result set. This might indicate:
      - Table exists but is empty
      - Table exists but query conditions matched no records
      - Table name might be correct but in a different case (PostgreSQL is case-sensitive)`);
      
      await handleEmptyResults(service, query, prismaClient);
    } else {
      logInfo(`Result rows: ${Array.isArray(result.data) ? result.data.length : 'non-array'}`);
      
      if (Array.isArray(result.data) && result.data.length > 0) {
        logDebug(`Query results: ${JSON.stringify(result.data.slice(0, 3), (_, value) => typeof value === 'bigint' ? value.toString() : value)}`);
        if (result.data.length > 3) {
          logDebug(`... and ${result.data.length - 3} more rows`);
        }
      }
    }
    
    return Array.isArray(result.data) ? serializeQueryResults(result.data) : [];
  } catch (error) {
    logError(`Error executing SQL query on ${service}: ${(error as Error).message}`);
    logDebug(`Error stack trace: ${(error as Error).stack}`);
    throw error;
  }
};

async function executeAndValidateQuery(service: DatabaseService, query: string, prismaClient: any): Promise<{data: any[], duration: number}> {
  try {
    databaseClients[service] = prismaClient;
    databaseConnections[service] = true;
    
    const validatedQuery = await validateQueryTables(service, query);
    
    if (validatedQuery !== query) {
      logInfo(`Query was modified to fix table references:`);
      logInfo(`Original: ${query}`);
      logInfo(`Fixed: ${validatedQuery}`);
      query = validatedQuery;
    }
    
    const fixedQuery = await fixColumnAndTableCase(service, query);
    
    if (fixedQuery !== query) {
      logInfo(`Query was modified to fix case sensitivity issues:`);
      logInfo(`Original: ${query}`);
      logInfo(`Fixed: ${fixedQuery}`);
      query = fixedQuery;
    }
    
    const startTime = Date.now();
    const result = await prismaClient.$queryRawUnsafe(query);
    const duration = Date.now() - startTime;
    
    return {
      data: result,
      duration
    };
  } catch (error) {
    const errorMsg = (error as Error).message;
    logError(`SQL Error in query: ${query}`);
    logError(`SQL Error details: ${errorMsg}`);
    
    if (errorMsg.includes('relation') && errorMsg.includes('does not exist')) {
      logError(`Table name might be incorrect. In PostgreSQL, table names are case-sensitive and may need quotes for capitalized names.`);
      logError(`Try using "TableName" instead of TableName for capitalized table names.`);
    } else if (errorMsg.includes('column') && errorMsg.includes('does not exist')) {
      logError(`Column name might be incorrect. Check the column names in the database schema.`);
    } else if (errorMsg.includes('syntax error')) {
      logError(`SQL syntax error detected. Please review the query syntax.`);
    }
    
    if ((errorMsg.includes('relation') && errorMsg.includes('does not exist'))) {
      logWarn(`Original query failed: ${errorMsg}. Attempting to discover tables...`);
      
      const tableMatch = errorMsg.match(/relation "([^"]+)" does not exist/);
      
      if (tableMatch) {
        const problematicTable = tableMatch[1];
        logInfo(`Query appears to target ${problematicTable} table. Checking table existence...`);
        
        try {
          const alternativeQuery = await tryFixTableReference(service, problematicTable, query, prismaClient);
          
          if (alternativeQuery) {
            logInfo(`Executing alternative query: ${alternativeQuery}`);
            const startTime = Date.now();
            const alternativeResult = await prismaClient.$queryRawUnsafe(alternativeQuery);
            const duration = Date.now() - startTime;
            
            return {
              data: alternativeResult,
              duration
            };
          }
        } catch (altError) {
          logWarn(`Alternative query failed: ${(altError as Error).message}`);
        }
      }
    }
    
    throw createTypedError(
      ErrorType.DATABASE_ERROR,
      `Failed to execute query on ${service}: ${errorMsg}`
    );
  }
}

async function validateQueryTables(service: DatabaseService, query: string): Promise<string> {
  if (!databaseKnowledge.isLoaded()) {
    return query;
  }
  
  const dbInfo = databaseKnowledge.getDatabaseDescription(service);
  if (!dbInfo) {
    return query;
  }
  
  const tableRegex = /\bFROM\s+"?([A-Za-z0-9_]+)"?/gi;
  const joinRegex = /\bJOIN\s+"?([A-Za-z0-9_]+)"?/gi;
  const subqueryFromRegex = /\(\s*SELECT\s+.+?\s+FROM\s+"?([A-Za-z0-9_]+)"?/gi;
  
  let modifiedQuery = query;
  let matches;
  
  // Build a map of tables for all services for cross-reference checking
  const allServicesTables = new Map<string, string[]>();
  const allDatabases = databaseKnowledge.getAllDatabases();
  
  for (const db of allDatabases) {
    allServicesTables.set(db.service, db.tables.map(t => t.name));
  }
  
  // Process all table references in the query
  const processTableReference = (tableName: string, regex: RegExp | null = null, matchStr: string | null = null) => {
    const knownTables = dbInfo.tables.map(t => t.name);
    
    // Check if table exists in this service
    const tableExists = knownTables.some(t => t.toLowerCase() === tableName.toLowerCase());
    
    if (!tableExists) {
      // Check if this table exists in another service
      let crossServiceTable = false;
      let crossServiceName = '';
      
      for (const [serviceName, tables] of allServicesTables.entries()) {
        if (serviceName !== service && tables.some(t => t.toLowerCase() === tableName.toLowerCase())) {
          crossServiceTable = true;
          crossServiceName = serviceName;
          break;
        }
      }
      
      if (crossServiceTable) {
        logInfo(`Table "${tableName}" was found in service "${crossServiceName}" but is being referenced in ${service} service.`);
        // We don't try to fix cross-service tables here - that should be handled at the plan building stage
      } else {
        // Try to find similar table names in this service
        const similarNames = findSimilarTableNames(knownTables, tableName);
        
        if (similarNames.length > 0) {
          const correctName = similarNames[0];
          logInfo(`Fixing table reference: "${tableName}" -> "${correctName}"`);
          
          if (regex && matchStr) {
            // Replace specific match with correct table name
            const oldPart = matchStr;
            const newPart = oldPart.replace(
              new RegExp(`\\b${tableName}\\b`, 'gi'),
              `"${correctName}"`
            );
            modifiedQuery = modifiedQuery.replace(oldPart, newPart);
          } else {
            // Generic replacement for all occurrences
            modifiedQuery = modifiedQuery.replace(
              new RegExp(`\\b${tableName}\\b`, 'gi'),
              `"${correctName}"`
            );
          }
        }
      }
    } else {
      // Table exists but might have wrong case
      const exactTable = knownTables.find(t => t.toLowerCase() === tableName.toLowerCase());
      
      if (exactTable && exactTable !== tableName) {
        logInfo(`Correcting table case: "${tableName}" -> "${exactTable}"`);
        
        if (regex && matchStr) {
          const oldPart = matchStr;
          const newPart = oldPart.replace(
            new RegExp(`\\b${tableName}\\b`, 'gi'),
            `"${exactTable}"`
          );
          modifiedQuery = modifiedQuery.replace(oldPart, newPart);
        } else {
          modifiedQuery = modifiedQuery.replace(
            new RegExp(`\\b${tableName}\\b`, 'gi'),
            `"${exactTable}"`
          );
        }
      }
      
      // Also ensure proper quoting for table names
      if (!tableName.startsWith('"') && !tableName.endsWith('"')) {
        modifiedQuery = modifiedQuery.replace(
          new RegExp(`\\b${tableName}\\b(?!")`, 'g'),
          `"${exactTable || tableName}"`
        );
      }
    }
  };
  
  // Process FROM clauses
  while ((matches = tableRegex.exec(query)) !== null) {
    if (matches[1]) {
      processTableReference(matches[1], tableRegex, matches[0]);
    }
  }
  
  // Process JOIN clauses
  while ((matches = joinRegex.exec(query)) !== null) {
    if (matches[1]) {
      processTableReference(matches[1], joinRegex, matches[0]);
    }
  }
  
  // Process subqueries
  while ((matches = subqueryFromRegex.exec(query)) !== null) {
    if (matches[1]) {
      processTableReference(matches[1], subqueryFromRegex, matches[0]);
    }
  }
  
  return modifiedQuery;
}

function findSimilarTableNames(knownTables: string[], tableName: string): string[] {
  const lowerInput = tableName.toLowerCase();
  
  const directMatches = knownTables.filter(t => 
    t.toLowerCase() === lowerInput);
  
  if (directMatches.length > 0) {
    return directMatches;
  }
  
  const partialMatches = knownTables.filter(t => 
    t.toLowerCase().includes(lowerInput) || 
    lowerInput.includes(t.toLowerCase()));
  
  if (partialMatches.length > 0) {
    return partialMatches;
  }
  
  return [];
}

async function handleEmptyResults(_service: DatabaseService, query: string, prismaClient: any): Promise<void> {
  if (query.toLowerCase().includes('from') && query.toLowerCase().includes('where')) {
    logInfo(`Query appears to be looking for users but returned empty. Trying diagnostic queries...`);
    
    const tableNameMatches = query.match(/from\s+"?(\w+)"?/i);
    if (tableNameMatches && tableNameMatches.length > 1) {
      const tableName = tableNameMatches[1];
      
      try {
        const tablesQuery = `
          SELECT table_name, table_schema 
          FROM information_schema.tables 
          WHERE table_name ILIKE '%${tableName.replace(/[^a-zA-Z0-9]/g, '')}%'
        `;
        const tables = await prismaClient.$queryRawUnsafe(tablesQuery);
        
        if (Array.isArray(tables) && tables.length > 0) {
          logInfo(`Tables matching '${tableName}' pattern: ${JSON.stringify(tables)}`);
          
          const tableList = tables.map(t => `${t.table_schema}.${t.table_name}`).join(', ');
          logInfo(`Found ${tables.length} ${tableName}-related tables: ${tableList}. Consider using these table names instead.`);
        }
      } catch (schemaError) {
        logWarn(`Error querying information schema: ${(schemaError as Error).message}`);
      }
    }
  }
}

async function tryFixTableReference(service: DatabaseService, problematicTable: string, query: string, prismaClient: any): Promise<string | null> {
  try {
    const tablesQuery = `
      SELECT table_name, table_schema 
      FROM information_schema.tables 
      WHERE table_name ILIKE '%${problematicTable.replace(/[^a-zA-Z0-9]/g, '')}%'
    `;
    const tables = await prismaClient.$queryRawUnsafe(tablesQuery);
    
    if (Array.isArray(tables) && tables.length > 0) {
      logInfo(`Found ${problematicTable}-related tables: ${JSON.stringify(tables)}`);
      
      if (tables.length > 0) {
        const alternativeTable = tables[0].table_name;
        logInfo(`Trying with alternative table: "${tables[0].table_schema}"."${alternativeTable}"`);
        
        const alternativeQuery = query.replace(
          new RegExp(`"?${problematicTable}"?`, 'g'),
          `"${alternativeTable}"`
        );
        
        return alternativeQuery;
      }
    }
    
    const dbInfo = databaseKnowledge.getDatabaseDescription(service);
    if (dbInfo) {
      const knownTables = dbInfo.tables.map(t => t.name);
      const similarNames = findSimilarTableNames(knownTables, problematicTable);
      
      if (similarNames.length > 0) {
        const correctTable = similarNames[0];
        logInfo(`Found similar table in database schema: "${correctTable}"`);
        
        const alternativeQuery = query.replace(
          new RegExp(`"?${problematicTable}"?`, 'g'),
          `"${correctTable}"`
        );
        
        return alternativeQuery;
      }
    }
    
    return null;
  } catch (error) {
    logWarn(`Error fixing table reference: ${(error as Error).message}`);
    return null;
  }
}

export const fixColumnAndTableCase = async (
  service: DatabaseService,
  query: string
): Promise<string> => {
  try {
    if (!databaseConnections[service]) {
      return query;
    }
    
    const client = databaseClients[service];
    if (!client) {
      logWarn(`Client for service ${service} not found, skipping case fix`);
      return query;
    }
    
    const tableRegex = /FROM\s+"?([A-Za-z0-9_]+)"?/gi;
    let tableMatch;
    let fixedQuery = query;
    
    while ((tableMatch = tableRegex.exec(query)) !== null) {
      const tableName = tableMatch[1];
      
      try {
        const tableResults = await client.$queryRawUnsafe(`
          SELECT table_name
          FROM information_schema.tables 
          WHERE LOWER(table_name) = LOWER($1) AND table_schema = 'public'
        `, tableName);
        
        if (tableResults && Array.isArray(tableResults) && tableResults.length > 0) {
          const correctTableName = tableResults[0].table_name;
          
          if (correctTableName !== tableName) {
            logInfo(`Fixing table name case: "${tableName}" -> "${correctTableName}"`);
            
            const oldPart = tableMatch[0];
            const newPart = oldPart.replace(new RegExp(`"?${tableName}"?`, 'i'), `"${correctTableName}"`);
            fixedQuery = fixedQuery.replace(oldPart, newPart);
            
            const tableReferenceRegex = new RegExp(`([^a-zA-Z0-9_])"?${tableName}"?\\.`, 'gi');
            fixedQuery = fixedQuery.replace(tableReferenceRegex, `$1"${correctTableName}".`);
          }
          
          try {
            const columnResults = await client.$queryRawUnsafe(`
              SELECT column_name
              FROM information_schema.columns 
              WHERE LOWER(table_name) = LOWER($1) AND table_schema = 'public'
            `, correctTableName);
            
            if (columnResults && Array.isArray(columnResults)) {
              const columnMap = new Map<string, string>();
              
              for (const col of columnResults) {
                columnMap.set(col.column_name.toLowerCase(), col.column_name);
              }
              
              logDebug(`Table "${correctTableName}" columns: ${Array.from(columnMap.values()).join(', ')}`);
              
              const columnRegex = new RegExp(`"?${correctTableName}"?\\."?([A-Za-z0-9_]+)"?`, 'gi');
              let columnMatch;
              
              while ((columnMatch = columnRegex.exec(fixedQuery)) !== null) {
                const columnName = columnMatch[1];
                const columnLower = columnName.toLowerCase();
                
                if (columnMap.has(columnLower) && columnMap.get(columnLower) !== columnName) {
                  const correctColumnName = columnMap.get(columnLower) || columnName;
                  logInfo(`Fixing column name case: "${columnName}" -> "${correctColumnName}"`);
                  
                  const oldPart = columnMatch[0];
                  const newPart = oldPart.replace(new RegExp(`"?${columnName}"?`), `"${correctColumnName}"`);
                  fixedQuery = fixedQuery.replace(oldPart, newPart);
                }
              }
              
              for (const [lowercaseCol, correctCol] of columnMap.entries()) {
                const standaloneColRegex = new RegExp(`(SELECT|GROUP BY|ORDER BY|WHERE|AND|OR|,)\\s+"?([A-Za-z0-9_]+)"?\\b`, 'gi');
                let standaloneMatch;
                
                while ((standaloneMatch = standaloneColRegex.exec(fixedQuery)) !== null) {
                  const colName = standaloneMatch[2];
                  
                  if (colName.toLowerCase() === lowercaseCol && colName !== correctCol) {
                    if (!fixedQuery.includes(` AS ${colName}`)) {
                      logInfo(`Fixing standalone column name: "${colName}" -> "${correctCol}"`);
                      
                      const oldPart = standaloneMatch[0];
                      const newPart = oldPart.replace(new RegExp(`"?${colName}"?\\b`), `"${correctCol}"`);
                      fixedQuery = fixedQuery.replace(oldPart, newPart);
                    }
                  }
                }
              }
              
              const clauses = ["GROUP BY", "ORDER BY", "WHERE"];
              for (const clause of clauses) {
                const clauseRegex = new RegExp(`${clause}\\s+([^;]*)`, 'i');
                const clauseMatch = fixedQuery.match(clauseRegex);
                
                if (clauseMatch) {
                  const clauseContent = clauseMatch[1];
                  let modifiedClauseContent = clauseContent;
                  
                  const columnNamesRegex = /\b([A-Za-z0-9_]+)\b/g;
                  let colMatch;
                  
                  while ((colMatch = columnNamesRegex.exec(clauseContent)) !== null) {
                    const colName = colMatch[1];
                    const colLower = colName.toLowerCase();
                    
                    if (columnMap.has(colLower) && columnMap.get(colLower) !== colName) {
                      const correctColName = columnMap.get(colLower) || colName;
                      
                      logInfo(`Fixing column name in ${clause}: "${colName}" -> "${correctColName}"`);
                      
                      modifiedClauseContent = modifiedClauseContent.replace(
                        new RegExp(`\\b"?${colName}"?\\b`, 'g'), 
                        `"${correctColName}"`
                      );
                    }
                  }
                  
                  if (modifiedClauseContent !== clauseContent) {
                    fixedQuery = fixedQuery.replace(clauseContent, modifiedClauseContent);
                  }
                }
              }
            }
          } catch (error) {
            logWarn(`Failed to get column information for table ${correctTableName}: ${(error as Error).message}`);
          }
        }
      } catch (error) {
        logWarn(`Failed to get table information for ${tableName}: ${(error as Error).message}`);
      }
    }
    
    return fixedQuery;
  } catch (error) {
    logError(`Error in fixColumnAndTableCase: ${(error as Error).message}`);
    return query;
  }
};

export const getTableColumns = async (
  service: DatabaseService, 
  tableName: string
): Promise<string[]> => {
  try {
    if (!databaseConnections[service]) {
      throw new Error(`Database ${service} is not connected`);
    }
    
    const client = databaseClients[service];
    
    const result = await client.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = $1 AND table_schema = 'public'
    `, tableName);
    
    if (Array.isArray(result)) {
      return result.map((row: any) => row.column_name);
    }
    
    return [];
  } catch (error) {
    logError(`Failed to get columns for table ${tableName} in ${service}: ${(error as Error).message}`);
    return [];
  }
};

const testConnection = async (service: DatabaseService): Promise<boolean> => {
  try {
    const prismaClient = getPrismaClient(service);
    if (!prismaClient) {
      logError(`No Prisma client available for ${service}`);
      return false;
    }
    
    await prismaClient.$queryRawUnsafe('SELECT 1');
    
    connectionStatus[service] = true;
    logInfo(`Database connection to ${service} successful.`);
    
    databaseClients[service] = prismaClient;
    databaseConnections[service] = true;
    
    return true;
  } catch (error) {
    logError(`Failed to connect to ${service} database: ${(error as Error).message}`);
    connectionStatus[service] = false;
    return false;
  }
};

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
      isDbConnected(service);
    } catch (error) {
      logWarn(`Initial connection check for ${service} failed, will retry on demand.`);
    }
  }
  logInfo('Finished initial database connection checks.');
};

const isDbConnected = async (service: DatabaseService): Promise<boolean> => {
  if (connectionStatus[service]) {
    logInfo(`Database ${service} is already connected.`);
    return true;
  }

  logInfo(`Checking database connection for service: ${service}`);
  const prisma = getPrismaClient(service);
  
  await prisma.$queryRawUnsafe(`SELECT 1`);
  logInfo(`Database connection to ${service} successful.`);
  connectionStatus[service] = true;
  return true;
};