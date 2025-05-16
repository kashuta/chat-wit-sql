import { IncomingMessage, ServerResponse } from 'http';
import { getEventStore } from '../services/EventStore';
import { logError } from '@common/logger';
import { safeJsonStringify } from '@common/utils';

/**
 * Controller for handling events related API requests
 */
export class EventController {
  /**
   * Get events for a specific query
   * @param _req HTTP request
   * @param res HTTP response
   * @param queryId Query ID from URL
   */
  static async getEvents(_req: IncomingMessage, res: ServerResponse, queryId: string): Promise<void> {
    try {
      const eventStore = getEventStore();
      const events = await eventStore.getEvents(queryId);
      console.log('[EVENTS API] getEvents', { queryId, eventCount: events.length });
      
      // Set response headers
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      
      res.end(safeJsonStringify({ queryId, events }));
    } catch (error) {
      logError(`Error retrieving events: ${(error as Error).message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(safeJsonStringify({ error: 'Failed to retrieve events', details: (error as Error).message }));
    }
  }
  
  /**
   * Poll for new events since lastEventTimestamp
   * @param _req HTTP request
   * @param res HTTP response
   * @param queryId Query ID
   * @param lastEventTimestamp Timestamp of the last event client has
   */
  static async pollEvents(
    _req: IncomingMessage, 
    res: ServerResponse, 
    queryId: string, 
    lastEventTimestamp: number
  ): Promise<void> {
    try {
      const eventStore = getEventStore();
      const allEvents = await eventStore.getEvents(queryId);
      
      // Filter events newer than the lastEventTimestamp
      const newEvents = allEvents.filter(event => event.timestamp > lastEventTimestamp);
      console.log('[EVENTS API] pollEvents', { queryId, lastEventTimestamp, newCount: newEvents.length, totalCount: allEvents.length });
      
      // Set response headers
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      
      res.end(safeJsonStringify({ 
        queryId, 
        events: newEvents,
        hasNewEvents: newEvents.length > 0,
        currentTimestamp: Date.now()
      }));
    } catch (error) {
      logError(`Error polling events: ${(error as Error).message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(safeJsonStringify({ error: 'Failed to poll events', details: (error as Error).message }));
    }
  }
}

export default EventController; 