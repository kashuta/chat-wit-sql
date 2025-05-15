import { z } from 'zod';
import { PerceptionResult, DatabaseService } from '@common/types';
import { getOpenAIModel, createOutputParser, createChatPrompt } from '@common/llm';

/**
 * Schema for perception output validation
 */
const perceptionSchema = z.object({
  intent: z.string().describe('The primary intent of the user query'),
  confidence: z.number().min(0).max(1).describe('Confidence score for this interpretation'),
  entities: z.record(z.unknown()).describe('Extracted entities from the query'),
  requiredServices: z.array(
    z.enum(['wallet', 'bets-history', 'user-activities', 'financial-history'] as const)
  ).describe('Database services required to answer this query'),
});

// Define the output type from the zod schema
type PerceptionOutput = z.infer<typeof perceptionSchema>;

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

Respond with:
- intent: A clear description of what the user is asking for
- confidence: Your confidence in understanding the query (0-1)
- entities: Key entities extracted from the query (dates, amounts, user IDs, etc.)
- requiredServices: Array of database services needed to answer the query

You MUST only use the available database services listed above.`;

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
  const model = getOpenAIModel();
  const parser = createOutputParser(perceptionSchema);
  const prompt = createChatPrompt(SYSTEM_PROMPT, HUMAN_PROMPT_TEMPLATE);
  
  const chain = prompt.pipe(model).pipe(parser);
  
  try {
    const result = await chain.invoke({ query }) as PerceptionOutput;
    return {
      intent: result.intent,
      confidence: result.confidence,
      entities: result.entities,
      requiredServices: result.requiredServices as DatabaseService[],
    };
  } catch (error) {
    console.error('Error in perception module:', error);
    // Return a fallback result with low confidence
    return {
      intent: 'unknown',
      confidence: 0.1,
      entities: {},
      requiredServices: [] as DatabaseService[],
    };
  }
}; 