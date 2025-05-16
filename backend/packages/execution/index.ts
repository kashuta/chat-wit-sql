import { z } from 'zod';
import { QueryPlan, QueryResponse, DatabaseService, ErrorType } from '@common/types';
import { createTypedError } from '@common/utils';
import { getOpenAIModel, createOutputParser } from '@common/llm';
import { executeSqlQuery as dbExecuteSqlQuery } from '@execution/database';
import { EXECUTION_SYSTEM_PROMPT } from '../../data/prompts';
import { distributedQueryProcessor } from './distributed-query';
import { distributedPlanBuilder } from '@planning/distributed-plan-builder';
import { logDebug, logInfo, logWarn } from '@common/logger';

/**
 * Executes an SQL query with error handling and logging
 * @param service - Database service 
 * @param query - SQL query
 * @returns Query results
 */
export const executeSqlQuery = async (
  service: DatabaseService, 
  query: string
): Promise<Record<string, unknown>[]> => {
  // Calling the actual database connection instead of a mock
  logInfo(`Executing SQL query on ${service}: ${query}`);
  
  try {
    // Using the actual database connection instead of a mock
    const result = await dbExecuteSqlQuery({ 
      service, 
      query 
    });
    logInfo(`SQL query executed successfully`);
    logDebug(`Result: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    logWarn(`Error executing SQL: ${(error as Error).message}`);
    throw error;
  }
};

/**
 * Schema for execution result validation
 */
const executionResultSchema = z.object({
  explanation: z.string().describe('Explanation of the data and insights'),
  confidence: z.number().min(0).max(1).describe('Confidence in the results'),
  visualizationType: z.enum(['table', 'line', 'bar', 'pie']).describe('Recommended visualization type'),
});

// Define the output type from the zod schema
type ExecutionOutput = z.infer<typeof executionResultSchema>;

/**
 * Executes a query plan and interprets the results
 * @param plan - Query plan to execute
 * @param query - Original user query
 * @returns Query response with data and explanation
 */
export const executeQueryPlan = async (
  plan: QueryPlan,
  query: string
): Promise<QueryResponse> => {
  try {
    // Проверяем, нужно ли использовать распределенный исполнитель
    const needsDistributedExecution = 
      plan.requiredServices.length > 1 || 
      plan.steps.some(step => !step.sqlQuery);
    
    let stepResults: Record<string, Record<string, unknown>[]> = {};
    let executedQueries: string[] = [];
    let executionErrors: Record<string, string> = {};
    
    if (needsDistributedExecution) {
      logInfo('Using distributed query execution for multi-service query');
      
      // Преобразуем обычный план в распределенный
      const distributedPlan = distributedPlanBuilder.convertToDQL(plan, query);
      
      // Выполняем распределенный план
      const distributedResult = await distributedQueryProcessor.executeDistributedPlan(distributedPlan);
      
      // Переносим результаты в формат, ожидаемый дальнейшим кодом
      stepResults = distributedResult.intermediateResults || {};
      
      // Форматируем логи запросов для отображения
      for (const step of distributedPlan.steps) {
        if (!step.isInMemory && step.sqlQuery) {
          executedQueries.push(`/* ${step.service} */\n${step.sqlQuery}`);
        }
      }
      
      // Если есть ошибки, записываем их
      if (distributedResult.errors) {
        executionErrors = distributedResult.errors;
        
        // Проверяем, есть ли глобальная ошибка, которая могла прервать выполнение
        if (distributedResult.errors.global) {
          throw new Error(distributedResult.errors.global);
        }
      }
      
      // Финальные результаты должны быть включены в stepResults
      if (distributedResult.finalResults.length > 0) {
        stepResults['final'] = distributedResult.finalResults;
      }
    } else {
      // Используем простое последовательное выполнение для одиночного сервиса
      logInfo('Using standard sequential execution for single-service query');
      
      // Выполняем каждый шаг плана
      for (const step of plan.steps) {
        if (!step.sqlQuery) {
          continue;
        }
        
        executedQueries.push(`/* ${step.service} */\n${step.sqlQuery}`);
        try {
          logInfo(`Executing step for ${step.service}: ${step.sqlQuery}`);
          const result = await executeSqlQuery(step.service, step.sqlQuery);
          logInfo(`Step result for ${step.service}: ${JSON.stringify(result)}`);
          stepResults[step.service] = result;
        } catch (queryError) {
          const errorMessage = `Error executing step for ${step.service}: ${(queryError as Error).message}`;
          logWarn(errorMessage);
          
          // Продолжаем с другими шагами, даже если один не сработал
          stepResults[step.service] = [{ error: (queryError as Error).message }];
          
          executionErrors[step.service] = errorMessage;
        }
      }
    }
    
    if (Object.keys(stepResults).length === 0) {
      throw createTypedError(
        ErrorType.PROCESSING_ERROR,
        'No SQL queries were executed or all queries failed'
      );
    }
    
    // Выбираем модель для интерпретации результатов
    const model = getOpenAIModel();
    const parser = createOutputParser(executionResultSchema);
    
    const sqlQueriesStr = executedQueries.join('\n\n');
    logInfo('=== QUERY RESULTS BEFORE SENDING TO LLM ===');
    logInfo(JSON.stringify(stepResults, null, 2));
    logInfo('=== END QUERY RESULTS ===');
    const resultsStr = JSON.stringify(stepResults, null, 2);
    
    // Системное сообщение
    const systemMessage = {
      role: 'system',
      content: EXECUTION_SYSTEM_PROMPT
    };
    
    // Сообщение пользователя
    const userMessage = {
      role: 'user',
      content: `User query: ${query}

SQL queries executed:
${sqlQueriesStr}

Query results:
${resultsStr}

Please interpret these results.`
    };
    
    // Подготавливаем сообщения для модели
    const messages = [systemMessage, userMessage];
    
    const response = await model.invoke(messages);
    
    if (typeof response.content !== 'string') {
      throw new Error('LLM response content is not a string');
    }
    
    logInfo(`Raw execution response: ${response.content}`);
    
    const interpretation = await parser.parse(response.content) as ExecutionOutput;
    
    // Возвращаем структурированный ответ
    return {
      data: stepResults,
      explanation: interpretation.explanation,
      confidence: interpretation.confidence,
      sql: sqlQueriesStr,
      visualization: {
        type: interpretation.visualizationType as 'table' | 'line' | 'bar' | 'pie',
        data: stepResults,
      },
      errors: Object.keys(executionErrors).length > 0 ? executionErrors : undefined,
    };
  } catch (error) {
    logWarn('Error in execution module:', error);
    
    // Возвращаем резервный ответ в случае ошибки
    return {
      data: {},
      explanation: `An error occurred while executing the query plan: ${(error as Error).message}`,
      confidence: 0.1,
    };
  }
}; 