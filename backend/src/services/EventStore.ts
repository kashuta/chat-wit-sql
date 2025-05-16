import { v4 as uuidv4 } from 'uuid';
import { createClient, RedisClientType } from 'redis';
import { logDebug, logError, logInfo } from '@common/logger';
import {
  EventStatus,
  EventType,
  QueryEvent
} from '../types/events';

/**
 * Service for storing and retrieving query execution events
 */
export class EventStore {
  private client: RedisClientType;
  private isConnected: boolean = false;
  private readonly keyPrefix: string = 'query-events:';
  private readonly eventTTL: number = 60 * 10; // 10 minutes
  
  /**
   * Constructor
   * @param url Redis URL
   */
  constructor(url: string = 'redis://localhost:6379') {
    this.client = createClient({ url });
    
    this.client.on('error', (err) => {
      this.isConnected = false;
      logError(`EventStore Redis Client Error: ${err.message}`);
    });
    
    this.client.on('connect', () => {
      this.isConnected = true;
      logInfo('EventStore connected to Redis');
    });
    
    this.client.on('end', () => {
      this.isConnected = false;
      logInfo('EventStore Redis connection closed');
    });
  }
  
  /**
   * Initialize Redis connection
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }
    
    try {
      await this.client.connect();
      this.isConnected = true;
      logInfo('EventStore Redis connection established');
    } catch (error) {
      this.isConnected = false;
      logError(`Failed to connect EventStore to Redis: ${(error as Error).message}`);
      // Fallback to memory storage would go here in a production system
    }
  }
  
  /**
   * Close Redis connection
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }
    
    try {
      await this.client.quit();
      this.isConnected = false;
      logInfo('EventStore Redis connection closed');
    } catch (error) {
      logError(`Error disconnecting EventStore from Redis: ${(error as Error).message}`);
    }
  }
  
  /**
   * Create an event of specified type
   */
  createEvent<T extends QueryEvent>(
    queryId: string, 
    type: EventType, 
    status: EventStatus = EventStatus.STARTED,
    payload: any = {}
  ): T {
    console.log('[EVENTSTORE] createEvent', { queryId, type, status, payload });
    return {
      id: uuidv4(),
      queryId,
      timestamp: Date.now(),
      type,
      status,
      payload
    } as T;
  }
  
  /**
   * Store an event in Redis
   * @param event The event to store
   */
  async addEvent(event: QueryEvent): Promise<void> {
    if (!this.isConnected) {
      logError('Cannot store event: Redis not connected');
      return;
    }
    
    try {
      const key = `${this.keyPrefix}${event.queryId}`;
      const storedEvents = await this.getEvents(event.queryId);
      storedEvents.push(event);
      console.log('[EVENTSTORE] addEvent', { key, eventCount: storedEvents.length, lastEvent: event });
      await this.client.set(key, JSON.stringify(storedEvents), {
        EX: this.eventTTL
      });
      
      logDebug(`Stored event ${event.type} for query ${event.queryId}`);
    } catch (error) {
      logError(`Failed to store event: ${(error as Error).message}`);
    }
  }
  
  /**
   * Get all events for a query
   * @param queryId Query ID
   */
  async getEvents(queryId: string): Promise<QueryEvent[]> {
    if (!this.isConnected) {
      logError('Cannot retrieve events: Redis not connected');
      return [];
    }
    
    try {
      const key = `${this.keyPrefix}${queryId}`;
      const data = await this.client.get(key);
      
      if (!data) {
        return [];
      }
      
      return JSON.parse(data) as QueryEvent[];
    } catch (error) {
      logError(`Failed to retrieve events: ${(error as Error).message}`);
      return [];
    }
  }
  
  /**
   * Update an existing event (e.g., change status or add more data)
   */
  async updateEvent(
    queryId: string, 
    eventId: string, 
    status: EventStatus, 
    additionalPayload?: Record<string, any>
  ): Promise<void> {
    if (!this.isConnected) {
      logError('Cannot update event: Redis not connected');
      return;
    }
    
    try {
      const events = await this.getEvents(queryId);
      const eventIndex = events.findIndex(e => e.id === eventId);
      
      if (eventIndex === -1) {
        logError(`Event ${eventId} not found for query ${queryId}`);
        return;
      }
      
      // Type assertion for correct type safety on update
      const currentEvent = events[eventIndex] as any;
      
      const updatedEvent = {
        ...currentEvent,
        status,
        timestamp: Date.now(),
        payload: {
          ...currentEvent.payload,
          ...(additionalPayload || {})
        }
      };
      
      events[eventIndex] = updatedEvent;
      
      const key = `${this.keyPrefix}${queryId}`;
      await this.client.set(key, JSON.stringify(events), {
        EX: this.eventTTL
      });
      
      logDebug(`Updated event ${eventId} for query ${queryId}`);
    } catch (error) {
      logError(`Failed to update event: ${(error as Error).message}`);
    }
  }
  
  /**
   * Generate a new query ID
   */
  generateQueryId(): string {
    return uuidv4();
  }
}

// Singleton instance
let eventStoreInstance: EventStore | null = null;

/**
 * Get the EventStore instance
 */
export const getEventStore = (): EventStore => {
  if (!eventStoreInstance) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    eventStoreInstance = new EventStore(redisUrl);
  }
  
  return eventStoreInstance;
};

/**
 * Initialize the EventStore
 */
export const initializeEventStore = async (): Promise<void> => {
  const eventStore = getEventStore();
  await eventStore.connect();
};

/**
 * Shut down the EventStore
 */
export const shutdownEventStore = async (): Promise<void> => {
  if (eventStoreInstance) {
    await eventStoreInstance.disconnect();
    eventStoreInstance = null;
  }
}; 