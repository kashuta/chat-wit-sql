import { createClient, RedisClientType } from 'redis';
import { logDebug, logError, logInfo, logWarn } from './logger';

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

  /**
   * Проверяет активно ли соединение
   */
  isConnected(): boolean;
}

/**
 * Типы состояния соединения с Redis
 */
enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error'
}

/**
 * Реализация хранилища результатов в памяти (фолбэк)
 */
export class MemoryQueryResultStore implements QueryResultStoreInterface {
  private storage: Map<string, Record<string, unknown>[]> = new Map();
  private isActive: boolean = false;
  
  /**
   * Подключение (заглушка для интерфейса)
   */
  async connect(): Promise<void> {
    this.isActive = true;
    logInfo('In-memory result store initialized');
  }
  
  /**
   * Отключение (заглушка для интерфейса)
   */
  async disconnect(): Promise<void> {
    this.isActive = false;
    this.storage.clear();
    logInfo('In-memory result store cleared and deactivated');
  }
  
  /**
   * Проверка состояния (всегда подключен)
   */
  isConnected(): boolean {
    return this.isActive;
  }
  
  /**
   * Сохраняет результаты запроса в памяти
   */
  async store(key: string, results: Record<string, unknown>[]): Promise<void> {
    this.storage.set(key, [...results]);
    logDebug(`Stored results in memory for key ${key} (${results.length} rows)`);
  }
  
  /**
   * Получает результаты запроса из памяти
   */
  async get(key: string): Promise<Record<string, unknown>[]> {
    const data = this.storage.get(key);
    
    if (!data) {
      logDebug(`No data found in memory for key ${key}`);
      return [];
    }
    
    logDebug(`Retrieved results from memory for key ${key} (${data.length} rows)`);
    return [...data];
  }
  
  /**
   * Проверяет существование результатов по ключу
   */
  async exists(key: string): Promise<boolean> {
    const exists = this.storage.has(key);
    return exists;
  }
  
  /**
   * Объединяет результаты двух запросов по указанному полю
   */
  async joinResults(key1: string, key2: string, joinField: string): Promise<Record<string, unknown>[]> {
    const results1 = await this.get(key1);
    const results2 = await this.get(key2);
    
    if (results1.length === 0 || results2.length === 0) {
      return [];
    }
    
    // Создаем индекс для быстрого поиска по полю соединения
    const index: Record<string, Record<string, unknown>> = {};
    for (const row of results2) {
      const value = row[joinField];
      if (value !== undefined && value !== null) {
        const valueStr = String(value);
        index[valueStr] = row;
      }
    }
    
    // Объединяем данные
    const joined: Record<string, unknown>[] = [];
    for (const row1 of results1) {
      const value = row1[joinField];
      if (value !== undefined && value !== null) {
        const valueStr = String(value);
        if (index[valueStr]) {
          joined.push({
            ...row1,
            ...index[valueStr]
          });
        }
      }
    }
    
    return joined;
  }
  
  /**
   * Очищает все результаты, связанные с определенным запросом
   */
  async clear(queryId: string): Promise<void> {
    const pattern = new RegExp(`^${queryId}:`);
    
    const keysToDelete: string[] = [];
    this.storage.forEach((_, key) => {
      if (pattern.test(key)) {
        keysToDelete.push(key);
      }
    });
    
    for (const key of keysToDelete) {
      this.storage.delete(key);
    }
    
    logDebug(`Cleared ${keysToDelete.length} cached results from memory for query ${queryId}`);
  }
}

/**
 * Реализация хранилища результатов на базе Redis
 */
export class RedisQueryResultStore implements QueryResultStoreInterface {
  private client: RedisClientType;
  private readonly keyPrefix = 'sql-query-result:';
  private readonly expirationTime = 60 * 30; // 30 минут
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  
  constructor(url: string = 'redis://localhost:6379') {
    this.client = createClient({ url });
    
    this.client.on('error', (err) => {
      this.connectionState = ConnectionState.ERROR;
      logError(`Redis Client Error: ${err.message}`);
    });
    
    this.client.on('connect', () => {
      this.connectionState = ConnectionState.CONNECTED;
      logInfo('Connected to Redis');
    });

    this.client.on('end', () => {
      this.connectionState = ConnectionState.DISCONNECTED;
      logInfo('Redis connection closed');
    });
  }
  
