import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from '@langchain/core/prompts';
import { StructuredOutputParser } from 'langchain/output_parsers';
import { z } from 'zod';
import { logDebug, logError, logInfo } from './logger';
import { MESSAGE_TEMPLATES } from '../../data/prompts';

/**
 * Creates and returns the OpenAI chat model instance
 * @returns Configured ChatOpenAI instance
 */
export const getOpenAIModel = (): ChatOpenAI => {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelName = process.env.OPENAI_MODEL_NAME || 'gpt-4o-mini';
  const temperature = parseFloat(process.env.OPENAI_TEMPERATURE || '0.1');
  
  if (!apiKey) {
    const errorMsg = MESSAGE_TEMPLATES.error.openAIKeyRequired;
    logError(errorMsg);
    throw new Error(errorMsg);
  }
  
  logInfo(MESSAGE_TEMPLATES.info.initializingModel
    .replace('{model}', modelName)
    .replace('{temperature}', temperature.toString()));
  
  return new ChatOpenAI({
    openAIApiKey: apiKey,
    modelName,
    temperature,
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
  logDebug('Creating structured output parser');
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
  logDebug('Creating chat prompt template');
  logDebug(MESSAGE_TEMPLATES.debug.systemPromptFirst100
    .replace('{text}', systemPrompt.substring(0, 100)));
  
  // Check for expressions in curly braces in the template
  const variableMatches = humanPromptTemplate.match(/{([^}]+)}/g);
  const inputVariables: string[] = [];
  
  if (variableMatches) {
    // Extract variable names without the braces
    for (const match of variableMatches) {
      const varName = match.slice(1, -1).trim();
      inputVariables.push(varName);
      logDebug(MESSAGE_TEMPLATES.debug.variableFound.replace('{varName}', varName));
    }
  }
  
  try {
    // Create message templates
    const systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(systemPrompt);
    const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(humanPromptTemplate);
    
    // Explicitly define the input variables to avoid errors
    logDebug(MESSAGE_TEMPLATES.debug.chatTemplateCreation
      .replace('{variables}', inputVariables.join(', ') || 'no variables'));
    const chatPrompt = ChatPromptTemplate.fromMessages([
      systemMessagePrompt,
      humanMessagePrompt,
    ]);
    
    return chatPrompt;
  } catch (error) {
    logError(MESSAGE_TEMPLATES.error.promptCreationError, error);
    if (error instanceof Error) {
      logError(MESSAGE_TEMPLATES.error.errorMessage.replace('{message}', error.message));
      if (error.stack) {
        logDebug(MESSAGE_TEMPLATES.debug.errorStack.replace('{stack}', error.stack));
      }
    }
    
    // Creating a simple fallback template
    logDebug(MESSAGE_TEMPLATES.debug.creatingBackupTemplate);
    return ChatPromptTemplate.fromTemplate(`${systemPrompt}\n\n${humanPromptTemplate}`);
  }
}; 