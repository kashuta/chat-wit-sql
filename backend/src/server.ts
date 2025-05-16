import http from 'http';
import { IncomingMessage, ServerResponse } from 'http';
import { analyzeQuery } from '@perception/index';
import { createQueryPlan } from '@planning/index';
import { executeQueryPlan } from '@execution/index';
import { isConfidentEnough, safeJsonStringify } from '@common/utils';
import { QueryRequest } from './common/types';
import crypto from 'crypto';
import { handleEventRoutes } from './routes/eventRoutes';
import { getEventStore } from './services/EventStore';
import { EventType, EventStatus } from './types/events';
import { setImmediate } from 'timers';

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
  
  // Проверка маршрутов событий
  const isEventRoute = await handleEventRoutes(req, res);
  if (isEventRoute) return;
  
  // Endpoint для инициализации queryId
  if (req.method === 'POST' && req.url === '/api/query/init') {
    const queryId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ queryId }));
    return;
  }
  
  // Handle OPTIONS request (preflight)
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Only handle POST requests to /api/query
  if (req.method === 'POST' && req.url === '/api/query') {
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
    const eventStore = getEventStore();
    const queryId = requestData.queryId || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    console.log('[API] /api/query called with queryId:', queryId, 'query:', requestData.query);
    // Немедленно возвращаем queryId клиенту
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ queryId }));
    // Асинхронно запускаем pipeline
    setImmediate(async () => {
      try {
        console.log('[PIPELINE]', queryId, '-> QUERY_RECEIVED');
        await eventStore.addEvent(eventStore.createEvent(
          queryId,
          EventType.QUERY_RECEIVED,
          EventStatus.COMPLETED,
          { query: requestData.query, language: requestData.language }
        ));
        console.log('[PIPELINE]', queryId, '-> PERCEPTION_ANALYSIS STARTED');
        await eventStore.addEvent(eventStore.createEvent(
          queryId,
          EventType.PERCEPTION_ANALYSIS,
          EventStatus.STARTED,
          { query: requestData.query }
        ));
        const perceptionResult = await analyzeQuery(requestData.query);
        console.log('[PIPELINE]', queryId, '-> PERCEPTION_ANALYSIS COMPLETED', perceptionResult);
        await eventStore.addEvent(eventStore.createEvent(
          queryId,
          EventType.PERCEPTION_ANALYSIS,
          EventStatus.COMPLETED,
          { intent: perceptionResult.intent, confidence: perceptionResult.confidence }
        ));
        if (!isConfidentEnough(perceptionResult.confidence)) {
          console.log('[PIPELINE]', queryId, '-> NOT CONFIDENT, COMPLETION');
          await eventStore.addEvent(eventStore.createEvent(
            queryId,
            EventType.COMPLETION,
            EventStatus.COMPLETED,
            { stepCount: 0, error: 'Not confident' }
          ));
          return;
        }
        console.log('[PIPELINE]', queryId, '-> PLANNING STARTED');
        await eventStore.addEvent(eventStore.createEvent(
          queryId,
          EventType.PLANNING,
          EventStatus.STARTED
        ));
        const queryPlan = await createQueryPlan(perceptionResult, requestData.query);
        console.log('[PIPELINE]', queryId, '-> PLANNING COMPLETED', queryPlan);
        await eventStore.addEvent(eventStore.createEvent(
          queryId,
          EventType.PLANNING,
          EventStatus.COMPLETED,
          { stepCount: queryPlan.steps.length, requiredServices: queryPlan.requiredServices }
        ));
        for (let i = 0; i < queryPlan.steps.length; i++) {
          const step = queryPlan.steps[i];
          console.log('[PIPELINE]', queryId, `-> STEP_EXECUTION STARTED step ${i+1}`);
          await eventStore.addEvent(eventStore.createEvent(
            queryId,
            EventType.STEP_EXECUTION,
            EventStatus.STARTED,
            {
              stepId: `step-${i+1}`,
              stepNumber: i + 1,
              totalSteps: queryPlan.steps.length,
              service: step.service,
              description: step.description,
              sql: step.sqlQuery
            }
          ));
          // ...выполнение шага (упрощённо)...
          console.log('[PIPELINE]', queryId, `-> STEP_EXECUTION COMPLETED step ${i+1}`);
          await eventStore.addEvent(eventStore.createEvent(
            queryId,
            EventType.STEP_EXECUTION,
            EventStatus.COMPLETED,
            {
              stepId: `step-${i+1}`,
              stepNumber: i + 1,
              totalSteps: queryPlan.steps.length,
              service: step.service,
              description: step.description,
              sql: step.sqlQuery
            }
          ));
        }
        const response = await executeQueryPlan(queryPlan, requestData.query);
        console.log('[PIPELINE]', queryId, '-> RESPONSE_GENERATION COMPLETED', response);
        await eventStore.addEvent(eventStore.createEvent(
          queryId,
          EventType.RESPONSE_GENERATION,
          EventStatus.COMPLETED,
          {
            data: response.data,
            explanation: response.explanation,
            confidence: response.confidence,
            sql: response.sql,
            visualization: response.visualization
          }
        ));
        console.log('[PIPELINE]', queryId, '-> COMPLETION COMPLETED');
        await eventStore.addEvent(eventStore.createEvent(
          queryId,
          EventType.COMPLETION,
          EventStatus.COMPLETED,
          { stepCount: queryPlan.steps.length }
        ));
      } catch (error) {
        console.log('[PIPELINE]', queryId, '-> ERROR', error);
        await eventStore.addEvent(eventStore.createEvent(
          queryId,
          EventType.COMPLETION,
          EventStatus.ERROR,
          { error: (error as Error).message }
        ));
      }
    });
    return;
  } else if (req.method === 'GET' && (req.url === '/' || req.url === '/healthcheck')) {
    // Health check endpoint
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(safeJsonStringify({ status: 'ok', message: 'Dante AI Data Agent is running' }));
  } else {
    // Not found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(safeJsonStringify({ error: 'Not found' }));
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