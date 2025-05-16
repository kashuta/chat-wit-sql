import { createClient, RedisClientType } from 'redis';
import { logDebug, logError, logInfo } from './logger';

/**
 * Интерфейс для хранилища результатов запросов
 */
export interface QueryResultStoreInterface {
  /**
   * Сохраняет результаты запроса по указанному ключу
   */
  store(key: string, results: Record<string, unknown>[]): Promise<void>;
  
  /**
   * Получает результаты запроса по ключу
   */
  get(key: string): Promise<Record<string, unknown>[]>;
  
  /**
   * Проверяет существование результатов по ключу
   */
  exists(key: string): Promise<boolean>;
  
  /**
   * Объединяет результаты двух запросов по указанному полю
   */
  joinResults(key1: string, key2: string, joinField: string): Promise<Record<string, unknown>[]>;
  
  /**
   * Очищает все временные данные запроса
   */
  clear(queryId: string): Promise<void>;
  
  /**
   * Инициализирует соединение с хранилищем
   */
  connect(): Promise<void>;
  
  /**
   * Закрывает соединение с хранилищем
   */
  disconnect(): Promise<void>;
}

/**
 * Реализация хранилища результатов на базе Redis
 */
export class RedisQueryResultStore implements QueryResultStoreInterface {
  private client: RedisClientType;
  private readonly keyPrefix = 'sql-query-result:';
  private readonly expirationTime = 60 * 30; // 30 минут
  
  constructor(url: string = 'redis://localhost:6379') {
    this.client = createClient({ url });
    
    this.client.on('error', (err) => {
      logError(`Redis Client Error: ${err.message}`);
    });
    
    this.client.on('connect', () => {
      logInfo('Connected to Redis');
    });
  }
  
  /**
   * Подключение к Redis
   */
  async connect(): Promise<void> {
    try {
      await this.client.connect();
      logInfo('Redis result store connected');
    } catch (error) {
      logError(`Failed to connect to Redis: ${(error as Error).message}`);
      throw error;
    }
  }
  
  /**
   * Отключение от Redis
   */
  async disconnect(): Promise<void> {
    await this.client.disconnect();
    logInfo('Redis result store disconnected');
  }
  
  /**
   * Формирует полный ключ с префиксом
   */
  private getFullKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
  
  /**
   * Сохраняет результаты запроса в Redis
   */
  async store(key: string, results: Record<string, unknown>[]): Promise<void> {
    const fullKey = this.getFullKey(key);
    
    try {
      // Сериализуем результаты в JSON
      const serialized = JSON.stringify(results);
      
      // Сохраняем с временем жизни
      await this.client.set(fullKey, serialized, { EX: this.expirationTime });
      
      logDebug(`Stored results for key ${key} (${results.length} rows)`);
    } catch (error) {
      logError(`Failed to store results for key ${key}: ${(error as Error).message}`);
      throw error;
    }
  }
  
  /**
   * Получает результаты запроса из Redis
   */
  async get(key: string): Promise<Record<string, unknown>[]> {
    const fullKey = this.getFullKey(key);
    
    try {
      const data = await this.client.get(fullKey);
      
      if (!data) {
        logDebug(`No data found for key ${key}`);
        return [];
      }
      
      // Десериализуем JSON
      const results = JSON.parse(data) as Record<string, unknown>[];
      logDebug(`Retrieved results for key ${key} (${results.length} rows)`);
      
      return results;
    } catch (error) {
      logError(`Failed to get results for key ${key}: ${(error as Error).message}`);
      return [];
    }
  }
  
  /**
   * Проверяет существование результатов по ключу
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    
    try {
      const exists = await this.client.exists(fullKey);
      return exists === 1;
    } catch (error) {
      logError(`Failed to check existence for key ${key}: ${(error as Error).message}`);
      return false;
    }
  }
  
  /**
   * Объединяет результаты двух запросов по указанному полю (аналог SQL JOIN)
   */
  async joinResults(
    key1: string, 
    key2: string, 
    joinField: string
  ): Promise<Record<string, unknown>[]> {
    const results1 = await this.get(key1);
    const results2 = await this.get(key2);
    
    if (results1.length === 0 || results2.length === 0) {
      logDebug(`Cannot join results: one of the datasets is empty (${key1}: ${results1.length}, ${key2}: ${results2.length})`);
      return [];
    }
    
    try {
      const joinedResults: Record<string, unknown>[] = [];
      
      // Создаем "lookup" таблицу для более эффективного поиска
      const lookup = new Map<string, Record<string, unknown>[]>();
      
      // Заполняем lookup таблицу из второго набора данных
      for (const item of results2) {
        const joinValue = String(item[joinField] || '');
        
        if (!joinValue) continue;
        
        if (!lookup.has(joinValue)) {
          lookup.set(joinValue, []);
        }
        
        lookup.get(joinValue)?.push(item);
      }
      
      // Выполняем объединение
      for (const item1 of results1) {
        const joinValue = String(item1[joinField] || '');
        
        if (!joinValue || !lookup.has(joinValue)) continue;
        
        const matchingItems = lookup.get(joinValue) || [];
        
        for (const item2 of matchingItems) {
          // Объединяем два объекта, добавляя префиксы для предотвращения коллизий имен полей
          const joinedItem: Record<string, unknown> = {
            ...item1,
            ...Object.entries(item2).reduce((acc, [key, value]) => {
              // Если поле joinField, то оставляем без изменений для избежания дублирования
              if (key === joinField) {
                return acc;
              }
              
              // Добавляем префикс только если поле уже существует в первом объекте
              const newKey = item1[key] !== undefined ? `${key2}_${key}` : key;
              acc[newKey] = value;
              return acc;
            }, {} as Record<string, unknown>)
          };
          
          joinedResults.push(joinedItem);
        }
      }
      
      logDebug(`Joined ${results1.length} and ${results2.length} rows by field "${joinField}" (result: ${joinedResults.length} rows)`);
      return joinedResults;
    } catch (error) {
      logError(`Failed to join results for keys ${key1} and ${key2}: ${(error as Error).message}`);
      return [];
    }
  }
  
  /**
   * Очищает все результаты, связанные с определенным запросом
   */
  async clear(queryId: string): Promise<void> {
    const pattern = `${this.keyPrefix}${queryId}:*`;
    
    try {
      let cursor = '0';
      do {
        const { cursor: newCursor, keys } = await this.client.scan(cursor, {
          MATCH: pattern,
          COUNT: 100
        });
        
        cursor = newCursor;
        
        if (keys.length > 0) {
          await this.client.del(keys);
          logDebug(`Cleared ${keys.length} cached results for query ${queryId}`);
        }
      } while (cursor !== '0');
    } catch (error) {
      logError(`Failed to clear results for query ${queryId}: ${(error as Error).message}`);
    }
  }
}

// Создаем и экспортируем глобальный экземпляр хранилища
export const resultStore = new RedisQueryResultStore(process.env.REDIS_URL); 