  /**
   * Проверяет состояние соединения
   */
  isConnected(): boolean {
    return this.connectionState === ConnectionState.CONNECTED;
  }

  /**
   * Подключение к Redis
   */
  async connect(): Promise<void> {
    // Если уже подключены или в процессе подключения, не выполняем повторное соединение
    if (this.isConnected()) {
      logDebug('Redis already connected, skipping connection');
      return;
    }

    if (this.connectionState === ConnectionState.CONNECTING) {
      logDebug('Redis connection in progress, skipping duplicate connect call');
      return;
    }

    try {
      this.connectionState = ConnectionState.CONNECTING;
      await this.client.connect();
      this.connectionState = ConnectionState.CONNECTED;
      logInfo('Redis result store connected');
    } catch (error) {
      this.connectionState = ConnectionState.ERROR;
      logError(`Failed to connect to Redis: ${(error as Error).message}`);
      throw error;
    }
  }
  
  /**
   * Отключение от Redis
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected()) {
      logDebug('Redis not connected, skipping disconnect');
      return;
    }

    try {
      await this.client.disconnect();
      this.connectionState = ConnectionState.DISCONNECTED;
      logInfo('Redis result store disconnected');
    } catch (error) {
      logError(`Error disconnecting from Redis: ${(error as Error).message}`);
      // Сбрасываем состояние даже при ошибке отключения
      this.connectionState = ConnectionState.DISCONNECTED;
    }
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
    // Если нет подключения, пытаемся подключиться
    if (!this.isConnected()) {
      try {
        await this.connect();
      } catch (error) {
        logWarn(`Cannot store results, Redis not connected: ${(error as Error).message}`);
        throw new Error(`Redis not connected: ${(error as Error).message}`);
      }
    }

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
    // Если нет подключения, пытаемся подключиться
    if (!this.isConnected()) {
      try {
        await this.connect();
      } catch (error) {
        logWarn(`Cannot get results, Redis not connected: ${(error as Error).message}`);
        return [];
      }
    }

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
    // Если нет подключения, пытаемся подключиться
    if (!this.isConnected()) {
      try {
        await this.connect();
      } catch (error) {
        logWarn(`Cannot check if key exists, Redis not connected: ${(error as Error).message}`);
        return false;
      }
    }

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
   * Объединяет результаты двух запросов по указанному полю
   */
  async joinResults(key1: string, key2: string, joinField: string): Promise<Record<string, unknown>[]> {
    const results1 = await this.get(key1);
    const results2 = await this.get(key2);
    
    if (results1.length === 0 || results2.length === 0) {
      return [];
    }
    
    // Создаем индекс для быстрого поиска по полю соединения
    const index: Record<string, Record<string, unknown>> = {};
    for (const row of results2) {
      const value = row[joinField];
      if (value !== undefined && value !== null) {
        const valueStr = String(value);
        index[valueStr] = row;
      }
    }
    
    // Объединяем данные
    const joined: Record<string, unknown>[] = [];
    for (const row1 of results1) {
      const value = row1[joinField];
      if (value !== undefined && value !== null) {
        const valueStr = String(value);
        if (index[valueStr]) {
          joined.push({
            ...row1,
            ...index[valueStr]
          });
        }
      }
    }
    
    return joined;
  }
  
