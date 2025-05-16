import { z } from 'zod';
import { QueryPlan, QueryResponse, DatabaseService, ErrorType } from '@common/types';
import { createTypedError } from '@common/utils';
import { getOpenAIModel, createOutputParser } from '@common/llm';
import { executeSqlQuery as dbExecuteSqlQuery } from '@execution/database';
import { EXECUTION_SYSTEM_PROMPT } from '../../data/prompts';

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
  console.log(`Executing SQL query on ${service}: ${query}`);
  
  try {
    // Using the actual database connection instead of a mock
    const result = await dbExecuteSqlQuery({ 
      service, 
      query 
    });
    console.log(`SQL query executed successfully`);
    console.log(`Result: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    console.error(`Error executing SQL: ${(error as Error).message}`);
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
    // Execute each step in the plan
    const stepResults: Record<string, Record<string, unknown>[]> = {};
    const executedQueries: string[] = [];
    
    for (const step of plan.steps) {
      if (!step.sqlQuery) {
        continue;
      }
      
      executedQueries.push(`/* ${step.service} */\n${step.sqlQuery}`);
      try {
        console.log(`Executing step for ${step.service}: ${step.sqlQuery}`);
        const result = await executeSqlQuery(step.service, step.sqlQuery);
        console.log(`Step result for ${step.service}: ${JSON.stringify(result)}`);
        stepResults[step.service] = result;
      } catch (queryError) {
        console.error(`Error executing step for ${step.service}: ${(queryError as Error).message}`);
        // Continue with other steps even if one fails
        stepResults[step.service] = [{ error: (queryError as Error).message }];
      }
    }
    
    if (Object.keys(stepResults).length === 0) {
      throw createTypedError(
        ErrorType.PROCESSING_ERROR,
        'No SQL queries were executed'
      );
    }
    
    // Interpret the results
    const model = getOpenAIModel();
    const parser = createOutputParser(executionResultSchema);
    
    const sqlQueriesStr = executedQueries.join('\n\n');
    console.log('=== QUERY RESULTS BEFORE SENDING TO LLM ===');
    console.log(JSON.stringify(stepResults, null, 2));
    console.log('=== END QUERY RESULTS ===');
    const resultsStr = JSON.stringify(stepResults, null, 2);
    
    // System message
    const systemMessage = {
      role: 'system',
      content: EXECUTION_SYSTEM_PROMPT
    };
    
    // User message
    const userMessage = {
      role: 'user',
      content: `User query: ${query}

SQL queries executed:
${sqlQueriesStr}

Query results:
${resultsStr}

Please interpret these results.`
    };
    
    // Prepare messages for the model
    const messages = [systemMessage, userMessage];
    
    const response = await model.invoke(messages);
    
    if (typeof response.content !== 'string') {
      throw new Error('LLM response content is not a string');
    }
    
    console.log(`Raw execution response: ${response.content}`);
    
    const interpretation = await parser.parse(response.content) as ExecutionOutput;
    
    // Return a structured response
    return {
      data: stepResults,
      explanation: interpretation.explanation,
      confidence: interpretation.confidence,
      sql: sqlQueriesStr,
      visualization: {
        type: interpretation.visualizationType as 'table' | 'line' | 'bar' | 'pie',
        data: stepResults,
      },
    };
  } catch (error) {
    console.error('Error in execution module:', error);
    
    // Return a fallback response
    return {
      data: {},
      explanation: 'An error occurred while executing the query plan.',
      confidence: 0.1,
    };
  }
}; 