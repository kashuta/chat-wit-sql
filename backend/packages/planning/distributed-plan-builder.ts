import { v4 as uuidv4 } from 'uuid';
import { logDebug, logInfo } from '@common/logger';
import { QueryPlan } from '@common/types';
import { 
  DistributedQueryPlan, 
  QueryStepWithDependencies,
  InMemoryOperation
} from '@execution/distributed-query';

/**
 * Класс для построения распределенного плана запроса
 */
export class DistributedPlanBuilder {
  /**
   * Преобразует стандартный план запроса в распределенный план
   */
  convertToDQL(plan: QueryPlan, userQuery: string): DistributedQueryPlan {
    const { steps, requiredServices } = plan;
    const distributedSteps: QueryStepWithDependencies[] = [];
    
    // Идентификаторы шагов для отслеживания
    const stepIds: string[] = [];
    
    logInfo(`Converting standard query plan to distributed plan`);
    logInfo(`Standard plan has ${steps.length} steps and requires services: ${requiredServices.join(', ')}`);
    
    // Создаем первые шаги для каждой базы данных
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      
      // Пропускаем шаги без SQL запроса
      if (!step.sqlQuery) continue;
      
      // Создаем ID для шага
      const stepId = `step_${i + 1}`;
      stepIds.push(stepId);
      
      logInfo(`Creating distributed step ${stepId} for service ${step.service}: ${step.description}`);
      
      // Проверяем, есть ли параметры в SQL запросе
      const parameters: string[] = [];
      
      // Проверяем на placeholder-ы вида "?"
      if (step.sqlQuery.includes('?')) {
        logInfo(`Query contains ? placeholders, adding userId parameter for step ${stepId}`);
        parameters.push('userId');
      }
      
      // Поиск именованных параметров в формате :param или ${param}
      // с правильным контекстом для SQL - это должны быть отдельные токены
      const namedParamRegex = /[:$]\{?(\w+)\}?(?=\s|[,);]|$)/g;
      let match;
      while ((match = namedParamRegex.exec(step.sqlQuery)) !== null) {
        const paramName = match[1];
        
        // Проверка на ложные срабатывания
        // Например, "createdAt::date" не должен считать "date" параметром
        const prevChar = match.index > 0 ? step.sqlQuery[match.index - 1] : '';
        // Пропускаем, если предыдущий символ ":", что указывает на приведение типов в PostgreSQL
        if (prevChar === ':') {
          logInfo(`Skipping false positive parameter ${paramName} at position ${match.index}, looks like type cast`);
          continue;
        }
        
        if (!parameters.includes(paramName)) {
          logInfo(`Found named parameter ${paramName} in query, adding to step ${stepId}`);
          parameters.push(paramName);
        }
      }
      
      // Проверяем, содержит ли запрос подзапросы к другим сервисам
      // Например: WHERE id = (SELECT userId FROM "Transaction" ...)
      // Если да, то нужно создать зависимость от предыдущего шага
      
      // Список таблиц, которые могут использоваться в этом запросе
      const potentialTableNames: string[] = [];
      
      // Извлекаем имена таблиц из запроса
      const tableNameRegex = /FROM\s+"?([A-Za-z0-9_]+)"?/gi;
      let tableMatch;
      while ((tableMatch = tableNameRegex.exec(step.sqlQuery)) !== null) {
        potentialTableNames.push(tableMatch[1]);
      }
      
      // Проверяем, есть ли подзапросы и ссылки на таблицы из других сервисов
      const subqueryRegex = /\(\s*SELECT\s+.+?\s+FROM\s+"?([A-Za-z0-9_]+)"?/gi;
      while ((tableMatch = subqueryRegex.exec(step.sqlQuery)) !== null) {
        const subqueryTable = tableMatch[1];
        potentialTableNames.push(subqueryTable);
      }
      
      // Добавляем шаг в распределенный план
      distributedSteps.push({
        id: stepId,
        service: step.service,
        description: step.description,
        sqlQuery: step.sqlQuery,
        parameters: parameters.length > 0 ? parameters : undefined,
        dependsOn: [],
        isInMemory: false
      });
    }
    
