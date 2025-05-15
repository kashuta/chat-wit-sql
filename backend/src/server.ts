import http from 'http';
import { IncomingMessage, ServerResponse } from 'http';
import { analyzeQuery } from '@perception/index';
import { createQueryPlan } from '@planning/index';
import { executeQueryPlan } from '@execution/index';
import { isConfidentEnough } from '@common/utils';
import { QueryRequest } from '@common/types';

/**
 * Handles API requests
 * @param req - HTTP request
 * @param res - HTTP response
 */
const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS request (preflight)
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Only handle POST requests to /api/query
  if (req.method === 'POST' && req.url === '/api/query') {
    try {
      // Read request body
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      
      await new Promise<void>((resolve, reject) => {
        req.on('end', () => resolve());
        req.on('error', err => reject(err));
      });
      
      // Parse request body
      const requestData = JSON.parse(body) as QueryRequest;
      
      // Process query using our modules
      const perceptionResult = await analyzeQuery(requestData.query);
      
      if (!isConfidentEnough(perceptionResult.confidence)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: {},
          explanation: 'I\'m not confident I understand your query. Could you rephrase it?',
          confidence: perceptionResult.confidence,
        }));
        return;
      }
      
      const queryPlan = await createQueryPlan(perceptionResult, requestData.query);
      const response = await executeQueryPlan(queryPlan, requestData.query);
      
      // Send response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (error) {
      console.error('Error processing request:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  } else if (req.method === 'GET' && (req.url === '/' || req.url === '/healthcheck')) {
    // Health check endpoint
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', message: 'Dante AI Data Agent is running' }));
  } else {
    // Not found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
};

/**
 * Starts the HTTP server on the specified port
 * @param port - The port number to listen on
 * @returns A promise that resolves when the server is started
 */
export const startServer = (port: number): Promise<void> => {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handleRequest);
    
    server.listen(port);
    
    server.on('listening', () => {
      console.log(`Server started on port ${port}`);
      resolve();
    });
    
    server.on('error', (err) => {
      reject(err);
    });
  });
}; 