  /**
   * Очищает все результаты, связанные с определенным запросом
   */
  async clear(queryId: string): Promise<void> {
    // Если нет подключения, пытаемся подключиться
    if (!this.isConnected()) {
      try {
        await this.connect();
      } catch (error) {
        logWarn(`Cannot clear results, Redis not connected: ${(error as Error).message}`);
        return;
      }
    }

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

/**
 * Класс для переключения между Redis и in-memory хранилищами
 */
export class FallbackQueryResultStore implements QueryResultStoreInterface {
  private redisStore: RedisQueryResultStore;
  private memoryStore: MemoryQueryResultStore;
  private isRedisActive: boolean = true;
  
  constructor(redisUrl: string = 'redis://localhost:6379') {
    this.redisStore = new RedisQueryResultStore(redisUrl);
    this.memoryStore = new MemoryQueryResultStore();
  }
  
  /**
   * Переключает на хранилище в памяти
   */
  private switchToMemory(): void {
    if (this.isRedisActive) {
      this.isRedisActive = false;
      logWarn('Switching to in-memory storage fallback');
      this.memoryStore.connect().catch(err => {
        logError(`Failed to initialize memory store: ${err.message}`);
      });
    }
  }
  
  /**
   * Возвращает активное хранилище
   */
  private getActiveStore(): QueryResultStoreInterface {
    if (this.isRedisActive && this.redisStore.isConnected()) {
      return this.redisStore;
    }
    
    if (this.isRedisActive) {
      // Если Redis должен быть активен, но не подключен - пробуем подключиться
      try {
        // Не ждем промис здесь, чтобы не блокировать вызов
        this.redisStore.connect().catch(() => {
          this.switchToMemory();
        });
        // Если соединение сразу установилось, используем Redis
        if (this.redisStore.isConnected()) {
          return this.redisStore;
        }
      } catch {
        // Если произошла ошибка, переключаемся на хранилище в памяти
        this.switchToMemory();
      }
    }
    
    // Проверяем, что in-memory хранилище инициализировано
    if (!this.memoryStore.isConnected()) {
      this.memoryStore.connect().catch(err => {
        logError(`Failed to initialize memory store: ${err.message}`);
      });
    }
    
    return this.memoryStore;
  }
  
  /**
   * Проверяет активность соединения с Redis
   */
  isConnected(): boolean {
    if (this.isRedisActive) {
      return this.redisStore.isConnected();
    }
    return this.memoryStore.isConnected();
  }
  
  /**
   * Подключение к Redis или инициализация хранилища в памяти
   */
  async connect(): Promise<void> {
    if (this.isRedisActive) {
      try {
        await this.redisStore.connect();
      } catch (error) {
        this.switchToMemory();
        await this.memoryStore.connect();
      }
    } else {
      await this.memoryStore.connect();
    }
  }
  
  /**
   * Отключение текущего хранилища
   */
  async disconnect(): Promise<void> {
    if (this.isRedisActive && this.redisStore.isConnected()) {
      await this.redisStore.disconnect();
    }
    
    if (this.memoryStore.isConnected()) {
      await this.memoryStore.disconnect();
    }
  }
  
  /**
   * Сохраняет результаты в активное хранилище
   */
  async store(key: string, results: Record<string, unknown>[]): Promise<void> {
    try {
      await this.getActiveStore().store(key, results);
    } catch (error) {
      if (this.isRedisActive) {
        this.switchToMemory();
        await this.memoryStore.store(key, results);
      } else {
        throw error;
      }
    }
  }
  
  /**
   * Получает результаты из активного хранилища
   */
  async get(key: string): Promise<Record<string, unknown>[]> {
    try {
      return await this.getActiveStore().get(key);
    } catch (error) {
      if (this.isRedisActive) {
        this.switchToMemory();
        return await this.memoryStore.get(key);
      }
      return [];
    }
  }
  
  /**
   * Проверяет существование по ключу в активном хранилище
   */
  async exists(key: string): Promise<boolean> {
    try {
      return await this.getActiveStore().exists(key);
    } catch (error) {
      if (this.isRedisActive) {
        this.switchToMemory();
        return await this.memoryStore.exists(key);
      }
      return false;
    }
  }
  
  /**
   * Объединяет результаты из активного хранилища
   */
  async joinResults(key1: string, key2: string, joinField: string): Promise<Record<string, unknown>[]> {
    try {
      return await this.getActiveStore().joinResults(key1, key2, joinField);
    } catch (error) {
      if (this.isRedisActive) {
        this.switchToMemory();
        return await this.memoryStore.joinResults(key1, key2, joinField);
      }
      return [];
    }
  }
  
  /**
   * Очищает данные из активного хранилища
   */
  async clear(queryId: string): Promise<void> {
    try {
      await this.getActiveStore().clear(queryId);
    } catch (error) {
      if (this.isRedisActive) {
        this.switchToMemory();
        await this.memoryStore.clear(queryId);
      }
    }
  }
}

// Создаем и экспортируем глобальный экземпляр хранилища с автоматическим фолбэком
export const resultStore: QueryResultStoreInterface = new FallbackQueryResultStore(process.env.REDIS_URL); 