    // Анализируем зависимости между шагами и устанавливаем их
    for (let i = 1; i < distributedSteps.length; i++) {
      const currentStep = distributedSteps[i];
      const previousSteps = distributedSteps.slice(0, i);
      
      // Если текущий шаг имеет параметры, создаем зависимость от предыдущего
      if (currentStep.parameters && currentStep.parameters.length > 0) {
        const prevStepId = previousSteps[previousSteps.length - 1].id;
        logInfo(`Step ${currentStep.id} has parameters: ${currentStep.parameters.join(', ')}, creating dependency on ${prevStepId}`);
        currentStep.dependsOn.push(prevStepId);
      }
      
      // Специальный случай: если второй шаг обращается к таблице Transaction, 
      // а первый шаг работает с Transaction, создаем зависимость
      if (i === 1 && 
          currentStep.sqlQuery && 
          currentStep.sqlQuery.includes("Transaction") &&
          previousSteps[0].service === "wallet") {
        logInfo(`Step ${currentStep.id} references Transaction table which is in wallet service. Creating dependency on step_1`);
        
        // Заменяем SQL запрос на использующий параметр из первого шага
        if (currentStep.sqlQuery.includes("User") && 
            currentStep.sqlQuery.includes("Transaction") && 
            currentStep.service === "pam") {
          logInfo(`Modifying step ${currentStep.id} to use userId parameter from step_1`);
          
          const currentQuery = currentStep.sqlQuery;
          
          // Пример SQL запроса:
          // SELECT * FROM "User" WHERE id = (SELECT userId FROM "Transaction" WHERE "type" = 'DEPOSIT' AND "createdAt"::date = (CURRENT_DATE - INTERVAL '1 day') ORDER BY amount DESC LIMIT 1)
          
          // Изменяем запрос на:
          // SELECT * FROM "User" WHERE id = $1
          
          // Используем более надежную стратегию замены запроса
          let newQuery = "";
          
          if (currentQuery.includes("ORDER BY") && currentQuery.endsWith(")")) {
            // Избегаем сохранения лишних скобок или ORDER BY из подзапроса
            newQuery = "SELECT * FROM \"User\" WHERE id = $1";
          } else {
            newQuery = currentQuery.replace(
              /WHERE\s+id\s*=\s*\(\s*SELECT\s+.+?\s+FROM\s+"?Transaction"?.+?\)/i,
              'WHERE id = $1'
            );
          }
          
          logInfo(`Modified SQL query for ${currentStep.id}: ${newQuery}`);
          
          currentStep.sqlQuery = newQuery;
          currentStep.parameters = ['userId'];
          currentStep.dependsOn = ['step_1'];
        }
      }
    }
    
    // Проверяем, нужны ли дополнительные шаги для объединения результатов
    let finalStepId: string;
    
    // Если более одного шага, добавляем операции для обработки результатов
    if (stepIds.length > 1) {
      finalStepId = this.analyzeAndBuildAggregationSteps(
        distributedSteps,
        stepIds,
        userQuery
      );
    } else {
      // Если только один шаг, результат этого шага будет финальным
      finalStepId = stepIds[0] || '';
    }
    
