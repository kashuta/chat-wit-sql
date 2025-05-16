import { v4 as uuidv4 } from 'uuid';
import { logError, logInfo, logWarn, logDebug } from '@common/logger';
import { resultStore } from '@common/result-store';
import { DatabaseService } from '@common/types';
import { executeSqlQuery } from './index';

/**
 * Интерфейс расширенного шага запроса с зависимостями
 */
export interface QueryStepWithDependencies {
  id: string;                     // Уникальный идентификатор шага
  service: DatabaseService;       // Сервис базы данных для запроса
  description: string;            // Описание цели шага
  sqlQuery?: string;              // SQL запрос (может быть динамически сгенерирован)
  dependsOn: string[];            // ID шагов, от которых зависит этот шаг
  parameters?: string[];          // Параметры, ожидаемые из других шагов 
  isInMemory: boolean;            // Обозначает шаг, который выполняется в памяти, а не в БД
  operation?: InMemoryOperation;  // Операция для шага в памяти
}

/**
 * Тип операции для обработки данных в памяти
 */
export enum InMemoryOperation {
  JOIN = 'join',           // Объединение наборов данных
  FILTER = 'filter',       // Фильтрация данных
  GROUP = 'group',         // Группировка данных
  SORT = 'sort',           // Сортировка данных
  AGGREGATE = 'aggregate', // Агрегация данных (sum, avg, etc)
  LIMIT = 'limit',         // Ограничение количества результатов
  MAP = 'map',             // Преобразование данных
  REDUCE = 'reduce',       // Сведение данных
}

/**
 * Расширенный план запроса с информацией о зависимостях между шагами
 */
export interface DistributedQueryPlan {
  id: string;
  steps: QueryStepWithDependencies[];
  requiredServices: DatabaseService[];
  finalStepId: string; // ID шага, результат которого будет возвращен в качестве финального результата
}

/**
 * Результат выполнения распределенного запроса
 */
export interface DistributedQueryResult {
  planId: string;
  finalResults: Record<string, unknown>[];
  intermediateResults?: Record<string, Record<string, unknown>[]>;
  executedSteps: string[];
  errors?: Record<string, string>;
}

/**
 * Процессор распределенных запросов
 */
