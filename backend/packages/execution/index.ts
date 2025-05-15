import { z } from 'zod';
import { QueryPlan, QueryResponse, DatabaseService, ErrorType } from '@common/types';
import { createTypedError } from '@common/utils';
import { getOpenAIModel, createOutputParser, createChatPrompt } from '@common/llm';

/**
 * Mock function to execute SQL queries (to be replaced with actual DB connection)
 * @param service - Database service to query
 * @param query - SQL query to execute
 * @returns Query results as an array of objects
 */
export const executeSqlQuery = async (
  service: DatabaseService, 
  query: string
): Promise<Record<string, unknown>[]> => {
  // This is a mock implementation
  console.log(`Executing SQL query on ${service}: ${query}`);
  
  // Return mock data based on the service
  switch (service) {
    case 'wallet':
      return [
        { userId: 1, balance: 1000, currency: 'USD' },
        { userId: 2, balance: 2500, currency: 'EUR' },
        { userId: 3, balance: 500, currency: 'USD' },
      ];
    case 'bets-history':
      return [
        { userId: 1, betAmount: 100, gameType: 'slots', timestamp: new Date().toISOString() },
        { userId: 2, betAmount: 50, gameType: 'poker', timestamp: new Date().toISOString() },
        { userId: 3, betAmount: 200, gameType: 'sports', timestamp: new Date().toISOString() },
      ];
    case 'user-activities':
      return [
        { userId: 1, action: 'login', timestamp: new Date().toISOString() },
        { userId: 2, action: 'deposit', timestamp: new Date().toISOString() },
        { userId: 3, action: 'bet', timestamp: new Date().toISOString() },
      ];
    case 'financial-history':
      return [
        { userId: 1, amount: 500, type: 'deposit', timestamp: new Date().toISOString() },
        { userId: 2, amount: 100, type: 'withdrawal', timestamp: new Date().toISOString() },
        { userId: 3, amount: 1000, type: 'deposit', timestamp: new Date().toISOString() },
      ];
    default:
      return [];
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
 * System prompt for the execution result interpretation
 */
const SYSTEM_PROMPT = `You are an AI assistant specialized in interpreting SQL query results for a sports betting and casino platform called Dante.
Your task is to analyze the query results and provide insights, explanation, and visualization recommendations.

Respond with:
- explanation: Clear explanation of the data and any insights derived
- confidence: Your confidence in the interpretation (0-1)
- visualizationType: Recommended visualization type (table, line, bar, pie)

Be concise but informative, highlighting key patterns or outliers in the data.`;

/**
 * Human prompt template for the execution module
 */
const HUMAN_PROMPT_TEMPLATE = `User query: {query}

SQL queries executed:
{sqlQueries}

Query results:
{results}

Please interpret these results.`;

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
      const result = await executeSqlQuery(step.service, step.sqlQuery);
      stepResults[step.service] = result;
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
    const prompt = createChatPrompt(SYSTEM_PROMPT, HUMAN_PROMPT_TEMPLATE);
    
    const chain = prompt.pipe(model).pipe(parser);
    
    const sqlQueriesStr = executedQueries.join('\n\n');
    const resultsStr = JSON.stringify(stepResults, null, 2);
    
    const interpretation = await chain.invoke({
      query,
      sqlQueries: sqlQueriesStr,
      results: resultsStr,
    }) as ExecutionOutput;
    
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