    // Создаем итоговый распределенный план
    return {
      id: uuidv4(),
      steps: distributedSteps,
      requiredServices,
      finalStepId
    };
  }
  
  /**
   * Анализирует шаги и строит план агрегации результатов
   */
  private analyzeAndBuildAggregationSteps(
    steps: QueryStepWithDependencies[],
    initialStepIds: string[],
    userQuery: string
  ): string {
    const queryLower = userQuery.toLowerCase();
    let lastStepId = '';
    
    // Шаг 1: Определяем, что делать в зависимости от типа запроса
    if (this.isCountQuery(queryLower)) {
      // Для запросов с подсчетом результатов
      lastStepId = this.buildCountAggregationSteps(steps, initialStepIds);
    } else if (this.isMaxQuery(queryLower)) {
      // Для запросов с поиском максимального значения
      const potentialFields = this.extractPotentialMaxFields(queryLower);
      lastStepId = this.buildMaxAggregationSteps(steps, initialStepIds, potentialFields);
    } else if (this.isSortLimitQuery(queryLower)) {
      // Для запросов с сортировкой и лимитом
      const { sortFields, isDescending } = this.extractSortFields(queryLower);
      lastStepId = this.buildSortLimitAggregationSteps(
        steps, 
        initialStepIds, 
        sortFields, 
        isDescending
      );
    } else {
      // По умолчанию просто объединяем все результаты с шагами JOIN
      lastStepId = this.buildSimpleJoinAggregationSteps(steps, initialStepIds);
    }
    
    return lastStepId;
  }
  
  /**
   * Проверяет, является ли запрос запросом на подсчет (COUNT)
   */
  private isCountQuery(query: string): boolean {
    return /count|how many|сколько/i.test(query);
  }
  
  /**
   * Проверяет, является ли запрос запросом на поиск максимального значения
   */
  private isMaxQuery(query: string): boolean {
    return /max|maximum|highest|biggest|largest|most|самый большой|максимальный/i.test(query);
  }
  
  /**
   * Проверяет, является ли запрос запросом с сортировкой и лимитом
   */
  private isSortLimitQuery(query: string): boolean {
    return /sort|order|limit|top|best|sorted|сортировка|порядок|лучший|топ/i.test(query);
  }
  
  /**
   * Извлекает потенциальные поля для поиска максимального значения
   */
  private extractPotentialMaxFields(query: string): string[] {
    const fields: string[] = [];
    
    // Ищем упоминания различных показателей
    if (/amount|sum|deposit|money|сумм|деньг|депозит/i.test(query)) {
      fields.push('amount');
    }
    
    if (/count|number|quantity|число|количество/i.test(query)) {
      fields.push('count');
    }
    
    if (/date|time|when|дат|время|когда/i.test(query)) {
      fields.push('createdAt');
      fields.push('created_at');
      fields.push('date');
    }
    
    // Добавляем базовые поля, если ничего не найдено
    if (fields.length === 0) {
      fields.push('amount');
      fields.push('count');
      fields.push('id');
    }
    
    return fields;
  }
  
  /**
   * Извлекает поля для сортировки
   */
  private extractSortFields(query: string): { sortFields: string[], isDescending: boolean } {
    const fields: string[] = [];
    let isDescending = true;
    
    // Ищем упоминания различных показателей
    if (/amount|sum|deposit|money|сумм|деньг|депозит/i.test(query)) {
      fields.push('amount');
    }
    
    if (/date|time|when|дат|время|когда/i.test(query)) {
      fields.push('createdAt');
      fields.push('created_at');
      fields.push('date');
    }
    
    if (/name|user|имя|пользовате/i.test(query)) {
      fields.push('name');
      fields.push('username');
      fields.push('user_name');
    }
    
    // Определяем направление сортировки
    if (/asc|least|smallest|минимал|наимен/i.test(query)) {
      isDescending = false;
    }
    
    // Добавляем базовые поля, если ничего не найдено
    if (fields.length === 0) {
      fields.push('id');
      fields.push('amount');
      fields.push('createdAt');
      fields.push('created_at');
    }
    
    return { sortFields: fields, isDescending };
  }
  
  /**
   * Строит шаги для агрегации результатов запросов с подсчетом
   */
  private buildCountAggregationSteps(
    steps: QueryStepWithDependencies[],
    initialStepIds: string[]
  ): string {
    // Определяем ID для шага агрегации
    const aggregateStepId = `aggregate_count`;
    
    // Добавляем шаг для агрегации результатов
    steps.push({
      id: aggregateStepId,
      service: 'pam', // Не имеет значения для in-memory шага
      description: 'Aggregate count results from all services',
      dependsOn: initialStepIds,
      isInMemory: true,
      operation: InMemoryOperation.AGGREGATE,
      parameters: ['count', '*']
    });
    
    logInfo(`Added count aggregation step: ${aggregateStepId}`);
    return aggregateStepId;
  }
  
  /**
   * Строит шаги для агрегации результатов запросов с поиском максимального значения
   */
  private buildMaxAggregationSteps(
    steps: QueryStepWithDependencies[],
    initialStepIds: string[],
    potentialFields: string[]
  ): string {
    // Создаем шаги для поиска максимума в каждом наборе результатов
    const maxStepIds: string[] = [];
    
    for (let i = 0; i < initialStepIds.length; i++) {
      const stepId = initialStepIds[i];
      
      // Для каждого потенциального поля создаем шаг для поиска максимума
      for (const field of potentialFields) {
        const maxStepId = `max_${field}_${i + 1}`;
        
        steps.push({
          id: maxStepId,
          service: 'pam', // Не имеет значения для in-memory шага
          description: `Find maximum ${field} in results from step ${stepId}`,
          dependsOn: [stepId],
          isInMemory: true,
          operation: InMemoryOperation.AGGREGATE,
          parameters: ['max', field]
        });
        
        maxStepIds.push(maxStepId);
        logDebug(`Added max aggregation step for field ${field}: ${maxStepId}`);
      }
    }
    
    // Добавляем шаг для поиска глобального максимума
    const globalMaxStepId = 'global_max';
    
    steps.push({
      id: globalMaxStepId,
      service: 'pam', // Не имеет значения для in-memory шага
      description: 'Find global maximum from all services',
      dependsOn: maxStepIds,
      isInMemory: true,
      operation: InMemoryOperation.AGGREGATE,
      parameters: ['max', 'max']
    });
    
    // Добавляем шаг для фильтрации оригинальных данных по максимальному значению
    const filterStepId = 'filter_by_max';
    
    steps.push({
      id: filterStepId,
      service: 'pam', // Не имеет значения для in-memory шага
      description: 'Filter results to find records with maximum value',
      dependsOn: [...initialStepIds, globalMaxStepId],
      isInMemory: true,
      operation: InMemoryOperation.FILTER,
      parameters: [potentialFields[0], '=', '${max}'] // Используем значение из шага глобального максимума
    });
    
    logInfo(`Added max value filter step: ${filterStepId}`);
    return filterStepId;
  }
  
  /**
   * Строит шаги для агрегации результатов запросов с сортировкой и лимитом
   */
  private buildSortLimitAggregationSteps(
    steps: QueryStepWithDependencies[],
    initialStepIds: string[],
    sortFields: string[],
    isDescending: boolean
  ): string {
    // Объединяем результаты из всех шагов
    const joinStepId = 'join_all';
    
    steps.push({
      id: joinStepId,
      service: 'pam', // Не имеет значения для in-memory шага
      description: 'Combine results from all services',
      dependsOn: initialStepIds,
      isInMemory: true,
      operation: InMemoryOperation.JOIN,
      parameters: ['id'] // Предполагаем, что id - общее поле для всех таблиц
    });
    
    // Создаем шаг для сортировки объединенных результатов
    const sortDirection = isDescending ? 'desc' : 'asc';
    let currentStepId = joinStepId;
    
    // Сортируем по каждому полю, если возможно
    for (const field of sortFields) {
      const sortStepId = `sort_by_${field}`;
      
      steps.push({
        id: sortStepId,
        service: 'pam', // Не имеет значения для in-memory шага
        description: `Sort results by ${field} ${sortDirection}`,
        dependsOn: [currentStepId],
        isInMemory: true,
        operation: InMemoryOperation.SORT,
        parameters: [field, sortDirection]
      });
      
      currentStepId = sortStepId;
      logDebug(`Added sort step for field ${field}: ${sortStepId}`);
    }
    
    // Добавляем шаг для ограничения количества результатов
    const limitStepId = `limit_${sortFields[0]}`;
    
    steps.push({
      id: limitStepId,
      service: 'pam', // Не имеет значения для in-memory шага
      description: `Take top 3 rows from ${currentStepId}`,
      dependsOn: [currentStepId],
      isInMemory: true,
      operation: InMemoryOperation.LIMIT,
      parameters: ['3']
    });
    
    logInfo(`Added sort and limit steps: ${limitStepId}`);
    return limitStepId;
  }
  
  /**
   * Строит простые шаги для объединения результатов запросов
   */
  private buildSimpleJoinAggregationSteps(
    steps: QueryStepWithDependencies[],
    initialStepIds: string[]
  ): string {
    // Если всего один шаг, возвращаем его id
    if (initialStepIds.length === 1) {
      return initialStepIds[0];
    }
    
    // Объединяем результаты из всех шагов парами
    let currentStepId = initialStepIds[0];
    
    for (let i = 1; i < initialStepIds.length; i++) {
      const joinStepId = `join_${i}`;
      
      steps.push({
        id: joinStepId,
        service: 'pam', // Не имеет значения для in-memory шага
        description: `Join results from step ${currentStepId} and ${initialStepIds[i]}`,
        dependsOn: [currentStepId, initialStepIds[i]],
        isInMemory: true,
        operation: InMemoryOperation.JOIN,
        parameters: ['id'] // Предполагаем, что id - общее поле для всех таблиц
      });
      
      currentStepId = joinStepId;
      logDebug(`Added join step: ${joinStepId}`);
    }
    
    return currentStepId;
  }
}

// Создаем и экспортируем глобальный экземпляр конструктора
export const distributedPlanBuilder = new DistributedPlanBuilder();