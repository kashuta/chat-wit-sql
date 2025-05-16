import { z } from 'zod';
import { PerceptionResult, DatabaseService } from '@common/types';
import { getOpenAIModel, createOutputParser } from '@common/llm';
import { logDebug, logError, logInfo, logWarn } from '@common/logger';
import { databaseKnowledge } from '@common/knowledge';
import { PERCEPTION_SYSTEM_PROMPT } from '../../data/prompts';

/**
 * Schema for perception output validation
 */
const perceptionSchema = z.object({
  intent: z.string().describe('The primary intent of the user query'),
  confidence: z.number().min(0).max(1).describe('Confidence score for this interpretation'),
  entities: z.record(z.unknown()).nullable().describe('Extracted entities from the query'),
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
  ).describe('Database services required to fulfill this query'),
  sqlQuery: z.string().nullable().describe('SQL query to execute, if applicable')
});

// Define the output type from the zod schema
type PerceptionOutput = z.infer<typeof perceptionSchema>;

/**
 * Gets the system prompt with database descriptions
 * @returns Complete system prompt
 */
const getSystemPrompt = (): string => {
  let systemPrompt = PERCEPTION_SYSTEM_PROMPT;
  
  // Replace placeholder with database descriptions
  systemPrompt = systemPrompt.replace('DATABASE_DESCRIPTIONS_PLACEHOLDER', 
    databaseKnowledge.isLoaded() ? databaseKnowledge.getDatabaseDescriptionsForLLM() : `
    AVAILABLE DATABASE SERVICES:
    - "wallet": Contains information about user balances, deposits, withdrawals, transactions, bonuses
    - "bets-history": Contains information about user bets, games played, winnings, losses
    - "user-activities": Contains user login history, session data, feature usage, preferences
    - "financial-history": Contains financial transactions, deposits, withdrawals, bonuses, promotions
    - "affiliate": Contains data about partnership programs and affiliate relationships
    - "casino-st8": Contains integration with the St8 casino platform
    - "geolocation": Contains information about user geographic location
    - "kyc": Contains user verification data (Know Your Customer)
    - "notification": Contains user notification settings and history
    - "optimove": Contains integration with Optimove marketing platform
    - "pam": Contains user account management data (Player Account Management)
    - "payment-gateway": Contains payment management data and methods
    - "traffic": Contains traffic tracking and analysis data
    `);
  
  return systemPrompt;
};

/**
 * Analyzes a user query and returns structured perception result
 * @param query User input query
 * @returns Perception result with query intent and metadata
 */
export const analyzeQuery = async (query: string): Promise<PerceptionResult> => {
  logInfo(`Analyzing query: "${query}"`);
  
  try {
    // Create a parser with our schema
    const parser = createOutputParser(perceptionSchema);
    
    // Check for OpenAI API key
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('sk-your')) {
      logWarn('OpenAI API key not set or invalid, using fallback implementation');
      return getFallbackResponse(query);
    }
    
    // Get the model for the request
    const model = getOpenAIModel();
    
    // System message
    const systemMessage = {
      role: 'system',
      content: getSystemPrompt()
    };
    
    // User message
    const userMessage = {
      role: 'user', 
      content: `USER QUERY: ${query}`
    };
    
    // Prepare messages for the model
    const messages = [systemMessage, userMessage];
    
    logDebug('Prompt created, formatting with query');
    
    logDebug('Calling LLM for perception analysis');
    const result = await model.invoke(messages);
    
    if (typeof result.content !== 'string') {
      logError('Unexpected LLM response format - not a string');
      throw new Error('LLM response content is not a string');
    }
    
    logDebug(`Raw LLM response: ${result.content}`);
    
    // Parse the result
    const parsed = await parser.parse(result.content) as PerceptionOutput;
    logInfo(`Query analyzed with intent: ${parsed.intent}, confidence: ${parsed.confidence}`);
    
    // Validate and enrich the set of services
    const validatedServices = validateAndEnrichRequiredServices(
      parsed.requiredServices,
      parsed.intent,
      query,
      parsed.entities
    );
    
    if (validatedServices.length !== parsed.requiredServices.length) {
      logInfo(`Enhanced required services: ${JSON.stringify(validatedServices)}`);
    }
    
    return {
      intent: parsed.intent,
      confidence: parsed.confidence,
      entities: parsed.entities,
      requiredServices: validatedServices,
      sqlQuery: parsed.sqlQuery
    };
  } catch (error) {
    logError(`Error analyzing query: ${error instanceof Error ? error.message : String(error)}`);
    logError(`Stack trace: ${error instanceof Error && error.stack ? error.stack : 'No stack trace'}`);
    
    // In case of an error, return a fallback with low confidence
    return {
      intent: 'error',
      confidence: 0.1,
      entities: null,
      requiredServices: [],
      sqlQuery: null
    };
  }
};

