import { z } from 'zod';
import { PerceptionResult, DatabaseService } from '@common/types';
import { getOpenAIModel, createOutputParser, createChatPrompt } from '@common/llm';
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
  ).describe('Database services required to answer this query'),
});

// Define the output type from the zod schema
type PerceptionOutput = z.infer<typeof perceptionSchema>;

// Тип для ошибки парсинга вывода
interface OutputParserError extends Error {
  name: string;
  llmOutput?: string;
}

/**
 * System prompt for the perception module
 */
const SYSTEM_PROMPT = `You are an AI assistant specialized in understanding user queries about a sports betting and casino platform called Dante.
Your task is to analyze the user's question, understand their intent, extract relevant entities, and determine which database services are needed.

Available database services:
- wallet: Contains information about user balances, deposits, withdrawals
- bets-history: Contains information about user bets, games played, winnings
- user-activities: Contains user login history, session data, feature usage
- financial-history: Contains financial transactions, bonuses, promotions

IMPORTANT: You must respond with VALID JSON in the following format:
{
  "intent": "A clear description of what the user is asking for",
  "confidence": 0.9,
  "entities": null,
  "requiredServices": ["wallet"]
}

You MUST only use the available database services listed above.
If there are no entities, set the value to null, not an empty object.
The confidence should be a number between 0 and 1.
Make sure your JSON is properly formatted with quotes around property names.`;

/**
 * Human prompt template for the perception module
 */
const HUMAN_PROMPT_TEMPLATE = `User query: {query}

Please analyze this query.`;

/**
 * Analyzes a user query to understand intent and required data sources
 * @param query - User query string
 * @returns Perception analysis result
 */
export const analyzeQuery = async (query: string): Promise<PerceptionResult> => {
  logInfo(`Анализ запроса пользователя: "${query}"`);
  
  const model = getOpenAIModel();
  const parser = createOutputParser(perceptionSchema);
  const prompt = createChatPrompt(SYSTEM_PROMPT, HUMAN_PROMPT_TEMPLATE);
  
  logDebug('Запуск цепочки обработки для восприятия запроса');
  const chain = prompt.pipe(model).pipe(parser);
  
  try {
    logDebug('Вызов модели для анализа запроса');
    const result = await chain.invoke({ query }) as PerceptionOutput;
    
    logInfo(`Запрос успешно проанализирован. Намерение: "${result.intent}", уверенность: ${result.confidence}`);
    logDebug(`Необходимые сервисы: ${result.requiredServices.join(', ') || 'отсутствуют'}`);
    
    return {
      intent: result.intent,
      confidence: result.confidence,
      entities: result.entities || {},
      requiredServices: result.requiredServices as DatabaseService[],
    };
  } catch (error: unknown) {
    logError('Ошибка в модуле восприятия (perception):', error);
    
    // Если ошибка связана с парсингом вывода, попробуем извлечь оригинальный текст
    const parserError = error as OutputParserError;
    if (parserError.name === 'OutputParserException' && parserError.llmOutput) {
      logError(`Не удалось распарсить вывод модели: ${parserError.llmOutput}`);
    }
    
    // Return a fallback result with low confidence
    logWarn('Возвращаем резервный результат с низкой уверенностью');
    return {
      intent: 'unknown',
      confidence: 0.1,
      entities: {},
      requiredServices: [] as DatabaseService[],
    };
  }
}; 