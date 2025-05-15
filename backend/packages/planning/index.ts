import { z } from 'zod';
import { QueryPlan, DatabaseService, PerceptionResult } from '@common/types';
import { getOpenAIModel, createOutputParser } from '@common/llm';
import { databaseKnowledge } from '@common/knowledge';

/**
 * Schema for query plan output validation
 */
const queryPlanSchema = z.object({
  steps: z.array(
    z.object({
      service: z.enum([
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
      ] as const),
      description: z.string(),
      sqlQuery: z.string().optional(),
    })
  ).describe('Steps to execute to answer the query'),
  requiredServices: z.array(
    z.enum([
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
    ] as const)
  ).describe('Database services required to answer this query'),
});

// Define the output type from the zod schema
type PlanningOutput = z.infer<typeof queryPlanSchema>;

/**
 * System prompt for the planning module
 */
const getSystemPrompt = (): string => {
  const basePrompt = `You are an AI assistant specialized in planning SQL queries for a sports betting and casino platform called Dante.
Your task is to plan the steps needed to answer the user's query efficiently.

${databaseKnowledge.isLoaded() ? databaseKnowledge.getDetailedDatabaseDescriptionsForLLM() : `
Available database services:
- wallet: Contains information about user balances, deposits, withdrawals, transactions, bonuses
- bets-history: Contains information about user bets, games played, winnings, losses
- user-activities: Contains user login history, session data, feature usage, preferences
- financial-history: Contains financial transactions, deposits, withdrawals, bonuses, promotions
- affiliate: Contains data about partnership programs and affiliate relationships
- casino-st8: Contains integration with the St8 casino platform
- geolocation: Contains information about user geographic location
- kyc: Contains user verification data (Know Your Customer)
- notification: Contains user notification settings and history
- optimove: Contains integration with Optimove marketing platform
- pam: Contains user account management data (Player Account Management)
- payment-gateway: Contains payment management data and methods
- traffic: Contains traffic tracking and analysis data
`}

For each service, you need to specify:
1. Which service to query
2. A description of what information to retrieve from that service
3. Optionally, a draft SQL query to use (this will be refined later)

Respond with:
- steps: Array of steps to execute
- requiredServices: Array of database services needed (should match the services in steps)

You MUST only use the available database services listed above.

IMPORTANT: You must respond with a valid JSON object. Your response must be ONLY valid JSON without any text before or after it.
Example response format:
{
  "steps": [
    {
      "service": "financial-history",
      "description": "Count deposits made in the last week",
      "sqlQuery": "SELECT COUNT(*) FROM deposits WHERE deposit_date >= NOW() - INTERVAL '7 days'"
    }
  ],
  "requiredServices": ["financial-history"]
}`;

  return basePrompt;
};

/**
 * Creates a query plan based on the perception result
 * @param perceptionResult - Result from the perception module
 * @param query - Original user query
 * @returns Query plan
 */
export const createQueryPlan = async (
  perceptionResult: PerceptionResult,
  query: string
): Promise<QueryPlan> => {
  const model = getOpenAIModel();
  const parser = createOutputParser(queryPlanSchema);
  
  try {
    const { intent, entities, requiredServices } = perceptionResult;
    const entitiesStr = JSON.stringify(entities);
    const servicesStr = JSON.stringify(requiredServices);
    
    // Системное сообщение
    const systemMessage = {
      role: 'system',
      content: getSystemPrompt()
    };
    
    // Пользовательское сообщение
    const userMessage = {
      role: 'user',
      content: `User query: ${query}

Intent analysis: ${intent}
Required services from perception: ${servicesStr}
Extracted entities: ${entitiesStr}

Please create a plan to answer this query.`
    };
    
    // Формируем сообщения для модели
    const messages = [systemMessage, userMessage];
    
    const response = await model.invoke(messages);
    
    if (typeof response.content !== 'string') {
      throw new Error('LLM response content is not a string');
    }
    
    console.log(`Raw planning response: ${response.content}`);
    
    const result = await parser.parse(response.content) as PlanningOutput;

    return {
      steps: result.steps.map(step => ({
        service: step.service as DatabaseService,
        description: step.description,
        sqlQuery: step.sqlQuery,
      })),
      requiredServices: result.requiredServices as DatabaseService[],
    };
  } catch (error) {
    console.error('Error in planning module:', error);
    // Return a fallback plan with basic information retrieval
    return {
      steps: perceptionResult.requiredServices.map(service => {
        let defaultQuery: string;
        
        // Дефолтные запросы для каждого сервиса
        switch(service) {
          case 'wallet':
            defaultQuery = 'SELECT * FROM wallets LIMIT 10';
            break;
          case 'bets-history':
            defaultQuery = 'SELECT * FROM bets LIMIT 10';
            break;
          case 'user-activities':
            defaultQuery = 'SELECT * FROM activities LIMIT 10';
            break;
          case 'financial-history':
            defaultQuery = 'SELECT * FROM transactions LIMIT 10';
            break;
          default:
            defaultQuery = 'SELECT 1';
        }
        
        return {
          service,
          description: `Retrieve basic information from ${service}`,
          sqlQuery: defaultQuery
        };
      }),
      requiredServices: perceptionResult.requiredServices,
    };
  }
}; 