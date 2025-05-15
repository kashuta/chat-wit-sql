import { z } from 'zod';
import { PerceptionResult, DatabaseService } from '@common/types';
import { getOpenAIModel, createOutputParser } from '@common/llm';
import { logDebug, logError, logInfo, logWarn } from '@common/logger';

/**
 * Schema for perception output validation
 */
const perceptionSchema = z.object({
  intent: z.string().describe('The primary intent of the user query'),
  confidence: z.number().min(0).max(1).describe('Confidence score for this interpretation'),
  entities: z.record(z.unknown()).nullable().describe('Extracted entities from the query'),
  requiredServices: z.array(
    z.enum(['wallet', 'bets-history', 'user-activities', 'financial-history'] as const)
  ).describe('Database services required to fulfill this query'),
  sqlQuery: z.string().nullable().describe('SQL query to execute, if applicable')
});

// Define the output type from the zod schema
type PerceptionOutput = z.infer<typeof perceptionSchema>;

/**
 * Analyzes a user query and returns structured perception result
 * @param query User input query
 * @returns Perception result with query intent and metadata
 */
export const analyzeQuery = async (query: string): Promise<PerceptionResult> => {
  logInfo(`Analyzing query: "${query}"`);
  
  try {
    // Создаем parser с нашей схемой
    const parser = createOutputParser(perceptionSchema);
    
    // Проверяем наличие ключа API для OpenAI
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('sk-your')) {
      logWarn('OpenAI API key not set or invalid, using fallback implementation');
      return getFallbackResponse(query);
    }
    
    // Получаем модель для запроса
    const model = getOpenAIModel();
    
    // Системное сообщение
    const systemMessage = {
      role: 'system',
      content: `You are a query analyzer for a betting platform SQL assistant.
      Analyze the user query and determine its intent, confidence, and required database services.
      If the query is about financial transactions (deposits, withdrawals), return financial-history.
      If the query is about bets, return bets-history.
      If the query is about user activities, return user-activities.
      If the query is about wallet balances, return wallet.
      
      For SQL queries, create a proper PostgreSQL query if you're confident.
      If you can't understand the query or it's ambiguous, set low confidence.
      
      IMPORTANT: You must respond with a valid JSON object. Your response must be ONLY valid JSON without any text before or after it.
      
      The "requiredServices" field MUST be an ARRAY containing one or more of these exact strings:
      - "wallet"
      - "bets-history"
      - "user-activities"
      - "financial-history"
      
      Example response format:
      {
        "intent": "description of user intent",
        "confidence": 0.9,
        "entities": null,
        "requiredServices": ["financial-history"],
        "sqlQuery": "SELECT * FROM table"
      }
      
      For example, if the query needs financial-history service, make sure requiredServices is an array like ["financial-history"], NOT just "financial-history".
      
      Remove any markdown code block markers in your response. Return only a valid JSON object.`
    };
    
    // Пользовательское сообщение
    const userMessage = {
      role: 'user', 
      content: `USER QUERY: ${query}`
    };
    
    // Формируем сообщения для модели
    const messages = [systemMessage, userMessage];
    
    logDebug('Prompt created, formatting with query');
    
    logDebug('Calling LLM for perception analysis');
    const result = await model.invoke(messages);
    
    if (typeof result.content !== 'string') {
      logError('Unexpected LLM response format - not a string');
      throw new Error('LLM response content is not a string');
    }
    
    logDebug(`Raw LLM response: ${result.content}`);
    
    // Парсим результат
    const parsed = await parser.parse(result.content) as PerceptionOutput;
    logInfo(`Query analyzed with intent: ${parsed.intent}, confidence: ${parsed.confidence}`);
    
    return {
      intent: parsed.intent,
      confidence: parsed.confidence,
      entities: parsed.entities,
      requiredServices: parsed.requiredServices as DatabaseService[],
      sqlQuery: parsed.sqlQuery
    };
  } catch (error) {
    logError(`Error analyzing query: ${error instanceof Error ? error.message : String(error)}`);
    logError(`Stack trace: ${error instanceof Error && error.stack ? error.stack : 'No stack trace'}`);
    
    // В случае ошибки возвращаем fallback с низкой уверенностью
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
 * Provides a fallback response when OpenAI is not available
 */
const getFallbackResponse = (query: string): PerceptionResult => {
  // Простая эвристика для определения намерения по ключевым словам
  const queryLower = query.toLowerCase();
  
  // Обработка запросов о депозитах
  if (queryLower.includes('deposit') || queryLower.includes('deposits') || 
      queryLower.includes('депозит') || queryLower.includes('пополнение')) {
    logInfo('Fallback: Detected deposit-related query');
    return {
      intent: 'get_deposit_info',
      confidence: 0.7,
      entities: { timeframe: 'last_week' },
      requiredServices: ['financial-history'],
      sqlQuery: `SELECT COUNT(*) as deposit_count, SUM(amount) as total_amount 
                FROM transactions 
                WHERE type = 'deposit' 
                AND created_at >= NOW() - INTERVAL '7 days'`
    };
  }
  
  // Обработка запросов о ставках
  if (queryLower.includes('bet') || queryLower.includes('bets') || 
      queryLower.includes('ставка') || queryLower.includes('ставки')) {
    logInfo('Fallback: Detected bet-related query');
    return {
      intent: 'get_bet_history',
      confidence: 0.7,
      entities: { timeframe: 'last_week' },
      requiredServices: ['bets-history'],
      sqlQuery: `SELECT COUNT(*) as bet_count, SUM(amount) as total_amount 
                FROM bets 
                WHERE created_at >= NOW() - INTERVAL '7 days'`
    };
  }
  
  // Обработка запросов о балансе
  if (queryLower.includes('balance') || queryLower.includes('wallet') || 
      queryLower.includes('баланс') || queryLower.includes('кошелек')) {
    logInfo('Fallback: Detected wallet-related query');
    return {
      intent: 'get_wallet_balance',
      confidence: 0.7,
      entities: null,
      requiredServices: ['wallet'],
      sqlQuery: `SELECT current_balance FROM wallets WHERE user_id = :userId`
    };
  }
  
  // Обработка запросов о пользовательской активности
  if (queryLower.includes('user') || queryLower.includes('activity') || 
      queryLower.includes('пользователь') || queryLower.includes('активность')) {
    logInfo('Fallback: Detected user activity-related query');
    return {
      intent: 'get_user_activity',
      confidence: 0.7,
      entities: { timeframe: 'last_week' },
      requiredServices: ['user-activities'],
      sqlQuery: `SELECT COUNT(*) as login_count FROM user_sessions 
                WHERE login_at >= NOW() - INTERVAL '7 days'`
    };
  }
  
  // По умолчанию если не удалось определить запрос
  logInfo('Fallback: Unable to determine query intent');
  return {
    intent: 'unknown',
    confidence: 0.1,
    entities: null,
    requiredServices: [],
    sqlQuery: null
  };
}; 