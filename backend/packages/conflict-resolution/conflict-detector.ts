import { DatabaseDescription, TableDescription } from '@common/knowledge/database-knowledge';
import { databaseKnowledge } from '@common/knowledge';
import { logDebug, logInfo } from '@common/logger';
import { DatabaseService, QueryPlan } from '@common/types';

export interface TableConflict {
  tableName: string;
  services: DatabaseService[];
  schemas: Record<string, TableDescription>;
}

export interface ConflictDetectionResult {
  conflicts: TableConflict[];
  hasConflicts: boolean;
  suggestedResolution?: string;
  errorProbability: 'high' | 'medium' | 'low';
}

/**
 * Класс для обнаружения конфликтов между таблицами разных сервисов
 */
export class ConflictDetector {
  private databaseMetadata: DatabaseDescription[];
  private tableServiceMap: Map<string, DatabaseService[]> = new Map();
  private tableSchemaMap: Map<string, Record<string, TableDescription>> = new Map();
  
  constructor() {
    this.databaseMetadata = databaseKnowledge.getAllDatabases();
    this.buildTableMaps();
    logInfo(`ConflictDetector initialized with ${this.databaseMetadata.length} database services`);
  }
  
  /**
   * Строит карты таблиц для быстрого поиска конфликтов
   */
  private buildTableMaps(): void {
    for (const db of this.databaseMetadata) {
      const service = db.service as DatabaseService;
      
      for (const table of db.tables) {
        const tableName = table.name;
        
        // Добавляем сервис в список сервисов для этой таблицы
        if (!this.tableServiceMap.has(tableName)) {
          this.tableServiceMap.set(tableName, []);
          this.tableSchemaMap.set(tableName, {});
        }
        
        this.tableServiceMap.get(tableName)?.push(service);
        this.tableSchemaMap.get(tableName)![service] = table;
      }
    }
    
    logDebug(`Built table maps with ${this.tableServiceMap.size} unique table names`);
  }
  
  /**
   * Определяет, имеет ли таблица конфликты (присутствует в нескольких сервисах)
   * @param tableName Имя таблицы
   * @returns Объект с информацией о конфликте
   */
  public detectTableConflicts(tableName: string): TableConflict | null {
    const services = this.tableServiceMap.get(tableName);
    
    if (!services || services.length <= 1) {
      return null;
    }
    
    const schemas = this.tableSchemaMap.get(tableName) || {};
    
    logInfo(`Detected conflict for table "${tableName}" across services: ${services.join(', ')}`);
    
    return {
      tableName,
      services,
      schemas
    };
  }
  
  /**
   * Проверяет план запроса на наличие конфликтов между таблицами
   * @param plan План запроса
   * @returns Результат обнаружения конфликтов
   */
  public detectPlanConflicts(plan: QueryPlan): ConflictDetectionResult {
    const conflicts: TableConflict[] = [];
    const tablesInPlan = new Set<string>();
    
    // Извлекаем имена таблиц из SQL-запросов в плане
    for (const step of plan.steps) {
      if (step.sqlQuery) {
        const tableNames = this.extractTableNamesFromSql(step.sqlQuery);
        tableNames.forEach(table => tablesInPlan.add(table));
      }
    }
    
    // Проверяем каждую таблицу на конфликты
    for (const tableName of tablesInPlan) {
      const conflict = this.detectTableConflicts(tableName);
      if (conflict) {
        conflicts.push(conflict);
      }
    }
    
    // Определяем вероятность ошибки
    let errorProbability: 'high' | 'medium' | 'low' = 'low';
    if (conflicts.length > 0) {
      // Если есть конфликты между сервисами, указанными в плане, вероятность ошибки высокая
      const servicesInPlan = new Set(plan.requiredServices);
      
      const hasCrossServiceConflict = conflicts.some(conflict => {
        const conflictingServicesInPlan = conflict.services.filter(service => 
          servicesInPlan.has(service)
        );
        return conflictingServicesInPlan.length > 1;
      });
      
      errorProbability = hasCrossServiceConflict ? 'high' : 'medium';
    }
    
    // Формируем рекомендации по разрешению конфликтов
    let suggestedResolution: string | undefined;
    if (conflicts.length > 0) {
      suggestedResolution = this.createResolutionSuggestion(conflicts, plan);
    }
    
    return {
      conflicts,
      hasConflicts: conflicts.length > 0,
      suggestedResolution,
      errorProbability
    };
  }
  
