/**
 * SQL assistant initialization
 */
import path from 'path';
import { logError, logInfo, logWarn } from './logger';
import { databaseKnowledge } from './knowledge';
import { resultStore } from './result-store';

/**
 * Инициализирует основные компоненты системы
 */
export const initialize = async (): Promise<void> => {
  try {
    logInfo('Initializing SQL assistant...');
    
    // Загружаем информацию о базах данных
    const dbDescriptionsPath = path.join(process.cwd(), 'data', 'database-descriptions.json');
    await databaseKnowledge.loadFromFile(dbDescriptionsPath);
    
    // Тестируем подключение к Redis
    try {
      // Проверяем, подключен ли уже Redis
      if (!resultStore.isConnected()) {
        await resultStore.connect();
        logInfo('Redis connection established for query results storage');
      } else {
        logInfo('Redis already connected for query results storage');
      }
    } catch (error) {
      logError(`Failed to connect to Redis: ${(error as Error).message}`);
      logWarn('Will use fallback in-memory storage for query results');
    }
    
    logInfo('SQL assistant initialized.');
  } catch (error) {
    logError(`Error initializing system: ${(error as Error).message}`);
    throw error;
  }
};

/**
 * Выполняет завершение работы системы
 */
export const shutdown = async (): Promise<void> => {
  try {
    logInfo('Shutting down SQL assistant...');
    
    // Закрываем соединение с Redis
    try {
      if (resultStore.isConnected()) {
        await resultStore.disconnect();
        logInfo('Redis connection closed');
      }
    } catch (error) {
      logError(`Error disconnecting from Redis: ${(error as Error).message}`);
    }
    
    logInfo('SQL assistant shut down successfully.');
  } catch (error) {
    logError(`Error during shutdown: ${(error as Error).message}`);
  }
};
