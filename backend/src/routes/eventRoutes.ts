import { IncomingMessage, ServerResponse } from 'http';
import EventController from '../controllers/EventController';
import { safeJsonStringify } from '@common/utils';

/**
 * Extract URL parameters from a URL pattern
 * @param path URL path
 * @param pattern URL pattern with placeholders
 * @returns Extract parameters or null if pattern doesn't match
 */
const extractParams = (path: string, pattern: string): Record<string, string> | null => {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  
  if (patternParts.length !== pathParts.length) {
    return null;
  }
  
  const params: Record<string, string> = {};
  
  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    
    if (patternPart.startsWith(':')) {
      const paramName = patternPart.substring(1);
      params[paramName] = pathParts[i];
    } else if (patternPart !== pathParts[i]) {
      return null;
    }
  }
  
  return params;
};

/**
 * Handle event-related routes
 * @param req HTTP request
 * @param res HTTP response
 * @returns Whether the route was handled
 */
export const handleEventRoutes = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
  const url = req.url || '';
  const urlObj = new URL(url, `http://${req.headers.host}`);
  const path = urlObj.pathname;
  
  // Get events for a specific query
  // GET /api/events/:queryId
  const eventsParams = extractParams(path, '/api/events/:queryId');
  if (req.method === 'GET' && eventsParams) {
    await EventController.getEvents(req, res, eventsParams.queryId);
    return true;
  }
  
  // Poll for new events since a specific timestamp
  // GET /api/events/:queryId/poll?since=1234567890
  const pollParams = extractParams(path, '/api/events/:queryId/poll');
  if (req.method === 'GET' && pollParams) {
    const since = urlObj.searchParams.get('since');
    
    if (!since || isNaN(parseInt(since))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(safeJsonStringify({ error: 'Missing or invalid "since" parameter' }));
      return true;
    }
    
    await EventController.pollEvents(req, res, pollParams.queryId, parseInt(since));
    return true;
  }
  
  return false;
};

export default { handleEventRoutes }; 