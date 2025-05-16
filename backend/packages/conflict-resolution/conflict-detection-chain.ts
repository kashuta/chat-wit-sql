import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from '@langchain/core/prompts';
import { getOpenAIModel } from '@common/llm';
import { databaseKnowledge } from '@common/knowledge';
import { logDebug, logInfo, logWarn } from '@common/logger';
import { QueryPlan } from '@common/types';
import { ConflictDetector, TableConflict } from './conflict-detector';

export interface ConflictDetectionInput {
  verbose?: boolean;
  plan: QueryPlan;
  query: string;
}

export interface ConflictDetectionOutput {
  resolvedPlan: QueryPlan;
  conflicts: TableConflict[];
  amended: boolean;
}

/**
 * Цепочка для обнаружения и разрешения конфликтов между таблицами
 * Использует функциональный подход вместо наследования от BaseChain
 */
export class ConflictDetectionChain {
  private conflictDetector: ConflictDetector;
  private verbose: boolean;

  constructor(options: { verbose?: boolean } = {}) {
    this.conflictDetector = new ConflictDetector();
    this.verbose = options.verbose ?? false;
  }

  /**
   * Выполняет обнаружение и разрешение конфликтов в плане запроса
   * @param inputs Входные данные (план и запрос)
   * @returns Результат обработки
   */
  async run(inputs: ConflictDetectionInput): Promise<ConflictDetectionOutput> {
    const { plan, query } = inputs;

    if (!plan) {
      throw new Error('Plan is required for conflict detection');
    }

    logInfo('Starting conflict detection for plan');
    if (this.verbose) {
      logDebug(`Original plan: ${JSON.stringify(plan, null, 2)}`);
    }

    // Обнаруживаем конфликты в плане
    const detectionResult = this.conflictDetector.detectPlanConflicts(plan);

    if (!detectionResult.hasConflicts) {
      logInfo('No conflicts detected in the plan');
      return {
        resolvedPlan: plan,
        conflicts: [],
        amended: false
      };
    }

    logWarn(`Detected ${detectionResult.conflicts.length} table conflicts with probability ${detectionResult.errorProbability}`);
    
    if (this.verbose && detectionResult.suggestedResolution) {
      logDebug(`Suggested resolution: ${detectionResult.suggestedResolution}`);
    }

    // Если вероятность ошибки низкая, просто возвращаем исходный план с информацией о конфликтах
    if (detectionResult.errorProbability === 'low') {
      return {
        resolvedPlan: plan,
        conflicts: detectionResult.conflicts,
        amended: false
      };
    }

    // Для высокой или средней вероятности пытаемся разрешить конфликты
    const resolvedPlan = await this.resolveConflictsWithLLM(
      plan,
      query,
      detectionResult.conflicts
    );

    return {
      resolvedPlan,
      conflicts: detectionResult.conflicts,
      amended: JSON.stringify(resolvedPlan) !== JSON.stringify(plan)
    };
  }

  /**
   * Использует LLM для разрешения конфликтов в плане
   * @param plan Исходный план
   * @param query Исходный запрос
   * @param conflicts Обнаруженные конфликты
   * @returns Исправленный план
   */
  private async resolveConflictsWithLLM(
    plan: QueryPlan,
    query: string,
    conflicts: TableConflict[]
  ): Promise<QueryPlan> {
    const model = getOpenAIModel();

    logInfo('Attempting to resolve conflicts using LLM');

    // Создаем промпт для LLM
    const systemTemplate = `Вы - эксперт по разрешению конфликтов в распределенных SQL-запросах.
Ваша задача - проанализировать план запроса и исправить его, учитывая обнаруженные конфликты таблиц.

ОПИСАНИЕ БАЗ ДАННЫХ:
${databaseKnowledge.getDetailedDatabaseDescriptionsForLLM()}

ПРАВИЛА РАЗРЕШЕНИЯ КОНФЛИКТОВ:
1. Если таблица существует в нескольких сервисах, нужно выбрать наиболее подходящий сервис на основе контекста запроса.
2. Измените атрибуты service в шагах плана и убедитесь, что они соответствуют правильным сервисам.
3. Не меняйте сам текст SQL-запросов, только атрибуты service.
4. Если невозможно однозначно определить правильный сервис, используйте первый из конфликтующих.

Ваш ответ должен содержать исправленный план запроса в JSON-формате.`;

    const humanTemplate = `Запрос пользователя: {query}

Исходный план запроса:
{plan}

Обнаруженные конфликты:
{conflicts}

Пожалуйста, разрешите конфликты в плане и предоставьте исправленный план.`;

    const chatPrompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(systemTemplate),
      HumanMessagePromptTemplate.fromTemplate(humanTemplate)
    ]);

    const formattedPrompt = await chatPrompt.formatMessages({
      query,
      plan: JSON.stringify(plan, null, 2),
      conflicts: this.formatConflictsForPrompt(conflicts)
    });

    const response = await model.invoke(formattedPrompt);
    const content = response.content as string;

    logDebug('Received response from LLM for conflict resolution');

    // Извлекаем JSON из ответа
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || 
                      content.match(/```\n([\s\S]*?)\n```/) ||
                      content.match(/{[\s\S]*}/);
                      
    if (!jsonMatch) {
      logWarn('Could not extract JSON from LLM response, returning original plan');
      if (this.verbose) {
        logDebug(`Raw LLM response: ${content}`);
      }
      return plan;
    }

    try {
      const jsonContent = jsonMatch[1] || jsonMatch[0];
      const resolvedPlan = JSON.parse(jsonContent) as QueryPlan;
      
      logInfo('Successfully resolved conflicts in the plan');
      if (this.verbose) {
        logDebug(`Resolved plan: ${JSON.stringify(resolvedPlan, null, 2)}`);
      }
      
      return resolvedPlan;
    } catch (e) {
      logWarn(`Error parsing LLM response as QueryPlan: ${e}`);
      return plan;
    }
  }

  /**
   * Форматирует информацию о конфликтах для включения в промпт
   * @param conflicts Массив конфликтов
   * @returns Строка с информацией о конфликтах
   */
  private formatConflictsForPrompt(conflicts: TableConflict[]): string {
    let result = '';
    
    for (const conflict of conflicts) {
      result += `Таблица "${conflict.tableName}" найдена в нескольких сервисах: ${conflict.services.join(', ')}\n`;
      
      // Добавляем информацию о схеме таблицы в каждом сервисе
      for (const service of conflict.services) {
        const schema = conflict.schemas[service];
        if (schema) {
          result += `- В сервисе "${service}" таблица описана как: "${schema.description}"\n`;
          result += `  Колонки: ${schema.columns.map(col => col.name).join(', ')}\n`;
        }
      }
      
      result += '\n';
    }
    
    return result;
  }

  /**
   * Строит карту разрешения конфликтов
   * @param conflicts Массив конфликтов
   * @returns Карта разрешения конфликтов (таблица -> рекомендуемый сервис)
   */
  async buildResolutionMap(conflicts: TableConflict[]): Promise<Map<string, string>> {
    const resolutionMap = new Map<string, string>();
    
    // Простая реализация: используем первый сервис в списке
    for (const conflict of conflicts) {
      resolutionMap.set(conflict.tableName, conflict.services[0]);
    }
    
    return resolutionMap;
  }
} 