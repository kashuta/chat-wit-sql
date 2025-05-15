import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from '@langchain/core/prompts';
import { StructuredOutputParser } from 'langchain/output_parsers';
import { z } from 'zod';
import { logDebug, logError, logInfo } from './logger';

/**
 * Creates and returns the OpenAI chat model instance
 * @returns Configured ChatOpenAI instance
 */
export const getOpenAIModel = (): ChatOpenAI => {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelName = process.env.OPENAI_MODEL_NAME || 'gpt-4o-mini';
  const temperature = parseFloat(process.env.OPENAI_TEMPERATURE || '0.1');
  
  if (!apiKey) {
    const errorMsg = 'OPENAI_API_KEY переменная окружения обязательна';
    logError(errorMsg);
    throw new Error(errorMsg);
  }
  
  logInfo(`Инициализация модели OpenAI: ${modelName}, температура: ${temperature}`);
  
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
  logDebug('Создание парсера структурированного вывода');
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
  logDebug('Создание шаблона промпта для чата');
  logDebug(`Системный промпт (первые 100 символов): ${systemPrompt.substring(0, 100)}...`);
  
  // Проверка наличия выражений внутри фигурных скобок в шаблоне
  const variableMatches = humanPromptTemplate.match(/{([^}]+)}/g);
  const inputVariables: string[] = [];
  
  if (variableMatches) {
    // Extract variable names without the braces
    for (const match of variableMatches) {
      const varName = match.slice(1, -1).trim();
      inputVariables.push(varName);
      logDebug(`Найдена переменная в шаблоне: ${varName}`);
    }
  }
  
  try {
    // Создаем шаблоны сообщений
    const systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(systemPrompt);
    const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(humanPromptTemplate);
    
    // Explicitly define the input variables to avoid errors
    logDebug(`Создание шаблона чата с переменными: ${inputVariables.join(', ') || 'нет переменных'}`);
    const chatPrompt = ChatPromptTemplate.fromMessages([
      systemMessagePrompt,
      humanMessagePrompt,
    ]);
    
    return chatPrompt;
  } catch (error) {
    logError('Ошибка при создании шаблона промпта:', error);
    if (error instanceof Error) {
      logError(`Сообщение ошибки: ${error.message}`);
      if (error.stack) {
        logDebug(`Стек ошибки: ${error.stack}`);
      }
    }
    
    // Creating a simple fallback template
    logDebug('Создание простого резервного шаблона');
    return ChatPromptTemplate.fromTemplate(`${systemPrompt}\n\n${humanPromptTemplate}`);
  }
}; 