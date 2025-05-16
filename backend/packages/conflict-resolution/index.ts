import { ConflictDetector, TableConflict, ConflictDetectionResult } from './conflict-detector';
import { ConflictDetectionChain, ConflictDetectionInput, ConflictDetectionOutput } from './conflict-detection-chain';
import { QueryPlan } from '@common/types';
import { logInfo, logWarn } from '@common/logger';

/**
 * Проверяет план запроса на наличие конфликтов между таблицами
 * @param plan План запроса
 * @returns Результат проверки на конфликты
 */
export const detectConflictsInPlan = async (
  plan: QueryPlan,
  _query: string // Переименовываем параметр с префиксом _, чтобы показать что он не используется
): Promise<ConflictDetectionResult> => {
  try {
    const detector = new ConflictDetector();
    const result = detector.detectPlanConflicts(plan);
    
    if (result.hasConflicts) {
      logWarn(`Detected ${result.conflicts.length} table conflicts in the query plan with probability ${result.errorProbability}`);
    } else {
      logInfo('No conflicts detected in the query plan');
    }
    
    return result;
  } catch (error) {
    logWarn(`Error detecting conflicts: ${(error as Error).message}`);
    // Возвращаем пустой результат в случае ошибки
    return {
      conflicts: [],
      hasConflicts: false,
      errorProbability: 'low'
    };
  }
}

/**
 * Разрешает конфликты в плане запроса с использованием LLM
 * @param plan План запроса
 * @param query Исходный запрос пользователя
 * @param verbose Подробное логирование
 * @returns Исправленный план и информация о конфликтах
 */
export const resolveConflictsInPlan = async (
  plan: QueryPlan,
  query: string,
  verbose: boolean = false
): Promise<ConflictDetectionOutput> => {
  try {
    const chain = new ConflictDetectionChain({ verbose });
    const result = await chain.run({ plan, query });
    
    if (result.amended) {
      logInfo('Successfully resolved conflicts in the query plan');
    } else {
      logInfo('No changes were made to the query plan');
    }
    
    return result;
  } catch (error) {
    logWarn(`Error resolving conflicts: ${(error as Error).message}`);
    // Возвращаем исходный план в случае ошибки
    return {
      resolvedPlan: plan,
      conflicts: [],
      amended: false
    };
  }
}

// Экспортируем типы и классы
export { 
  ConflictDetector, 
  TableConflict, 
  ConflictDetectionResult,
  ConflictDetectionChain,
  ConflictDetectionInput,
  ConflictDetectionOutput
};