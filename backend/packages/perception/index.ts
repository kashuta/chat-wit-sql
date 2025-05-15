import { z } from 'zod';
import { PerceptionResult, DatabaseService } from '@common/types';
import { getOpenAIModel, createOutputParser } from '@common/llm';
import { logDebug, logError, logInfo, logWarn } from '@common/logger';
import { databaseKnowledge } from '@common/knowledge';

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
      
      ${databaseKnowledge.isLoaded() ? databaseKnowledge.getDatabaseDescriptionsForLLM() : `
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
      `}
      
      IMPORTANT RULES FOR IDENTIFYING REQUIRED SERVICES:
      1. Thoroughly analyze the query to identify ALL services that might contain relevant data
      2. If the query relates to multiple topics, include ALL relevant services
      3. If the query compares or relates data across domains, include ALL necessary services
      4. Consider indirect relationships - e.g., "users who deposited and then placed bets" requires both financial-history AND bets-history
      
      Examples of multi-service queries:
      - "Show deposits made by users who placed more than 5 bets" → ["financial-history", "bets-history"]
      - "What's the average bet amount for users who deposited last week?" → ["bets-history", "financial-history"]
      - "Show login times for users with large balances" → ["user-activities", "wallet"]
      
      For SQL queries, create a proper PostgreSQL query if you're confident.
      If you can't understand the query or it's ambiguous, set confidence below 0.7.
      
      IMPORTANT: You must respond with a valid JSON object. Your response must be ONLY valid JSON without any text before or after it.
      
      The "requiredServices" field MUST be an ARRAY containing one or more of the available database services.
      
      Example response format:
      {
        "intent": "description of user intent",
        "confidence": 0.9,
        "entities": null,
        "requiredServices": ["financial-history", "bets-history"],
        "sqlQuery": "SELECT * FROM table"
      }
      
      LANGUAGE MATCHING:
      Always respond in the same language as the user's query. If the query is in Russian, analyze in Russian.
      If the query is in English, analyze in English.
      
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
    
    // Валидируем и обогащаем набор сервисов
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
  // Если список пуст, вернуть хотя бы один сервис на основе простой эвристики
  if (services.length === 0) {
    return inferServicesFromQuery(query);
  }
  
  // Преобразуем в Set для удобства работы и исключения дубликатов
  const serviceSet = new Set(services);
  const queryLower = query.toLowerCase();
  const intentLower = intent.toLowerCase();
  
  // Проверка на ситуации, когда запрос явно охватывает несколько сервисов
  
  // Кейс 1: Запрос сравнивает данные из нескольких доменов
  if (
    (queryLower.includes('deposit') || queryLower.includes('депозит')) && 
    (queryLower.includes('bet') || queryLower.includes('ставк'))
  ) {
    serviceSet.add('financial-history');
    serviceSet.add('bets-history');
  }
  
  // Кейс 2: Запрос о пользователях с определенным балансом и их активности
  if (
    (queryLower.includes('balanc') || queryLower.includes('баланс')) && 
    (queryLower.includes('activ') || queryLower.includes('активност'))
  ) {
    serviceSet.add('wallet');
    serviceSet.add('user-activities');
  }
  
  // Кейс 3: Анализ зависимости между депозитами и логинами
  if (
    (queryLower.includes('deposit') || queryLower.includes('депозит')) && 
    (queryLower.includes('login') || queryLower.includes('вход'))
  ) {
    serviceSet.add('financial-history');
    serviceSet.add('user-activities');
  }
  
  // Кейс 4: Запросы, связанные с транзакциями и балансом
  if (
    (queryLower.includes('transaction') || queryLower.includes('транзакц')) && 
    (queryLower.includes('balanc') || queryLower.includes('баланс'))
  ) {
    serviceSet.add('financial-history');
    serviceSet.add('wallet');
  }
  
  // Проверки на основе намерения (intent)
  if (intentLower.includes('compar') || intentLower.includes('сравн')) {
    // Для сравнительных запросов проверим ключевые слова
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
  
  // Проверка сущностей
  if (entities) {
    if ('user_id' in entities || 'userId' in entities) {
      // Если запрос включает конкретного пользователя, вероятно потребуются данные о его активности
      serviceSet.add('user-activities');
    }
    
    if ('timeframe' in entities || 'period' in entities) {
      // Запросы с временными периодами часто требуют несколько источников данных
      if (serviceSet.has('financial-history')) {
        // Если запрос о финансах за период, может потребоваться информация о ставках
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
  const services: Set<DatabaseService> = new Set();
  
  // Проверяем ключевые слова для определения необходимых сервисов
  if (queryLower.includes('deposit') || queryLower.includes('withdraw') || 
      queryLower.includes('transaction') || queryLower.includes('bonus') ||
      queryLower.includes('депозит') || queryLower.includes('вывод') ||
      queryLower.includes('транзакц') || queryLower.includes('бонус')) {
    services.add('financial-history');
  }
  
  if (queryLower.includes('bet') || queryLower.includes('game') || 
      queryLower.includes('win') || queryLower.includes('loss') ||
      queryLower.includes('ставк') || queryLower.includes('игр') || 
      queryLower.includes('выигр') || queryLower.includes('проигр')) {
    services.add('bets-history');
  }
  
  if (queryLower.includes('login') || queryLower.includes('session') || 
      queryLower.includes('activity') || queryLower.includes('preference') ||
      queryLower.includes('вход') || queryLower.includes('сессия') || 
      queryLower.includes('активност') || queryLower.includes('настройк')) {
    services.add('user-activities');
  }
  
  if (queryLower.includes('balance') || queryLower.includes('wallet') || 
      queryLower.includes('limit') || 
      queryLower.includes('баланс') || queryLower.includes('кошелек') || 
      queryLower.includes('лимит')) {
    services.add('wallet');
  }
  
  if (queryLower.includes('partner') || queryLower.includes('affiliate') || 
      queryLower.includes('партнер') || queryLower.includes('аффилиат')) {
    services.add('affiliate');
  }
  
  if (queryLower.includes('casino') || queryLower.includes('казино') || 
      queryLower.includes('slot') || queryLower.includes('слот')) {
    services.add('casino-st8');
  }
  
  if (queryLower.includes('location') || queryLower.includes('country') || 
      queryLower.includes('geo') || queryLower.includes('ip') ||
      queryLower.includes('локация') || queryLower.includes('страна') || 
      queryLower.includes('гео')) {
    services.add('geolocation');
  }
  
  if (queryLower.includes('kyc') || queryLower.includes('verify') || 
      queryLower.includes('document') || queryLower.includes('identification') ||
      queryLower.includes('верификац') || queryLower.includes('документ') || 
      queryLower.includes('идентификац')) {
    services.add('kyc');
  }
  
  if (queryLower.includes('notification') || queryLower.includes('message') || 
      queryLower.includes('alert') || queryLower.includes('email') || 
      queryLower.includes('sms') || queryLower.includes('push') ||
      queryLower.includes('уведомлен') || queryLower.includes('сообщен')) {
    services.add('notification');
  }
  
  if (queryLower.includes('marketing') || queryLower.includes('campaign') || 
      queryLower.includes('маркетинг') || queryLower.includes('кампани')) {
    services.add('optimove');
  }
  
  if (queryLower.includes('account') || queryLower.includes('profile') || 
      queryLower.includes('user') || queryLower.includes('setting') ||
      queryLower.includes('аккаунт') || queryLower.includes('профиль') || 
      queryLower.includes('пользовател') || queryLower.includes('настройк')) {
    services.add('pam');
  }
  
  if (queryLower.includes('payment') || queryLower.includes('method') || 
      queryLower.includes('gateway') || queryLower.includes('provider') ||
      queryLower.includes('оплат') || queryLower.includes('метод') || 
      queryLower.includes('платеж')) {
    services.add('payment-gateway');
  }
  
  if (queryLower.includes('traffic') || queryLower.includes('utm') || 
      queryLower.includes('source') || queryLower.includes('campaign') ||
      queryLower.includes('трафик') || queryLower.includes('источник')) {
    services.add('traffic');
  }
  
  // Если не смогли определить ни одного сервиса, возвращаем financial-history как наиболее общий
  if (services.size === 0) {
    services.add('financial-history');
  }
  
  return Array.from(services);
};

/**
 * Provides a fallback response when OpenAI is not available
 */
const getFallbackResponse = (query: string): PerceptionResult => {
  // Простая эвристика для определения намерения по ключевым словам
  const queryLower = query.toLowerCase();
  
  // Анализируем запрос на наличие нескольких тем
  const services = inferServicesFromQuery(query);
  
  // Определяем основное намерение на основе найденных сервисов
  let primaryIntent = 'unknown';
  let confidence = 0.5;
  let entities: Record<string, unknown> | null = null;
  let sqlQuery: string | null = null;
  
  // Создаем объект entities для хранения информации
  entities = { timeframe: 'last_week' };
  
  // Добавляем user_id, если есть упоминание конкретного пользователя
  if (queryLower.match(/user\s+(\d+)/i) || queryLower.match(/пользовател[ья]\s+(\d+)/i)) {
    const userIdMatch = queryLower.match(/user\s+(\d+)/i) || queryLower.match(/пользовател[ья]\s+(\d+)/i);
    if (userIdMatch && userIdMatch[1]) {
      entities.userId = parseInt(userIdMatch[1], 10);
    }
  }
  
  // Определяем намерение и SQL-запрос на основе комбинации сервисов
  if (services.includes('financial-history') && services.includes('bets-history')) {
    // Комбинированный запрос о депозитах и ставках
    logInfo('Fallback: Detected combined deposit and bet query');
    primaryIntent = 'get_deposit_and_bet_info';
    confidence = 0.6;
    sqlQuery = `-- Запрос к financial-history
                SELECT u.user_id, COUNT(t.id) as deposit_count, SUM(t.amount) as total_deposits
                FROM transactions t
                JOIN users u ON t.user_id = u.id
                WHERE t.type = 'deposit' 
                AND t.created_at >= NOW() - INTERVAL '7 days'
                GROUP BY u.user_id;
                
                -- Запрос к bets-history
                SELECT u.user_id, COUNT(b.id) as bet_count, SUM(b.amount) as total_bets
                FROM bets b
                JOIN users u ON b.user_id = u.id
                WHERE b.created_at >= NOW() - INTERVAL '7 days'
                GROUP BY u.user_id;`;
  }
  else if (services.includes('wallet') && services.includes('user-activities')) {
    // Комбинированный запрос о балансе и активности
    logInfo('Fallback: Detected combined wallet and activity query');
    primaryIntent = 'get_balance_and_activity_info';
    confidence = 0.6;
    sqlQuery = `-- Запрос к wallet
                SELECT w.user_id, w.current_balance, w.currency
                FROM wallets w
                WHERE w.current_balance > 0;
                
                -- Запрос к user-activities
                SELECT a.user_id, COUNT(a.id) as login_count, MAX(a.login_at) as last_login
                FROM user_sessions a
                WHERE a.login_at >= NOW() - INTERVAL '7 days'
                GROUP BY a.user_id;`;
  }
  else if (services.includes('financial-history') && services.includes('user-activities')) {
    // Комбинированный запрос о транзакциях и активности
    logInfo('Fallback: Detected combined transaction and activity query');
    primaryIntent = 'get_transaction_and_activity_info';
    confidence = 0.6;
    sqlQuery = `-- Запрос к financial-history
                SELECT t.user_id, COUNT(t.id) as transaction_count, SUM(t.amount) as total_amount
                FROM transactions t
                WHERE t.created_at >= NOW() - INTERVAL '7 days'
                GROUP BY t.user_id;
                
                -- Запрос к user-activities
                SELECT a.user_id, COUNT(a.id) as login_count
                FROM user_sessions a
                WHERE a.login_at >= NOW() - INTERVAL '7 days'
                GROUP BY a.user_id;`;
  }
  // Одиночные сервисы (предыдущая логика)
  else if (services.includes('financial-history')) {
    logInfo('Fallback: Detected deposit-related query');
    primaryIntent = 'get_deposit_info';
    confidence = 0.7;
    sqlQuery = `SELECT COUNT(*) as deposit_count, SUM(amount) as total_amount 
                FROM transactions 
                WHERE type = 'deposit' 
                AND created_at >= NOW() - INTERVAL '7 days'`;
  }
  else if (services.includes('bets-history')) {
    logInfo('Fallback: Detected bet-related query');
    primaryIntent = 'get_bet_history';
    confidence = 0.7;
    sqlQuery = `SELECT COUNT(*) as bet_count, SUM(amount) as total_amount 
                FROM bets 
                WHERE created_at >= NOW() - INTERVAL '7 days'`;
  }
  else if (services.includes('wallet')) {
    logInfo('Fallback: Detected wallet-related query');
    primaryIntent = 'get_wallet_balance';
    confidence = 0.7;
    sqlQuery = `SELECT current_balance FROM wallets WHERE user_id = :userId`;
  }
  else if (services.includes('user-activities')) {
    logInfo('Fallback: Detected user activity-related query');
    primaryIntent = 'get_user_activity';
    confidence = 0.7;
    sqlQuery = `SELECT COUNT(*) as login_count FROM user_sessions 
                WHERE login_at >= NOW() - INTERVAL '7 days'`;
  }
  else {
    // По умолчанию если не удалось определить запрос
    logInfo('Fallback: Unable to determine query intent');
    primaryIntent = 'unknown';
    confidence = 0.1;
    entities = null;
    sqlQuery = null;
  }
  
  return {
    intent: primaryIntent,
    confidence: confidence,
    entities: entities,
    requiredServices: services,
    sqlQuery: sqlQuery
  };
}; 