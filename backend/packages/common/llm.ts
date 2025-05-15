import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StructuredOutputParser } from 'langchain/output_parsers';
import { z } from 'zod';

/**
 * Creates and returns the OpenAI chat model instance
 * @returns Configured ChatOpenAI instance
 */
export const getOpenAIModel = (): ChatOpenAI => {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  
  return new ChatOpenAI({
    openAIApiKey: apiKey,
    modelName: 'gpt-4o-mini',
    temperature: 0.1, // Low temperature for deterministic outputs
  });
};

/**
 * Creates a structured output parser from a Zod schema
 * @param schema - Zod schema for output validation
 * @returns StructuredOutputParser instance
 */
export function createOutputParser<T extends z.ZodTypeAny>(
  schema: T
): StructuredOutputParser<z.infer<T>> {
  return StructuredOutputParser.fromZodSchema(schema);
}

/**
 * Creates a formatted chat prompt template
 * @param systemPrompt - System prompt text
 * @param humanPromptTemplate - Human prompt template
 * @returns ChatPromptTemplate instance
 */
export const createChatPrompt = (
  systemPrompt: string,
  humanPromptTemplate: string
): ChatPromptTemplate => {
  return ChatPromptTemplate.fromMessages([
    ['system', systemPrompt],
    ['human', humanPromptTemplate],
  ]);
}; 