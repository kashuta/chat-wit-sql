import { v4 as uuidv4 } from 'uuid';
import { logError, logInfo, logWarn, logDebug } from '@common/logger';
import { resultStore } from '@common/result-store';
import { DatabaseService } from '@common/types';
import { executeSqlQuery } from './index';
import { databaseKnowledge } from '@common/knowledge';

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
  crossServiceReferences?: Array<{tableName: string, service: string}>; // References to tables in other services
  crossServiceColumns?: Array<{columnName: string, sourceService: string, sourceTable: string}>;  // References to columns from other services
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
      
      // Убедимся, что Redis подключен, но не выбрасываем исключение если не удалось
      try {
        // Проверяем, подключен ли уже Redis 
        if (!resultStore.isConnected()) {
          await resultStore.connect();
        }
      } catch (err) {
        logWarn(`Could not connect to Redis: ${(err as Error).message}. Using in-memory fallback.`);
      }
      
      // Очистка кеша от предыдущих результатов с этим ID
      try {
        await resultStore.clear(planId);
      } catch (err) {
        logWarn(`Failed to clear previous results: ${(err as Error).message}. Continuing execution.`);
      }
      
      // Валидация шагов на предмет ошибок в межсервисных запросах
      const validationResult = this.validateServiceBoundaries(plan.steps);
      if (!validationResult.isValid) {
        logError(`Plan validation failed: ${validationResult.error}`);
        throw new Error(validationResult.error);
      }
      
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
            
            // Validate the SQL query against the schema
            const schemaValidation = this.validateSqlAgainstSchema(step.service, sqlQuery);
            if (!schemaValidation.isValid) {
              logWarn(`Schema validation error: ${schemaValidation.error}`);
              logInfo(`Attempting to fix SQL query...`);
              
              // Try to automatically fix common issues
              sqlQuery = this.attemptSqlFix(step.service, sqlQuery);
              
              // Validate again after fixing
              const revalidation = this.validateSqlAgainstSchema(step.service, sqlQuery);
              if (!revalidation.isValid) {
                throw new Error(`Schema validation failed: ${revalidation.error}`);
              }
              
              logInfo(`SQL query fixed: ${sqlQuery}`);
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
    
    // Проверяем наличие именованных параметров в разных форматах
    // Включаем ситуации с кавычками: :"userId", :"param", :param и т.д.
    const namedParamRegex = /[:@]"?\w+"?|\$\{\w+\}|\$[0-9]+/g;
    
    // Проверяем, есть ли вообще какие-либо параметры в запросе
    const matchedParams = sqlQuery.match(namedParamRegex);
    
    // Специфичная обработка для случая с запросом "WHERE "id" = :userId"
    // Это прямая проверка паттерна из логов, который вызывал ошибку
    if (sqlQuery.includes(`"id" = :userId`) || sqlQuery.includes(`"id" = :"userId"`)) {
      logInfo(`Обнаружен известный проблемный паттерн: "id" = :userId или "id" = :"userId"`);
      
      // Ищем значение параметра userId
      for (const param of parameters) {
        if (param.toLowerCase() === 'userid') {
          for (const stepId of dependsOnSteps) {
            const results = dependentResults[stepId] || [];
            
            if (results.length > 0) {
              for (const [key, value] of Object.entries(results[0])) {
                if (key.toLowerCase() === 'userid') {
                  const sqlValue = this.formatValueForSql(value);
                  // Заменяем проблемный паттерн
                  const fixedQuery = sqlQuery
                    .replace(`"id" = :userId`, `"id" = ${sqlValue}`)
                    .replace(`"id" = :"userId"`, `"id" = ${sqlValue}`);
                  
                  logInfo(`Исправлено: заменен "id" = :userId на "id" = ${sqlValue}`);
                  return fixedQuery;
                }
              }
            }
          }
        }
      }
    }
    
    if (!matchedParams || matchedParams.length === 0) {
      // Дополнительная проверка на параметры в SQL
      logInfo(`Проверка не обнаружила параметров в запросе`);
      
      // Ручная проверка для "трудных" случаев с параметрами
      let hasManuallyDetectedParams = false;
      for (const param of parameters) {
        const patterns = [
          `:${param}`,
          `:\"${param}\"`,
          `:"${param}"`,
          `@${param}`,
          `$${param}`,
          `\${${param}}`
        ];
        
        for (const pattern of patterns) {
          if (sqlQuery.includes(pattern)) {
            hasManuallyDetectedParams = true;
            logInfo(`Ручное обнаружение нашло параметр ${pattern} в запросе`);
            break;
          }
        }
        
        if (hasManuallyDetectedParams) break;
      }
      
      if (!hasManuallyDetectedParams) {
        // Ситуация: параметры указаны в step.parameters, но не найдены в SQL
        // Это может быть ошибкой в генерации SQL или проблемой с форматированием
        logWarn(`ВНИМАНИЕ: Параметры ${parameters.join(', ')} указаны для шага, но не найдены в SQL запросе.`);
        logWarn(`SQL запрос: ${sqlQuery}`);
        logWarn(`Это может привести к ошибкам выполнения!`);
        
        // Проверяем наличие символа ":" в запросе - это может указывать на наличие именованных параметров
        if (sqlQuery.includes(':')) {
          logWarn(`В SQL запросе найден символ ':' - возможно, это нестандартный формат параметра.`);
          
          // Пытаемся исправить наиболее очевидные случаи
          for (const param of parameters) {
            // Специальный случай: :"userId" - двоеточие перед кавычкой
            if (sqlQuery.includes(`:"`) && sqlQuery.includes(param)) {
              logInfo(`Обнаружен возможный параметр в формате :"${param}" - попытка исправить.`);
              
              // Получаем значение параметра из результатов предыдущих шагов
              let paramValue: unknown = null;
              
              // Ищем значение в зависимых шагах
              for (const stepId of dependsOnSteps) {
                const results = dependentResults[stepId] || [];
                
                if (results.length > 0) {
                  const firstRow = results[0];
                  
                  // Ищем поле с именем параметра (без учета регистра)
                  for (const [key, value] of Object.entries(firstRow)) {
                    if (key.toLowerCase() === param.toLowerCase()) {
                      paramValue = value;
                      const sqlValue = this.formatValueForSql(paramValue);
                      
                      // Ищем вхождения формата :"userId"
                      const regex = new RegExp(`:"${param}"`, 'g');
                      if (sqlQuery.match(regex)) {
                        parameterizedQuery = sqlQuery.replace(regex, sqlValue);
                        logInfo(`Исправлено: заменен :"${param}" на ${sqlValue}`);
                        return parameterizedQuery;
                      }
                      
                      // Ищем вхождения формата = :"userId"
                      const equalsRegex = new RegExp(`=\\s*:"${param}"`, 'g');
                      if (sqlQuery.match(equalsRegex)) {
                        parameterizedQuery = sqlQuery.replace(equalsRegex, `= ${sqlValue}`);
                        logInfo(`Исправлено: заменен = :"${param}" на = ${sqlValue}`);
                        return parameterizedQuery;
                      }
                      
                      break;
                    }
                  }
                }
              }
            }
          }
        }
        
        logInfo(`Не найдены параметры в запросе. Возвращаем исходный запрос.`);
        return sqlQuery;
      }
    } else {
      logInfo(`Найдены параметры в запросе: ${matchedParams.join(', ')}`);
    }
    
    // Заменяем параметры в запросе
    for (const param of parameters) {
      // Форматы параметров, которые мы ищем
      const formats = [
        `:${param}`,       // :userId
        `:\"${param}\"`,   // :"userId"
        `:"${param}"`,     // :"userId"
        `@${param}`,       // @userId
        `\${${param}}`,    // ${userId}
        `$${param}`        // $userId
      ];
      
      // Получаем значение параметра из результатов предыдущих шагов
      let paramValue: unknown = null;
      let found = false;
      
      // Ищем значение в зависимых шагах
      for (const stepId of dependsOnSteps) {
        const results = dependentResults[stepId] || [];
        
        if (results.length > 0) {
          const firstRow = results[0];
          
          // Ищем поле с именем параметра (без учета регистра)
          for (const [key, value] of Object.entries(firstRow)) {
            if (key.toLowerCase() === param.toLowerCase()) {
              paramValue = value;
              found = true;
              logInfo(`Found value for parameter ${param} = ${this.formatValueForSql(value)} in step ${stepId}`);
              break;
            }
          }
          
          if (found) break;
        }
      }
      
      if (!found) {
        logWarn(`Value for parameter ${param} not found in any dependent step results.`);
        continue;
      }
      
      // Форматируем значение для SQL
      const sqlValue = this.formatValueForSql(paramValue);
      
      // Заменяем все форматы параметра в запросе
      for (const format of formats) {
        // Экранируем специальные символы в формате
        const escapedFormat = format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Создаем регулярное выражение для различных ситуаций
        // 1. Для форматов с кавычками ищем точное совпадение
        // 2. Для остальных форматов учитываем границы слов
        const regex = format.includes('"') || format.includes("'") 
          ? new RegExp(escapedFormat, 'g')
          : new RegExp(`${escapedFormat}\\b`, 'g');
        
        if (parameterizedQuery.match(regex)) {
          parameterizedQuery = parameterizedQuery.replace(regex, sqlValue);
          logInfo(`Replaced ${format} with ${sqlValue}`);
        }
      }
      
      // Особый случай - :param внутри или после кавычек
      // Например: = :"userId" или ="userId"
      const colonQuotedParamRegex = new RegExp(`:"${param}"`, 'g');
      if (parameterizedQuery.match(colonQuotedParamRegex)) {
        parameterizedQuery = parameterizedQuery.replace(colonQuotedParamRegex, sqlValue);
        logInfo(`Replaced :"${param}" with ${sqlValue}`);
      }
      
      // Также проверяем числовые параметры ($1, $2)
      const paramIndex = parameters.indexOf(param) + 1;
      const numericParam = `$${paramIndex}`;
      const numericRegex = new RegExp(`\\${numericParam}\\b`, 'g');
      
      if (parameterizedQuery.match(numericRegex)) {
        parameterizedQuery = parameterizedQuery.replace(numericRegex, sqlValue);
        logInfo(`Replaced numeric parameter ${numericParam} with ${sqlValue}`);
      }

      // Обработка "голых" параметров без экранирования
      // Это запасной вариант, если все предыдущие проверки не сработали
      // Есть риск замены не тех частей запроса, поэтому проверяем контекст
      if (parameterizedQuery.includes(`:${param}`) || 
          parameterizedQuery.includes(`:\"${param}\"`) ||
          parameterizedQuery.includes(`:"${param}"`)) {
        
        // Простейшая эвристика: параметр после знака равенства
        const whereClauseRegex = new RegExp(`=\\s*:["\']?${param}["\']?`, 'g');
        if (parameterizedQuery.match(whereClauseRegex)) {
          parameterizedQuery = parameterizedQuery.replace(whereClauseRegex, `= ${sqlValue}`);
          logInfo(`Fallback: заменил параметр после знака равенства: =\\s*:["\']?${param}["\']? на = ${sqlValue}`);
        }
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
   * Attempts to fix common SQL schema issues
   */
  private attemptSqlFix(service: DatabaseService, sqlQuery: string): string {
    let fixedQuery = sqlQuery;
    
    // Get database description
    const dbDescription = databaseKnowledge.getDatabaseDescription(service);
    if (!dbDescription) {
      return fixedQuery;
    }
    
    // Extract table references
    const tableRegex = /\bFROM\s+"?([A-Za-z0-9_]+)"?/gi;
    const joinRegex = /\bJOIN\s+"?([A-Za-z0-9_]+)"?/gi;
    
    const tables: string[] = [];
    let match: RegExpExecArray | null;
    
    while ((match = tableRegex.exec(sqlQuery)) !== null) {
      tables.push(match[1]);
    }
    
    while ((match = joinRegex.exec(sqlQuery)) !== null) {
      tables.push(match[1]);
    }
    
    // Fix 1: Invalid table names - try to find similar tables
    for (const tableName of tables) {
      const tableExists = dbDescription.tables.some(t => 
        t.name.toLowerCase() === tableName.toLowerCase()
      );
      
      if (!tableExists) {
        // Try to find a similar table name
        const similarTables = dbDescription.tables
          .filter(t => this.calculateSimilarity(t.name.toLowerCase(), tableName.toLowerCase()) > 0.7)
          .sort((a, b) => 
            this.calculateSimilarity(b.name.toLowerCase(), tableName.toLowerCase()) - 
            this.calculateSimilarity(a.name.toLowerCase(), tableName.toLowerCase())
          );
        
        if (similarTables.length > 0) {
          const correctTableName = similarTables[0].name;
          logInfo(`Replacing invalid table name "${tableName}" with similar table "${correctTableName}"`);
          
          // Replace the table name in FROM clause
          fixedQuery = fixedQuery.replace(
            new RegExp(`\\bFROM\\s+"?${tableName}"?\\b`, 'gi'), 
            `FROM "${correctTableName}"`
          );
          
          // Replace the table name in JOIN clause
          fixedQuery = fixedQuery.replace(
            new RegExp(`\\bJOIN\\s+"?${tableName}"?\\b`, 'gi'), 
            `JOIN "${correctTableName}"`
          );
        }
      }
    }
    
    // SQL ключевые слова, которые никогда не должны заключаться в кавычки
    const sqlKeywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'GROUP', 'ORDER', 'BY', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'ON', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE', 'ASC', 'DESC', 'INNER', 'OUTER', 'LEFT', 'RIGHT', 'FULL', 'DISTINCT', 'ALL', 'BETWEEN', 'LIKE', 'ILIKE', 'SIMILAR', 'TO'];
    
    // Fix 2: Unquoted identifiers - add quotes to all column references
    const columnReferencePatterns = [
      /\bSELECT\s+(.*?)\s+FROM\b/gi,
      /\bWHERE\s+(.*?)\s+(?:GROUP BY|ORDER BY|LIMIT|$)/gi,
      /\bORDER\s+BY\s+(.*?)(?:LIMIT|$)/gi,
      /\bGROUP\s+BY\s+(.*?)(?:HAVING|ORDER BY|LIMIT|$)/gi
    ];
    
    for (const pattern of columnReferencePatterns) {
      fixedQuery = fixedQuery.replace(pattern, (match, clauseContent) => {
        // Split by commas for multi-column clauses
        const columns = clauseContent.split(',');
        
        // Process each column
        const fixedColumns = columns.map((column: string) => {
          // Skip if already quoted or contains functions
          if (column.includes('"') || 
              column.includes('(') || 
              column.includes('*') ||
              column.trim() === '') {
            return column;
          }
          
          // Добавляем кавычки к идентификаторам, но не к ключевым словам SQL
          return column.replace(/\b([A-Za-z0-9_]+)\b/g, (_, word) => {
            if (sqlKeywords.includes(word.toUpperCase())) {
              return word; // Возвращаем ключевое слово без кавычек
            }
            return `"${word}"`; // Добавляем кавычки к идентификатору
          });
        });
        
        // Rebuild the clause
        return match.replace(clauseContent, fixedColumns.join(','));
      });
    }
    
    // Fix 3: Ensure proper capitalization of column names
    for (const tableName of tables) {
      const tableDescription = dbDescription.tables.find(t => 
        t.name.toLowerCase() === tableName.toLowerCase()
      );
      
      if (tableDescription) {
        for (const column of tableDescription.columns) {
          // Replace incorrect case with correct case
          const columnRegex = new RegExp(`"${column.name.toLowerCase()}"`, 'gi');
          fixedQuery = fixedQuery.replace(columnRegex, `"${column.name}"`);
        }
      }
    }
    
    // Fix 4: Удаляем кавычки вокруг ключевых слов SQL
    sqlKeywords.forEach(keyword => {
      const keywordRegex = new RegExp(`"${keyword}"`, 'gi');
      fixedQuery = fixedQuery.replace(keywordRegex, keyword);
    });
    
    return fixedQuery;
  }
  
  /**
   * Calculate string similarity (Levenshtein distance)
   */
  private calculateSimilarity(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    
    const matrix: number[][] = [];
    
    // Initialize matrix
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    
    for (let i = 0; i <= a.length; i++) {
      matrix[0][i] = i;
    }
    
    // Fill matrix
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = a[j - 1] === b[i - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }
    
    // Calculate similarity as a value between 0 and 1
    const maxLength = Math.max(a.length, b.length);
    const distance = matrix[b.length][a.length];
    return 1 - distance / maxLength;
  }
  
  /**
   * Validates an SQL query against the service schema
   */
  private validateSqlAgainstSchema(
    service: DatabaseService,
    sqlQuery: string
  ): { isValid: boolean; error?: string } {
    if (!databaseKnowledge.isLoaded()) {
      logWarn("Database knowledge not loaded, skipping schema validation");
      return { isValid: true };
    }
    
    // Get the database description
    const dbDescription = databaseKnowledge.getDatabaseDescription(service);
    if (!dbDescription) {
      logWarn(`No schema information available for service ${service}, skipping validation`);
      return { isValid: true };
    }
    
    // SQL ключевые слова, которые всегда нужно игнорировать при валидации
    const sqlKeywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'GROUP', 'ORDER', 'BY', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'ON', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE', 'ASC', 'DESC', 'INNER', 'OUTER', 'LEFT', 'RIGHT', 'FULL', 'DISTINCT', 'ALL', 'BETWEEN', 'LIKE', 'ILIKE', 'SIMILAR', 'TO'];
    
    // Extract table references from the query
    const tableRegex = /\bFROM\s+"?([A-Za-z0-9_]+)"?/gi;
    const joinRegex = /\bJOIN\s+"?([A-Za-z0-9_]+)"?/gi;
    
    const tables: string[] = [];
    let match: RegExpExecArray | null;
    
    while ((match = tableRegex.exec(sqlQuery)) !== null) {
      tables.push(match[1]);
    }
    
    while ((match = joinRegex.exec(sqlQuery)) !== null) {
      tables.push(match[1]);
    }
    
    // Validate each referenced table exists in the schema
    for (const tableName of tables) {
      const tableDescription = dbDescription.tables.find(t => 
        t.name.toLowerCase() === tableName.toLowerCase()
      );
      
      if (!tableDescription) {
        return {
          isValid: false,
          error: `Table "${tableName}" not found in service "${service}" schema`
        };
      }
      
      // Extract column references for this table
      const columnRegex = new RegExp(`"?${tableName}"?\\."?([A-Za-z0-9_]+)"?`, 'gi');
      const columns: string[] = [];
      
      while ((match = columnRegex.exec(sqlQuery)) !== null) {
        columns.push(match[1]);
      }
      
      // Also look for column references without table qualifier in SELECT, WHERE, ORDER BY, etc.
      const columnPatterns = [
        /\bSELECT\s+(?:.*?)(?:,\s*)?([A-Za-z0-9_]+)(?:\s|,|$)/gi,
        /\bWHERE\s+(?:.*?[=><])\s*([A-Za-z0-9_]+)(?:\s|$)/gi,
        /\bWHERE\s+([A-Za-z0-9_]+)\s*(?:[=><])/gi,
        /\bORDER\s+BY\s+([A-Za-z0-9_]+)/gi,
        /\bGROUP\s+BY\s+([A-Za-z0-9_]+)/gi
      ];
      
      for (const pattern of columnPatterns) {
        while ((match = pattern.exec(sqlQuery)) !== null) {
          // Пропускаем SQL ключевые слова
          if (!sqlKeywords.includes(match[1].toUpperCase()) && !columns.includes(match[1])) {
            columns.push(match[1]);
          }
        }
      }
      
      // Validate each referenced column exists in the table
      // Skip validation for * (SELECT *)
      for (const columnName of columns) {
        if (columnName === '*') continue;
        
        // Пропускаем SQL ключевые слова при проверке колонок
        if (sqlKeywords.includes(columnName.toUpperCase())) continue;
        
        const columnExists = tableDescription.columns.some(c => 
          c.name.toLowerCase() === columnName.toLowerCase()
        );
        
        if (!columnExists) {
          return {
            isValid: false,
            error: `Column "${columnName}" not found in table "${tableName}" of service "${service}"`
          };
        }
      }
    }
    
    return { isValid: true };
  }

  /**
   * Validates that all steps respect service boundaries and that cross-service references are handled properly
   */
  private validateServiceBoundaries(steps: QueryStepWithDependencies[]): { isValid: boolean; error?: string } {
    for (const step of steps) {
      // Skip validation for in-memory steps
      if (step.isInMemory) {
        continue;
      }
      
      // Skip steps without SQL queries
      if (!step.sqlQuery) {
        continue;
      }
      
      // Check if the step has cross-service column references that haven't been properly transformed
      if (step.crossServiceColumns && step.crossServiceColumns.length > 0) {
        for (const columnRef of step.crossServiceColumns) {
          const { columnName, sourceService, sourceTable } = columnRef;
          
          // Check if this column is being directly referenced in the SQL without proper transformation
          const columnRegex = new RegExp(`\\b${columnName}\\b`, 'i');
          
          if (columnRegex.test(step.sqlQuery)) {
            // Check that this step depends on another step that retrieves this data
            const hasDependentStep = steps.some(otherStep => 
              otherStep.service === sourceService && 
              otherStep.sqlQuery && 
              otherStep.sqlQuery.includes(sourceTable) &&
              step.dependsOn.includes(otherStep.id)
            );
            
            if (!hasDependentStep) {
              return {
                isValid: false,
                error: `Step ${step.id} directly references column ${columnName} from service ${sourceService} without a proper dependent step for data retrieval.`
              };
            }
            
            // Check if the column is used as a parameter
            const isParameter = step.parameters && step.parameters.some(param => 
              param.toLowerCase() === columnName.toLowerCase()
            );
            
            if (!isParameter) {
              return {
                isValid: false,
                error: `Step ${step.id} uses cross-service column ${columnName} without listing it as a parameter.`
              };
            }
          }
        }
      }
      
      // For table-level cross-service references, ensure they are properly handled
      if (step.crossServiceReferences && step.crossServiceReferences.length > 0) {
        for (const tableRef of step.crossServiceReferences) {
          const { tableName, service } = tableRef;
          
          // Simple check: if the table is referenced directly, it should be a parameter or a subquery
          const directTableRegex = new RegExp(`\\bFROM\\s+"?${tableName}"?\\b`, 'i');
          const joinTableRegex = new RegExp(`\\bJOIN\\s+"?${tableName}"?\\b`, 'i');
          
          if ((directTableRegex.test(step.sqlQuery) || joinTableRegex.test(step.sqlQuery)) && 
              service !== step.service) {
            // This is a direct reference to a table from another service without transformation
            return {
              isValid: false,
              error: `Step ${step.id} directly references table ${tableName} from service ${service} without transformation.`
            };
          }
        }
      }
    }
    
    return { isValid: true };
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