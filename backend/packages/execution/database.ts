import { DatabaseService, ErrorType, SqlQuery } from '@common/types';
import { getPrismaClient } from '@common/prisma';
import { createTypedError } from '@common/utils';
import { logDebug, logError, logInfo, logWarn } from '@common/logger';

// Map to track connection status
const connectionStatus: Record<string, boolean> = {};

// Клиенты для каждого сервиса баз данных - временно используем any вместо конкретных типов
const databaseClients: Record<string, any> = {};

// Статус подключения для каждого сервиса
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
 * Executes SQL query on a specific database
 */
export const executeSqlQuery = async ({ service, query }: SqlQuery): Promise<any[]> => {
  try {
    logInfo(`Executing SQL query on ${service} database:`);
    logInfo(`Query: ${query}`);
    
    // Check if we're connected to the database
    if (!connectionStatus[service]) {
      logWarn(`Database ${service} is not connected. Connecting now...`);
      await testConnection(service);
    }
    
    logInfo(`Database ${service} is already connected.`);
    
    // Get a Prisma client
    const prismaClient = getPrismaClient(service);
    if (!prismaClient) {
      throw createTypedError(
        ErrorType.DATABASE_ERROR,
        `Could not get prisma client for service: ${service}`
      );
    }
    
    // Attempt to fix case sensitivity issues in column and table names
    try {
      // Store the client reference for later use in the column/table case fix
      databaseClients[service] = prismaClient;
      databaseConnections[service] = true;
      
      // Fix any case sensitivity issues
      const fixedQuery = await fixColumnAndTableCase(service, query);
      
      if (fixedQuery !== query) {
        logInfo(`Query was modified to fix case sensitivity issues:`);
        logInfo(`Original: ${query}`);
        logInfo(`Fixed: ${fixedQuery}`);
        query = fixedQuery;
      }
    } catch (error) {
      logWarn(`Failed to fix column/table case: ${(error as Error).message}`);
      // Continue with original query if there's an error
    }
    
    // Execute query
    const startTime = Date.now();
    try {
      const result = await prismaClient.$queryRawUnsafe(query);
      const duration = Date.now() - startTime;
      logInfo(`Query executed successfully in ${duration}ms`);
      
      // Check if results are empty
      if (Array.isArray(result) && result.length === 0) {
        logInfo(`Result rows: ${result.length}`);
        logWarn(`Query returned empty result set. This might indicate:
        - Table exists but is empty
        - Table exists but query conditions matched no records
        - Table name might be correct but in a different case (PostgreSQL is case-sensitive)`);
        
        // Try to give more helpful diagnostic information
        if (query.toLowerCase().includes('from') && query.toLowerCase().includes('where')) {
          logInfo(`Query appears to be looking for users but returned empty. Trying diagnostic queries...`);
          
          // Find tables related to the query subject (e.g., users, transactions)
          const tableNameMatches = query.match(/from\s+"?(\w+)"?/i);
          if (tableNameMatches && tableNameMatches.length > 1) {
            const tableName = tableNameMatches[1];
            
            // Query information schema to find similar tables
            try {
              const tablesQuery = `
              SELECT table_name, table_schema 
              FROM information_schema.tables 
              WHERE table_name ILIKE '%${tableName.replace(/[^a-zA-Z0-9]/g, '')}%'
            `;
              const tables = await prismaClient.$queryRawUnsafe(tablesQuery);
              
              if (Array.isArray(tables) && tables.length > 0) {
                logInfo(`Tables matching '${tableName}' pattern: ${JSON.stringify(tables)}`);
                
                // Build a readable list of table names
                const tableList = tables.map(t => `${t.table_schema}.${t.table_name}`).join(', ');
                logInfo(`Found ${tables.length} ${tableName}-related tables: ${tableList}. Consider using these table names instead.`);
              }
            } catch (schemaError) {
              logWarn(`Error querying information schema: ${(schemaError as Error).message}`);
            }
          }
        }
      } else {
        logInfo(`Result rows: ${Array.isArray(result) ? result.length : 'non-array'}`);
        
        if (Array.isArray(result) && result.length > 0) {
          logDebug(`Query results: ${JSON.stringify(result.slice(0, 3))}`);
          if (result.length > 3) {
            logDebug(`... and ${result.length - 3} more rows`);
          }
        }
      }
      
      return Array.isArray(result) ? result : [];
    } catch (error) {
      const errorMsg = (error as Error).message;
      logError(`SQL Error in query: ${query}`);
      logError(`SQL Error details: ${errorMsg}`);
      
      // Provide helpful advice based on error type
      if (errorMsg.includes('relation') && errorMsg.includes('does not exist')) {
        logError(`Table name might be incorrect. In PostgreSQL, table names are case-sensitive and may need quotes for capitalized names.`);
        logError(`Try using "TableName" instead of TableName for capitalized table names.`);
      } else if (errorMsg.includes('column') && errorMsg.includes('does not exist')) {
        logError(`Column name might be incorrect. Check the column names in the database schema.`);
      } else if (errorMsg.includes('syntax error')) {
        logError(`SQL syntax error detected. Please review the query syntax.`);
      }
      
      // Check if we can automatically fix the query
      if ((errorMsg.includes('relation') && errorMsg.includes('does not exist')) || 
          (errorMsg.includes('column') && errorMsg.includes('does not exist'))) {
        logWarn(`Original query failed: ${errorMsg}. Attempting to discover tables...`);
        
        // Find the problematic table or column name from the error message
        const tableMatch = errorMsg.match(/relation "([^"]+)" does not exist/);
        const columnMatch = errorMsg.match(/column "([^"]+)" does not exist/);
        
        if (tableMatch) {
          const problematicTable = tableMatch[1];
          logInfo(`Query appears to target ${problematicTable} table. Checking table existence...`);
          
          try {
            // Find similar table names
            const tablesQuery = `
            SELECT table_name, table_schema 
            FROM information_schema.tables 
            WHERE table_name ILIKE '%${problematicTable.replace(/[^a-zA-Z0-9]/g, '')}%'
          `;
            const tables = await prismaClient.$queryRawUnsafe(tablesQuery);
            
            if (Array.isArray(tables) && tables.length > 0) {
              logInfo(`Found ${problematicTable}-related tables: ${JSON.stringify(tables)}`);
              
              // Try with first alternative table
              if (tables.length > 0) {
                const alternativeTable = tables[0].table_name;
                logInfo(`Trying with alternative table: "${tables[0].table_schema}"."${alternativeTable}"`);
                
                const alternativeQuery = query.replace(
                  new RegExp(`"?${problematicTable}"?`, 'g'),
                  `"${alternativeTable}"`
                );
                
                logInfo(`Executing alternative query: ${alternativeQuery}`);
                try {
                  const alternativeResult = await prismaClient.$queryRawUnsafe(alternativeQuery);
                  logInfo(`Alternative query worked!`);
                  return Array.isArray(alternativeResult) ? alternativeResult : [];
                } catch (altError) {
                  logWarn(`Alternative query failed: ${(altError as Error).message}`);
                }
              }
            }
          } catch (schemaError) {
            logWarn(`Error querying schema for alternative tables: ${(schemaError as Error).message}`);
          }
        } else if (columnMatch) {
          const problematicColumn = columnMatch[1];
          // Extract table name from the query
          const tableNameMatch = query.match(/from\s+"?(\w+)"?/i);
          
          if (tableNameMatch && tableNameMatch.length > 1) {
            const tableName = tableNameMatch[1];
            logInfo(`Query refers to column "${problematicColumn}" in table "${tableName}". Checking column existence...`);
            
            try {
              // Find columns of the table
              const columnsQuery = `
              SELECT column_name 
              FROM information_schema.columns 
              WHERE table_name = '${tableName}'
            `;
              const columns = await prismaClient.$queryRawUnsafe(columnsQuery);
              
              if (Array.isArray(columns) && columns.length > 0) {
                logInfo(`Columns in table ${tableName}: ${JSON.stringify(columns)}`);
                
                // Find similar column names
                const similarColumns = columns.filter(col => 
                  col.column_name.toLowerCase().includes(problematicColumn.toLowerCase()) ||
                  problematicColumn.toLowerCase().includes(col.column_name.toLowerCase())
                );
                
                if (similarColumns.length > 0) {
                  logInfo(`Found similar columns: ${JSON.stringify(similarColumns)}`);
                  
                  // Try with first similar column
                  const alternativeColumn = similarColumns[0].column_name;
                  logInfo(`Trying with alternative column: "${alternativeColumn}"`);
                  
                  const alternativeQuery = query.replace(
                    new RegExp(`"?${problematicColumn}"?`, 'g'),
                    `"${alternativeColumn}"`
                  );
                  
                  logInfo(`Executing alternative query: ${alternativeQuery}`);
                  try {
                    const alternativeResult = await prismaClient.$queryRawUnsafe(alternativeQuery);
                    logInfo(`Alternative query worked!`);
                    return Array.isArray(alternativeResult) ? alternativeResult : [];
                  } catch (altError) {
                    logWarn(`Alternative query failed: ${(altError as Error).message}`);
                  }
                }
              }
            } catch (schemaError) {
              logWarn(`Error querying schema for column information: ${(schemaError as Error).message}`);
            }
          }
        }
      }
      
      throw createTypedError(
        ErrorType.DATABASE_ERROR,
        `Failed to execute query on ${service}: ${errorMsg}`
      );
    }
  } catch (error) {
    logError(`Error executing SQL query on ${service}: ${(error as Error).message}`);
    logDebug(`Error stack trace: ${(error as Error).stack}`);
    throw error;
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

/**
 * Функция для преобразования имени таблицы или колонки в правильный регистр
 * на основе фактической схемы базы данных
 */
export const fixColumnAndTableCase = async (
  service: DatabaseService,
  query: string
): Promise<string> => {
  try {
    // Если подключение не установлено, просто возвращаем запрос без изменений
    if (!databaseConnections[service]) {
      return query;
    }
    
    const client = databaseClients[service];
    if (!client) {
      logWarn(`Client for service ${service} not found, skipping case fix`);
      return query;
    }
    
    // Ищем упоминания таблиц и колонок в запросе
    const tableRegex = /FROM\s+"?([A-Za-z0-9_]+)"?/gi;
    let tableMatch;
    let fixedQuery = query;
    
    // Исправляем имена таблиц
    while ((tableMatch = tableRegex.exec(query)) !== null) {
      const tableName = tableMatch[1];
      
      // Получаем актуальное имя таблицы из базы данных
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
            
            // Заменяем имя таблицы в запросе, сохраняя регистр ключевых слов и другие символы
            const oldPart = tableMatch[0];
            const newPart = oldPart.replace(new RegExp(`"?${tableName}"?`, 'i'), `"${correctTableName}"`);
            fixedQuery = fixedQuery.replace(oldPart, newPart);
            
            // Также ищем упоминания этой таблицы в других частях запроса (JOIN, WHERE и т.д.)
            const tableReferenceRegex = new RegExp(`([^a-zA-Z0-9_])"?${tableName}"?\\.`, 'gi');
            fixedQuery = fixedQuery.replace(tableReferenceRegex, `$1"${correctTableName}".`);
          }
          
          // Ищем и исправляем имена колонок для данной таблицы
          try {
            // Получаем все колонки для этой таблицы
            const columnResults = await client.$queryRawUnsafe(`
              SELECT column_name
              FROM information_schema.columns 
              WHERE LOWER(table_name) = LOWER($1) AND table_schema = 'public'
            `, correctTableName);
            
            if (columnResults && Array.isArray(columnResults)) {
              // Создаем карту соответствия нижний_регистр -> правильноеИмя
              const columnMap = new Map<string, string>();
              
              for (const col of columnResults) {
                columnMap.set(col.column_name.toLowerCase(), col.column_name);
              }
              
              logDebug(`Table "${correctTableName}" columns: ${Array.from(columnMap.values()).join(', ')}`);
              
              // Ищем упоминания колонок в запросе
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
              
              // Отдельно обрабатываем упоминания колонок без указания таблицы
              // Например: SELECT columnName FROM Table
              for (const [lowercaseCol, correctCol] of columnMap.entries()) {
                // Ищем колонки в SELECT, GROUP BY, ORDER BY и других частях запроса
                const standaloneColRegex = new RegExp(`(SELECT|GROUP BY|ORDER BY|WHERE|AND|OR|,)\\s+"?([A-Za-z0-9_]+)"?\\b`, 'gi');
                let standaloneMatch;
                
                while ((standaloneMatch = standaloneColRegex.exec(fixedQuery)) !== null) {
                  const colName = standaloneMatch[2];
                  
                  if (colName.toLowerCase() === lowercaseCol && colName !== correctCol) {
                    // Заменяем только если это имя колонки, а не алиас или другой идентификатор
                    if (!fixedQuery.includes(` AS ${colName}`)) {
                      logInfo(`Fixing standalone column name: "${colName}" -> "${correctCol}"`);
                      
                      const oldPart = standaloneMatch[0];
                      const newPart = oldPart.replace(new RegExp(`"?${colName}"?\\b`), `"${correctCol}"`);
                      fixedQuery = fixedQuery.replace(oldPart, newPart);
                    }
                  }
                }
              }
              
              // Специальная обработка для GROUP BY, ORDER BY и других клауз, где колонки указываются без явного названия таблицы
              // Проверяем все колонки таблицы
              const clauses = ["GROUP BY", "ORDER BY", "WHERE"];
              for (const clause of clauses) {
                // Ищем клаузу в запросе
                const clauseRegex = new RegExp(`${clause}\\s+([^;]*)`, 'i');
                const clauseMatch = fixedQuery.match(clauseRegex);
                
                if (clauseMatch) {
                  const clauseContent = clauseMatch[1];
                  let modifiedClauseContent = clauseContent;
                  
                  // Ищем все колонки в клаузе
                  const columnNamesRegex = /\b([A-Za-z0-9_]+)\b/g;
                  let colMatch;
                  
                  while ((colMatch = columnNamesRegex.exec(clauseContent)) !== null) {
                    const colName = colMatch[1];
                    const colLower = colName.toLowerCase();
                    
                    // Проверяем, есть ли такая колонка в таблице с другим регистром
                    if (columnMap.has(colLower) && columnMap.get(colLower) !== colName) {
                      const correctColName = columnMap.get(colLower) || colName;
                      
                      // Заменяем имя колонки на правильное с учетом регистра
                      logInfo(`Fixing column name in ${clause}: "${colName}" -> "${correctColName}"`);
                      
                      // Заменяем только полное слово, не часть другого слова
                      modifiedClauseContent = modifiedClauseContent.replace(
                        new RegExp(`\\b"?${colName}"?\\b`, 'g'), 
                        `"${correctColName}"`
                      );
                    }
                  }
                  
                  // Если было изменение, обновляем запрос
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
    return query; // Возвращаем оригинальный запрос в случае ошибки
  }
};

/**
 * Получает информацию о колонках таблицы
 */
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

/**
 * Test the connection to a database service
 */
const testConnection = async (service: DatabaseService): Promise<boolean> => {
  try {
    const prismaClient = getPrismaClient(service);
    if (!prismaClient) {
      logError(`No Prisma client available for ${service}`);
      return false;
    }
    
    // Execute a simple query to test the connection
    await prismaClient.$queryRawUnsafe('SELECT 1');
    
    // Mark connection as established
    connectionStatus[service] = true;
    logInfo(`Database connection to ${service} successful.`);
    
    // Store the client for case sensitivity checks
    databaseClients[service] = prismaClient;
    databaseConnections[service] = true;
    
    return true;
  } catch (error) {
    logError(`Failed to connect to ${service} database: ${(error as Error).message}`);
    connectionStatus[service] = false;
    return false;
  }
}; 