/**
 * Validates and enriches the list of required services based on intent and query context
 * @param services Initial list of services from LLM
 * @param intent Query intent
 * @param query Original user query
 * @param entities Extracted entities
 * @returns Enhanced list of required services
 */
const validateAndEnrichRequiredServices = (
  services: DatabaseService[],
  intent: string,
  query: string,
  entities: Record<string, unknown> | null
): DatabaseService[] => {
  // If the list is empty, return at least one service based on simple heuristics
  if (services.length === 0) {
    return inferServicesFromQuery(query);
  }
  
  // Convert to Set for easier manipulation and duplicate removal
  const serviceSet = new Set(services);
  const queryLower = query.toLowerCase();
  const intentLower = intent.toLowerCase();
  
  // Check for situations where the query explicitly covers multiple services
  
  // Case 1: Query compares data from multiple domains
  if (
    (queryLower.includes('deposit') || queryLower.includes('депозит')) && 
    (queryLower.includes('bet') || queryLower.includes('ставк'))
  ) {
    serviceSet.add('financial-history');
    serviceSet.add('bets-history');
  }
  
  // Case 2: Query about users with a specific balance and their activity
  if (
    (queryLower.includes('balanc') || queryLower.includes('баланс')) && 
    (queryLower.includes('activ') || queryLower.includes('активност'))
  ) {
    serviceSet.add('wallet');
    serviceSet.add('user-activities');
  }
  
  // Case 3: Analysis of the relationship between deposits and logins
  if (
    (queryLower.includes('deposit') || queryLower.includes('депозит')) && 
    (queryLower.includes('login') || queryLower.includes('вход'))
  ) {
    serviceSet.add('financial-history');
    serviceSet.add('user-activities');
  }
  
  // Case 4: Queries related to transactions and balance
  if (
    (queryLower.includes('transaction') || queryLower.includes('транзакц')) && 
    (queryLower.includes('balanc') || queryLower.includes('баланс'))
  ) {
    serviceSet.add('financial-history');
    serviceSet.add('wallet');
  }
  
  // Additional checks based on intent
  if (intentLower.includes('compar') || intentLower.includes('сравн')) {
    // For comparative queries, check for relevant keywords
    if (intentLower.includes('deposit') || intentLower.includes('депозит')) {
      serviceSet.add('financial-history');
    }
    if (intentLower.includes('bet') || intentLower.includes('ставк')) {
      serviceSet.add('bets-history');
    }
    if (intentLower.includes('activ') || intentLower.includes('активност')) {
      serviceSet.add('user-activities');
    }
    if (intentLower.includes('balanc') || intentLower.includes('баланс')) {
      serviceSet.add('wallet');
    }
  }
  
  // Entity checks
  if (entities) {
    if ('user_id' in entities || 'userId' in entities) {
      // If the query includes a specific user, likely required user activity data
      serviceSet.add('user-activities');
    }
    
    if ('timeframe' in entities || 'period' in entities) {
      // Queries with time periods often require multiple data sources
      if (serviceSet.has('financial-history')) {
        // If querying financial history for a period, may need bet information
        serviceSet.add('bets-history');
      }
    }
  }
  
  return Array.from(serviceSet);
};