  /**
   * Извлекает имена таблиц из SQL-запроса
   * @param sql SQL-запрос
   * @returns Массив имен таблиц
   */
  private extractTableNamesFromSql(sql: string): string[] {
    const tables: string[] = [];
    
    // Простой алгоритм извлечения имен таблиц из SQL
    // Находим все совпадения после FROM и JOIN
    
    // Удаляем комментарии и нормализуем пробелы
    const normalizedSql = sql
      .replace(/--.*$/mg, '') // Удалить однострочные комментарии
      .replace(/\/\*[\s\S]*?\*\//g, '') // Удалить многострочные комментарии
      .replace(/\s+/g, ' ') // Заменить последовательности пробелов на один пробел
      .trim();
    
    // Находим таблицы после FROM
    const fromRegex = /FROM\s+(["`']?)([a-zA-Z0-9_]+)\1(?:\s*(?:AS\s+)?([a-zA-Z0-9_]+))?/gi;
    let match;
    while ((match = fromRegex.exec(normalizedSql)) !== null) {
      tables.push(match[2]);
    }
    
    // Находим таблицы после JOIN
    const joinRegex = /JOIN\s+(["`']?)([a-zA-Z0-9_]+)\1(?:\s*(?:AS\s+)?([a-zA-Z0-9_]+))?/gi;
    while ((match = joinRegex.exec(normalizedSql)) !== null) {
      tables.push(match[2]);
    }
    
    return [...new Set(tables)]; // Убираем дубликаты
  }
  
  /**
   * Создает предложение по разрешению конфликтов
   * @param conflicts Обнаруженные конфликты
   * @param plan План запроса
   * @returns Строка с рекомендациями
   */
  private createResolutionSuggestion(conflicts: TableConflict[], plan: QueryPlan): string {
    let suggestion = 'Рекомендации по разрешению конфликтов:\n\n';
    
    for (const conflict of conflicts) {
      suggestion += `* Таблица "${conflict.tableName}" присутствует в нескольких сервисах: ${conflict.services.join(', ')}.\n`;
      
      // Проверяем схемы на различия
      const schemas = Object.values(conflict.schemas);
      const columnsMatch = this.compareTableSchemas(schemas);
      
      if (!columnsMatch) {
        suggestion += `  - Схемы таблиц отличаются, что повышает риск неверного запроса.\n`;
      }
      
      // Рекомендации по уточнению сервиса
      suggestion += `  - Рекомендуется явно указать сервис в запросе или использовать полностью квалифицированные имена таблиц.\n`;
      
      // Определяем сервис на основе контекста запроса
      const suggestedService = this.suggestServiceBasedOnContext(conflict, plan);
      if (suggestedService) {
        suggestion += `  - На основе контекста запроса, вероятно, вы ищете таблицу "${conflict.tableName}" из сервиса "${suggestedService}".\n`;
      }
      
      suggestion += '\n';
    }
    
    return suggestion;
  }
  
  /**
   * Сравнивает схемы таблиц на соответствие
   * @param schemas Схемы таблиц
   * @returns true, если схемы совпадают, false в противном случае
   */
  private compareTableSchemas(schemas: TableDescription[]): boolean {
    if (schemas.length <= 1) {
      return true;
    }
    
    const referenceSchema = schemas[0];
    const referenceColumns = new Set(referenceSchema.columns.map(col => col.name));
    
    for (let i = 1; i < schemas.length; i++) {
      const currentSchema = schemas[i];
      const currentColumns = new Set(currentSchema.columns.map(col => col.name));
      
      // Проверяем, что все колонки из первой схемы есть во второй и наоборот
      for (const column of referenceColumns) {
        if (!currentColumns.has(column)) {
          return false;
        }
      }
      
      for (const column of currentColumns) {
        if (!referenceColumns.has(column)) {
          return false;
        }
      }
    }
    
    return true;
  }
  
  /**
   * Предлагает наиболее вероятный сервис на основе контекста запроса
   * @param conflict Информация о конфликте
   * @param plan План запроса
   * @returns Имя сервиса или undefined
   */
  private suggestServiceBasedOnContext(conflict: TableConflict, plan: QueryPlan): DatabaseService | undefined {
    // Если в плане указан только один сервис из конфликтующих, предлагаем его
    const servicesInPlan = new Set(plan.requiredServices);
    const conflictingServicesInPlan = conflict.services.filter(service => 
      servicesInPlan.has(service)
    );
    
    if (conflictingServicesInPlan.length === 1) {
      return conflictingServicesInPlan[0];
    }
    
    // Если в плане указано несколько конфликтующих сервисов, пытаемся определить на основе других таблиц
    if (conflictingServicesInPlan.length > 1) {
      // Пока простая эвристика: возвращаем первый сервис из списка
      return conflictingServicesInPlan[0];
    }
    
    // Если нет конфликтующих сервисов в плане, возвращаем первый из списка конфликтующих
    return conflict.services[0];
  }
} 