export class DistributedQueryProcessor {
  /**
   * Выполняет распределенный план запроса
   */
  async executeDistributedPlan(plan: DistributedQueryPlan): Promise<DistributedQueryResult> {
    const planId = plan.id;
    const executedSteps: string[] = [];
    const errors: Record<string, string> = {};
    const intermediateResults: Record<string, Record<string, unknown>[]> = {};
    
    try {
      logInfo(`Starting execution of distributed query plan with ID: ${planId}`);
      logInfo(`Plan steps: ${plan.steps.map(s => s.id).join(', ')}`);
      logInfo(`Required services: ${plan.requiredServices.join(', ')}`);
      logInfo(`Final step ID: ${plan.finalStepId}`);
      
      // Убедимся, что Redis подключен
      await resultStore.connect().catch((err) => {
        logWarn(`Could not connect to Redis: ${err.message}. Using in-memory fallback.`);
      });
      
      // Очистка кеша от предыдущих результатов с этим ID
      await resultStore.clear(planId);
      
      // Создаём граф зависимостей для шагов
      const dependencyGraph = this.buildDependencyGraph(plan.steps);
      
      // Получаем отсортированные шаги с учетом зависимостей
      const sortedSteps = this.topologicalSort(plan.steps, dependencyGraph);
      logInfo(`Execution order after topological sort: ${sortedSteps.map(s => s.id).join(' -> ')}`);
      
      // Выполняем каждый шаг по порядку
      for (const step of sortedSteps) {
        try {
          // Ключ для хранения результатов в Redis
          const resultKey = `${planId}:${step.id}`;
          
          logInfo(`===== EXECUTING STEP: ${step.id} =====`);
          logInfo(`Description: ${step.description}`);
          logInfo(`Service: ${step.service}`);
          logInfo(`Is in-memory: ${step.isInMemory}`);
          if (step.operation) logInfo(`Operation: ${step.operation}`);
          if (step.sqlQuery) logInfo(`SQL Query: ${step.sqlQuery}`);
          if (step.parameters) logInfo(`Parameters: ${step.parameters.join(', ')}`);
          logInfo(`Dependencies: ${step.dependsOn.join(', ')}`);
          
          // Проверяем, все ли зависимости уже выполнены
          const allDependenciesMet = step.dependsOn.every(depId => 
            executedSteps.includes(depId)
          );
          
          if (!allDependenciesMet) {
            const missingDeps = step.dependsOn.filter(depId => !executedSteps.includes(depId));
            const errorMsg = `Dependencies not met for step ${step.id}. Missing: ${missingDeps.join(', ')}`;
            logError(errorMsg);
            throw new Error(errorMsg);
          }
          
          // Выполняем шаг в зависимости от его типа
          let results: Record<string, unknown>[] = [];
          
          if (step.isInMemory) {
            // Выполняем операцию в памяти
            logInfo(`Executing in-memory operation: ${step.operation}`);
            results = await this.executeInMemoryStep(plan.id, step);
          } else if (step.sqlQuery) {
            // Специальная обработка для известных проблем с регистром
            let sqlQuery = step.sqlQuery;
            
            // Исправление для userId - это особый случай, так как он используется очень часто
            // и в разных таблицах может иметь разный регистр
            if (sqlQuery.includes('userId') || sqlQuery.includes('userid')) {
              logInfo(`Special handling for userId/UserId column naming`);
              
              // Запрос, который содержит userId в GROUP BY
              if (sqlQuery.includes('GROUP BY userId')) {
                logInfo(`Fixing 'GROUP BY userId' -> 'GROUP BY "userId"'`);
                sqlQuery = sqlQuery.replace(/GROUP BY\s+userId/gi, 'GROUP BY "userId"');
              }
              
              // Если userId используется в SELECT
              if (sqlQuery.includes('SELECT userId')) {
                logInfo(`Fixing 'SELECT userId' -> 'SELECT "userId"'`);
                sqlQuery = sqlQuery.replace(/SELECT\s+userId/gi, 'SELECT "userId"');
              }
              
              // Если userId используется в WHERE
              if (sqlQuery.includes('WHERE userId')) {
                logInfo(`Fixing 'WHERE userId' -> 'WHERE "userId"'`);
                sqlQuery = sqlQuery.replace(/WHERE\s+userId/gi, 'WHERE "userId"');
              }
              
              // Общая замена для неэкранированного userId
              // Используем регулярное выражение для замены userId как отдельного слова
              sqlQuery = sqlQuery.replace(/\b(userId)\b(?!")/g, '"userId"');
            }
            
            // Создаем параметризованный SQL запрос с подстановкой значений из предыдущих шагов
            const parameterizedQuery = await this.createParameterizedQuery(
              plan.id, 
              sqlQuery, 
              step.parameters || [], 
              step.dependsOn
            );
            
            // Выполняем SQL запрос на соответствующем сервисе
            logInfo(`Executing SQL query on service ${step.service}: ${parameterizedQuery}`);
            results = await executeSqlQuery(step.service, parameterizedQuery);
          }
          
          logInfo(`Step ${step.id} result count: ${results.length} rows`);
          if (results.length > 0) {
            logInfo(`Sample result: ${JSON.stringify(results[0])}`);
          }
          
          // Сохраняем результаты в Redis
          await resultStore.store(resultKey, results);
          
          // Сохраняем для возврата
          intermediateResults[step.id] = results;
          
          // Отмечаем шаг как выполненный
          executedSteps.push(step.id);
          
          logInfo(`Step ${step.id} executed successfully: ${results.length} rows returned`);
        } catch (error) {
          const errorMessage = `Error executing step ${step.id}: ${(error as Error).message}`;
          logError(errorMessage);
          logError(`Error stack trace: ${(error as Error).stack}`);
          errors[step.id] = errorMessage;
          
          // Если это критический шаг без которого нельзя продолжать, прерываем выполнение
          if (this.isStepCritical(step.id, plan)) {
            logError(`Critical step ${step.id} failed, aborting plan execution`);
            throw new Error(`Critical step ${step.id} failed: ${(error as Error).message}`);
          } else {
            logWarn(`Non-critical step ${step.id} failed, continuing with plan execution`);
          }
        }
      }
      
      // Получаем итоговые результаты
      logInfo(`Getting final results from step: ${plan.finalStepId}`);
      const finalResults = await resultStore.get(`${planId}:${plan.finalStepId}`);
      logInfo(`Final result count: ${finalResults.length} rows`);
      
      return {
        planId,
        finalResults,
        intermediateResults,
        executedSteps,
        errors: Object.keys(errors).length > 0 ? errors : undefined
      };
      
    } catch (error) {
      const errorMsg = `Error executing distributed query plan: ${(error as Error).message}`;
      logError(errorMsg);
      logError(`Error stack trace: ${(error as Error).stack}`);
      
      return {
        planId,
        finalResults: [],
        executedSteps,
        errors: { 
          ...errors,
          global: errorMsg 
        }
      };
    }
  }
  
  /**
   * Выполняет шаг обработки данных в памяти
   */
  private async executeInMemoryStep(
    planId: string,
    step: QueryStepWithDependencies
  ): Promise<Record<string, unknown>[]> {
    if (!step.operation) {
      throw new Error(`In-memory step ${step.id} has no operation defined`);
    }
    
    // Получаем параметры операции из шага
    const operationParams = step.parameters || [];
    logInfo(`Executing in-memory step ${step.id} with operation: ${step.operation}`);
    logInfo(`Operation parameters: ${operationParams.join(', ')}`);
    
    switch (step.operation) {
      case InMemoryOperation.JOIN: {
        // Ожидаем параметры: [key1, key2, joinField]
        if (step.dependsOn.length < 2 || operationParams.length < 1) {
          throw new Error(`JOIN operation requires at least 2 dependencies and join field parameter`);
        }
        
        const [source1, source2] = step.dependsOn;
        const joinField = operationParams[0];
        
        logInfo(`Joining results from steps ${source1} and ${source2} on field: ${joinField}`);
        const sourceKey1 = `${planId}:${source1}`;
        const sourceKey2 = `${planId}:${source2}`;
        
        // Логгируем данные для отладки
        const source1Results = await resultStore.get(sourceKey1);
        const source2Results = await resultStore.get(sourceKey2);
        logInfo(`Source 1 (${source1}) has ${source1Results.length} rows`);
        logInfo(`Source 2 (${source2}) has ${source2Results.length} rows`);
        
        if (source1Results.length > 0) {
          logInfo(`Source 1 first row: ${JSON.stringify(source1Results[0])}`);
          logInfo(`Source 1 join field value: ${source1Results[0][joinField]}`);
        }
        
        if (source2Results.length > 0) {
          logInfo(`Source 2 first row: ${JSON.stringify(source2Results[0])}`);
          logInfo(`Source 2 join field value: ${source2Results[0][joinField]}`);
        }
        
        const results = await resultStore.joinResults(sourceKey1, sourceKey2, joinField);
        logInfo(`Join result has ${results.length} rows`);
        
        return results;
      }
      
      case InMemoryOperation.FILTER: {
        // Ожидаем параметры: [sourceKey, filterField, filterValue]
        if (step.dependsOn.length < 1 || operationParams.length < 2) {
          throw new Error(`FILTER operation requires at least 1 dependency and filter parameters`);
        }
        
        const sourceKey = `${planId}:${step.dependsOn[0]}`;
        const [filterField, filterOperator, filterValue] = operationParams;
        
        logInfo(`Filtering results from step ${step.dependsOn[0]}`);
        logInfo(`Filter field: ${filterField}, operator: ${filterOperator}, value: ${filterValue}`);
        
        const sourceData = await resultStore.get(sourceKey);
        logInfo(`Source data has ${sourceData.length} rows`);
        
        if (sourceData.length > 0) {
          logInfo(`Source first row: ${JSON.stringify(sourceData[0])}`);
          logInfo(`Filter field value in first row: ${sourceData[0][filterField]}`);
        }
        
        const filteredResults = sourceData.filter(item => {
          const fieldValue = item[filterField];
          
          // Поддерживаем базовые операторы сравнения
          switch (filterOperator) {
            case '=':
            case '==':
              return fieldValue == filterValue;
            case '!=':
              return fieldValue != filterValue;
            case '>':
              return Number(fieldValue) > Number(filterValue);
            case '>=':
              return Number(fieldValue) >= Number(filterValue);
            case '<':
              return Number(fieldValue) < Number(filterValue);
            case '<=':
              return Number(fieldValue) <= Number(filterValue);
            case 'in':
              return Array.isArray(filterValue) && filterValue.includes(fieldValue);
            case 'like':
              return String(fieldValue).includes(String(filterValue));
            default:
              return true;
          }
        });
        
        logInfo(`Filter result has ${filteredResults.length} rows`);
        return filteredResults;
      }
      
      case InMemoryOperation.SORT: {
        // Ожидаем параметры: [sourceKey, sortField, sortDirection]
        if (step.dependsOn.length < 1 || operationParams.length < 2) {
          throw new Error(`SORT operation requires at least 1 dependency and sort parameters`);
        }
        
        const sourceKey = `${planId}:${step.dependsOn[0]}`;
        const [sortField, sortDirection = 'asc'] = operationParams;
        
        logInfo(`Sorting results from step ${step.dependsOn[0]}`);
        logInfo(`Sort field: ${sortField}, direction: ${sortDirection}`);
        
        const sourceData = await resultStore.get(sourceKey);
        logInfo(`Source data has ${sourceData.length} rows to sort`);
        
        if (sourceData.length > 0) {
          logInfo(`First row before sorting: ${JSON.stringify(sourceData[0])}`);
        }
        
        const sortedResults = [...sourceData].sort((a, b) => {
          const aValue = a[sortField];
          const bValue = b[sortField];
          
          if (aValue === bValue) return 0;
          
          const direction = sortDirection.toLowerCase() === 'desc' ? -1 : 1;
          
          if (typeof aValue === 'number' && typeof bValue === 'number') {
            return direction * (aValue - bValue);
          }
          
          // Для строк и других типов
          return direction * (String(aValue) > String(bValue) ? 1 : -1);
        });
        
        logInfo(`Sorted result has ${sortedResults.length} rows`);
        if (sortedResults.length > 0) {
          logInfo(`First row after sorting: ${JSON.stringify(sortedResults[0])}`);
        }
        
        return sortedResults;
      }
      
      case InMemoryOperation.LIMIT: {
        // Ожидаем параметры: [sourceKey, limit, offset]
        if (step.dependsOn.length < 1 || operationParams.length < 1) {
          throw new Error(`LIMIT operation requires at least 1 dependency and limit parameter`);
        }
        
        const sourceKey = `${planId}:${step.dependsOn[0]}`;
        const [limitStr, offsetStr = '0'] = operationParams;
        
        const limit = parseInt(limitStr, 10);
        const offset = parseInt(offsetStr, 10);
        
        if (isNaN(limit) || isNaN(offset)) {
          throw new Error(`Invalid limit or offset parameters: ${limitStr}, ${offsetStr}`);
        }
        
        logInfo(`Limiting results from step ${step.dependsOn[0]}`);
        logInfo(`Limit: ${limit}, offset: ${offset}`);
        
        const sourceData = await resultStore.get(sourceKey);
        logInfo(`Source data has ${sourceData.length} rows before limiting`);
        
        const limitedResults = sourceData.slice(offset, offset + limit);
        logInfo(`Limited result has ${limitedResults.length} rows`);
        
        return limitedResults;
      }
      
      case InMemoryOperation.AGGREGATE: {
        // Ожидаем параметры: [sourceKey, aggregateFunction, aggregateField]
        if (step.dependsOn.length < 1 || operationParams.length < 2) {
          throw new Error(`AGGREGATE operation requires at least 1 dependency and aggregate parameters`);
        }
        
        const sourceKey = `${planId}:${step.dependsOn[0]}`;
        const [aggregateFunction, aggregateField] = operationParams;
        
        logInfo(`Aggregating results from step ${step.dependsOn[0]}`);
        logInfo(`Aggregate function: ${aggregateFunction}, field: ${aggregateField}`);
        
        const sourceData = await resultStore.get(sourceKey);
        logInfo(`Source data has ${sourceData.length} rows to aggregate`);
        
        if (sourceData.length === 0) {
          logInfo(`Source data is empty, returning empty result`);
          return [];
        }
        
        logInfo(`First row to aggregate: ${JSON.stringify(sourceData[0])}`);
        logInfo(`Aggregate field value in first row: ${sourceData[0][aggregateField]}`);
        
        let result: number | null = null;
        
        switch (aggregateFunction.toLowerCase()) {
          case 'max': {
            const values = sourceData.map(item => Number(item[aggregateField] || 0));
            logInfo(`Values for max calculation: ${values.join(', ')}`);
            result = Math.max(...values);
            break;
          }
          case 'min': {
            const values = sourceData.map(item => Number(item[aggregateField] || 0));
            logInfo(`Values for min calculation: ${values.join(', ')}`);
            result = Math.min(...values);
            break;
          }
          case 'sum': {
            result = sourceData.reduce((sum, item) => {
              const numValue = Number(item[aggregateField] || 0);
              logInfo(`Adding value to sum: ${numValue}, current sum: ${sum}`);
              return sum + numValue;
            }, 0);
            break;
          }
          case 'avg': {
            const sum = sourceData.reduce((acc, item) => acc + Number(item[aggregateField] || 0), 0);
            result = sum / sourceData.length;
            break;
          }
          case 'count': {
            result = sourceData.length;
            break;
          }
          default:
            throw new Error(`Unsupported aggregate function: ${aggregateFunction}`);
        }
        
        logInfo(`Aggregate result: ${result}`);
        
        // Возвращаем результат в виде массива с одним элементом
        return [{ 
          [aggregateFunction.toLowerCase()]: result,
          field: aggregateField
        }];
      }
      
      default:
        throw new Error(`Unsupported in-memory operation: ${step.operation}`);
    }
  }
  
  /**
   * Создает параметризованный SQL запрос, заменяя метки на значения из предыдущих шагов
   */
  private async createParameterizedQuery(
    planId: string,
    sqlQuery: string,
    parameters: string[],
    dependsOnSteps: string[]
  ): Promise<string> {
    let parameterizedQuery = sqlQuery;
    
    // Если нет параметров, возвращаем исходный запрос
    if (parameters.length === 0) {
      return sqlQuery;
    }
    
    logInfo(`Creating parameterized query for: ${sqlQuery}`);
    logInfo(`Parameters to substitute: ${parameters.join(', ')}`);
    logInfo(`Dependent steps: ${dependsOnSteps.join(', ')}`);
    
    // Проверяем, есть ли вообще динамические параметры в запросе
    const hasPlaceholders = sqlQuery.includes('?');
    const hasNamedParams = /[:$]\{?(\w+)\}?/g.test(sqlQuery);
    const hasNumericParams = /\$\d+/.test(sqlQuery);
    
    if (!hasPlaceholders && !hasNamedParams && !hasNumericParams) {
      logInfo(`No placeholder or named parameters found in the query. Returning original query.`);
      return sqlQuery;
    }
    
    // Получаем результаты зависимых шагов
    const dependentResults: { [stepId: string]: Record<string, unknown>[] } = {};
    
    for (const stepId of dependsOnSteps) {
      const results = await resultStore.get(`${planId}:${stepId}`);
      dependentResults[stepId] = results;
      logInfo(`Retrieved results from dependent step ${stepId}: ${results.length} rows`);
      if (results.length > 0) {
        logDebug(`First row from dependent step ${stepId}: ${JSON.stringify(results[0])}`);
      }
    }
    
    // Cначала обрабатываем placeholders в виде "?" - замена по порядку
    if (hasPlaceholders) {
      let placeholderIndex = 0;
      
      // Пытаемся заменить каждый placeholder на значение из зависимых шагов
      parameterizedQuery = parameterizedQuery.replace(/\?/g, () => {
        const param = parameters[placeholderIndex++];
        if (!param) {
          return '?'; // Если нет подходящего параметра, оставляем как есть
        }
        
        // Ищем значение в зависимых шагах
        for (const stepId of dependsOnSteps) {
          const results = dependentResults[stepId];
          if (results && results.length > 0) {
            const firstRow = results[0];
            // Смотрим, есть ли искомый параметр среди полей
            Object.entries(firstRow).forEach(([key, value]) => {
              // Сравниваем с игнорированием регистра
              if (key.toLowerCase() === param.toLowerCase()) {
                const formattedValue = this.formatValueForSql(value);
                logInfo(`Replacing placeholder with ${key} = ${formattedValue} from step ${stepId}`);
                parameterizedQuery = parameterizedQuery.replace("?", formattedValue);
              }
            });
          }
        }
        
        return `?`; // На случай, если не нашли замену
      });
    }
    
    // Обрабатываем параметры вида $1, $2, и т.д.
    if (hasNumericParams) {
      logInfo(`Found numeric parameters ($1, $2, etc.) in query`);
      
      // Находим все числовые параметры и заменяем их на значения
      for (let i = 0; i < parameters.length; i++) {
        const param = parameters[i];
        const paramToken = `$${i + 1}`;
        
        if (parameterizedQuery.includes(paramToken)) {
          logInfo(`Found numeric parameter ${paramToken} for parameter ${param}`);
          
          // Ищем значение в зависимых шагах
          let found = false;
          for (const stepId of dependsOnSteps) {
            const results = dependentResults[stepId];
            
            if (results && results.length > 0) {
              const firstRow = results[0];
              
              // Перебираем поля результата
              for (const [key, value] of Object.entries(firstRow)) {
                // Проверяем соответствие имени параметра с учетом регистра
                if (key.toLowerCase() === param.toLowerCase()) {
                  const formattedValue = this.formatValueForSql(value);
                  logInfo(`Found value for numeric parameter ${paramToken} = ${formattedValue} in step ${stepId}`);
                  
                  // Заменяем параметр в SQL
                  parameterizedQuery = parameterizedQuery.replace(
                    new RegExp(`\\${paramToken}\\b`, 'g'), 
                    formattedValue
                  );
                  logInfo(`Replaced ${paramToken} with ${formattedValue}`);
                  
                  found = true;
                  break; // Параметр найден, выходим из цикла полей
                }
              }
              
              if (found) break; // Параметр найден, выходим из цикла шагов
            }
          }
          
          if (!found) {
            logWarn(`Value for numeric parameter ${paramToken} (${param}) not found in any dependent step results.`);
          }
        }
      }
    }
    
    // Затем обрабатываем именованные параметры
    for (const param of parameters) {
      // Ищем параметры вида :paramName или ${paramName}
      const colonParam = `:${param}`;
      
      // Проверяем, есть ли такие параметры в запросе
      if (!parameterizedQuery.includes(colonParam) && !parameterizedQuery.includes(`${param}}`)) {
        continue;
      }
      
      // Ищем значение в зависимых шагах
      let found = false;
      for (const stepId of dependsOnSteps) {
        const results = dependentResults[stepId];
        
        if (results && results.length > 0) {
          const firstRow = results[0];
          
          // Перебираем поля результата
          for (const [key, value] of Object.entries(firstRow)) {
            // Проверяем соответствие имени параметра с учетом регистра
            if (key.toLowerCase() === param.toLowerCase()) {
              const formattedValue = this.formatValueForSql(value);
              logInfo(`Found value for parameter ${param} = ${formattedValue} in step ${stepId}`);
              
              // Заменяем параметр в SQL
              if (parameterizedQuery.includes(colonParam)) {
                parameterizedQuery = parameterizedQuery.replace(
                  new RegExp(`:${param}\\b`, 'g'), 
                  formattedValue
                );
                logInfo(`Replaced :${param} with ${formattedValue}`);
              }
              
              if (parameterizedQuery.includes(`\${${param}}`)) {
                parameterizedQuery = parameterizedQuery.replace(
                  new RegExp(`\\$\\{${param}\\}`, 'g'), 
                  formattedValue
                );
                logInfo(`Replaced \${${param}} with ${formattedValue}`);
              }
              
              found = true;
              break; // Параметр найден, выходим из цикла полей
            }
          }
          
          if (found) break; // Параметр найден, выходим из цикла шагов
        }
      }
      
      if (!found) {
        logWarn(`Value for parameter ${param} not found in any dependent step results.`);
      }
    }
    
    logInfo(`Final parameterized query: ${parameterizedQuery}`);
    return parameterizedQuery;
  }
  
  /**
   * Форматирует значение для вставки в SQL запрос
   */
  private formatValueForSql(value: unknown): string {
    if (value === null || value === undefined) {
      return "NULL";
    }
    
    if (typeof value === 'string') {
      // Экранируем кавычки и заключаем в кавычки строки
      return `'${value.replace(/'/g, "''")}'`;
    }
    
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    
    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }
    
    // Для сложных типов - преобразуем в JSON
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  
  /**
   * Строит граф зависимостей из шагов
   */
  private buildDependencyGraph(steps: QueryStepWithDependencies[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    
    for (const step of steps) {
      graph.set(step.id, [...step.dependsOn]);
    }
    
    return graph;
  }
  
  /**
   * Топологическая сортировка шагов с учетом зависимостей
   */
  private topologicalSort(
    steps: QueryStepWithDependencies[],
    graph: Map<string, string[]>
  ): QueryStepWithDependencies[] {
    const visited = new Set<string>();
    const tempMark = new Set<string>();
    const result: QueryStepWithDependencies[] = [];
    
    // Рекурсивная функция обхода
    const visit = (stepId: string) => {
      // Обнаружен цикл
      if (tempMark.has(stepId)) {
        throw new Error(`Circular dependency detected for step ${stepId}`);
      }
      
      // Узел уже обработан
      if (visited.has(stepId)) {
        return;
      }
      
      // Временная отметка для выявления циклов
      tempMark.add(stepId);
      
      // Сначала обрабатываем зависимости
      const dependencies = graph.get(stepId) || [];
      for (const dep of dependencies) {
        visit(dep);
      }
      
      // Убираем временную отметку
      tempMark.delete(stepId);
      
      // Отмечаем как посещенный
      visited.add(stepId);
      
      // Добавляем в результат
      const step = steps.find(s => s.id === stepId);
      if (step) {
        result.push(step);
      }
    };
    
    // Инициируем обход из каждого непосещенного узла
    for (const step of steps) {
      if (!visited.has(step.id)) {
        visit(step.id);
      }
    }
    
    return result;
  }
  
  /**
   * Проверяет, является ли шаг критическим для выполнения
   */
  private isStepCritical(stepId: string, plan: DistributedQueryPlan): boolean {
    // Финальный шаг всегда критический
    if (stepId === plan.finalStepId) {
      return true;
    }
    
    // Шаг критический, если от него зависят другие шаги
    return plan.steps.some(step => step.dependsOn.includes(stepId));
  }
  
  /**
   * Создает новый распределенный план запроса
   */
  createPlan(
    steps: QueryStepWithDependencies[],
    requiredServices: DatabaseService[],
    finalStepId?: string
  ): DistributedQueryPlan {
    const planId = uuidv4();
    
    // Если не указан финальный шаг, выбираем последний
    const lastStepId = finalStepId || steps[steps.length - 1]?.id;
    
    if (!lastStepId) {
      throw new Error('No steps provided for query plan');
    }
    
    return {
      id: planId,
      steps,
      requiredServices,
      finalStepId: lastStepId
    };
  }
}

// Создаем и экспортируем глобальный экземпляр процессора
export const distributedQueryProcessor = new DistributedQueryProcessor(); 