/**
 * Infers required services based on simple query analysis when LLM fails
 * @param query User query
 * @returns List of inferred services
 */
const inferServicesFromQuery = (query: string): DatabaseService[] => {
  const queryLower = query.toLowerCase();
  const inferredServices: DatabaseService[] = [];
  
  // Basic keyword-based inference
  if (queryLower.includes('user') || queryLower.includes('пользовател')) {
    inferredServices.push('pam');
  }
  if (queryLower.includes('balance') || queryLower.includes('баланс') || queryLower.includes('wallet') || queryLower.includes('кошелек')) {
    inferredServices.push('wallet');
  }
  if (queryLower.includes('bet') || queryLower.includes('ставк')) {
    inferredServices.push('bets-history');
  }
  if (queryLower.includes('deposit') || queryLower.includes('депозит') || queryLower.includes('withdrawal') || queryLower.includes('вывод')) {
    inferredServices.push('financial-history');
  }
  if (queryLower.includes('activity') || queryLower.includes('активность') || queryLower.includes('session') || queryLower.includes('сессия')) {
    inferredServices.push('user-activities');
  }
  // Add more rules as needed...
  
  // Default to 'pam' if no other service is inferred and query mentions users
  if (inferredServices.length === 0 && (queryLower.includes('user') || queryLower.includes('пользовател'))) {
    inferredServices.push('pam');
  }
  
  // If still empty, it's hard to guess, maybe return a general service or empty
  // For now, let's return 'pam' as a last resort if users are mentioned at all.
  // Or, if truly generic, perhaps an empty array is better and let planning decide or error out.
  if (inferredServices.length === 0) {
    logWarn(`Could not infer services for query: "${query}". Returning empty service list.`);
  }
  
  // Remove duplicates by converting to Set and back to Array
  return Array.from(new Set(inferredServices));
};

/**
 * Fallback response generator when OpenAI is not available
 * @param query User query
 * @returns Fallback perception result
 */
const getFallbackResponse = (query: string): PerceptionResult => {
  const queryLower = query.toLowerCase();
  let intent = 'unknown_intent';
  let confidence = 0.5;
  let requiredServices: DatabaseService[] = [];
  let sqlQuery: string | null = null;

  // Basic intent detection based on keywords
  if (queryLower.includes('how many users') || queryLower.includes('count users') || queryLower.includes('сколько пользователей')) {
    intent = 'count_users';
    requiredServices = ['pam'];
    sqlQuery = 'SELECT COUNT(*) FROM "User"'; // Ensure quoted table name
    confidence = 0.8;
  } else if (queryLower.includes('list users') || queryLower.includes('show users') || queryLower.includes('список пользователей')) {
    intent = 'list_users';
    requiredServices = ['pam'];
    sqlQuery = 'SELECT * FROM "User" LIMIT 10'; // Ensure quoted table name
    confidence = 0.7;
  } else if (queryLower.includes('balance') || queryLower.includes('баланс')) {
    intent = 'get_balance';
    requiredServices = ['wallet'];
    // Cannot form a good SQL query without user ID here
    confidence = 0.6;
  } else if (queryLower.includes('deposit') || queryLower.includes('депозит')) {
    intent = 'get_deposits';
    requiredServices = ['financial-history'];
    confidence = 0.6;
  } else if (queryLower.includes('bet') || queryLower.includes('ставк')) {
    intent = 'get_bets';
    requiredServices = ['bets-history'];
    confidence = 0.6;
  }
  
  // Если ничего не определено, пытаемся угадать сервисы
  if (requiredServices.length === 0) {
    requiredServices = inferServicesFromQuery(query);
    if (requiredServices.length > 0) {
      confidence = 0.4; // Lower confidence as it's a guess
    } else {
      confidence = 0.2; // Very low confidence
    }
  }

  logInfo(`Using fallback perception for query "${query}": intent=${intent}, confidence=${confidence}`);
  return {
    intent,
    confidence,
    entities: null, // Fallback doesn't extract entities
    requiredServices,
    sqlQuery,
  };
}; 