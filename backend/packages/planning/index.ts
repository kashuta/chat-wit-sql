import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { QueryPlan, DatabaseService, PerceptionResult } from '@common/types';
import { getOpenAIModel, createOutputParser } from '@common/llm';
import { databaseKnowledge } from '@common/knowledge';

/**
 * Loads SQL instructions from a file
 * @returns String with instructions
 */
const loadSqlGuidelines = (): string => {
  try {
    const guidePath = path.join(process.cwd(), 'data', 'sql-guidelines.json');
    if (!fs.existsSync(guidePath)) {
      console.warn('SQL guidelines file not found:', guidePath);
      return '';
    }
    
    const guideContent = fs.readFileSync(guidePath, 'utf-8');
    const guidelines = JSON.parse(guideContent);
    
    let result = 'IMPORTANT RULES FOR POSTGRESQL:\n\n';
    
    if (guidelines.postgresqlGuidelines) {
      // Add rules
      for (const rule of guidelines.postgresqlGuidelines) {
        result += `### ${rule.rule}\n`;
        if (rule.example) {
          result += `Example: ${rule.example}\n`;
        }
        if (rule.explanation) {
          result += `${rule.explanation}\n`;
        }
        if (rule.tablesRequiringQuotes) {
          result += 'Tables requiring quotes:\n';
          for (const table of rule.tablesRequiringQuotes) {
            result += `- ${table.service}.${table.table} → use ${table.correctUsage}\n`;
          }
        }
        if (rule.queries) {
          result += 'Diagnostic queries:\n';
          for (const query of rule.queries) {
            result += `- ${query.description}: \`${query.query}\`\n`;
          }
        }
        result += '\n';
      }
    }
    
    return result;
  } catch (error) {
    console.warn('Failed to load SQL guidelines:', error);
    return '';
  }
};
const queryPlanSchema = z.object({
  steps: z.array(
    z.object({
      service: z.enum([
        'wallet', 
        'bets-history', 
        'user-activities', 
        'financial-history',
        'affiliate',
        'casino-st8',
        'geolocation',
        'kyc',
        'notification',
        'optimove',
        'pam',
        'payment-gateway',
        'traffic'
      ] as const),
      description: z.string(),
      sqlQuery: z.string().optional(),
    })
  ).describe('Steps to execute to answer the query'),
  requiredServices: z.array(
    z.enum([
      'wallet', 
      'bets-history', 
      'user-activities', 
      'financial-history',
      'affiliate',
      'casino-st8',
      'geolocation',
      'kyc',
      'notification',
      'optimove',
      'pam',
      'payment-gateway',
      'traffic'
    ] as const)
  ).describe('Database services required to answer this query'),
});

// Define the output type from the zod schema
type PlanningOutput = z.infer<typeof queryPlanSchema>;

/**
 * System prompt for the planning module
 */
const getSystemPrompt = (): string => {
  const sqlGuidelines = loadSqlGuidelines();
  
  const basePrompt = `You are an AI assistant specialized in planning SQL queries for a sports betting and casino platform called Dante.
Your task is to plan the steps needed to answer the user's query efficiently, strictly adhering to the provided database schema.

${databaseKnowledge.isLoaded() ? databaseKnowledge.getDetailedDatabaseDescriptionsForLLM() : `
Available database services:
- wallet: Contains information about user balances, deposits, withdrawals, transactions, bonuses
- bets-history: Contains information about user bets, games played, winnings, losses
- user-activities: Contains user login history, session data, feature usage, preferences
- financial-history: Contains financial transactions, deposits, withdrawals, bonuses, promotions
- affiliate: Contains data about partnership programs and affiliate relationships
- casino-st8: Contains integration with the St8 casino platform
- geolocation: Contains information about user geographic location
- kyc: Contains user verification data (Know Your Customer)
- notification: Contains user notification settings and history
- optimove: Contains integration with Optimove marketing platform
- pam: Contains user account management data (Player Account Management)
- payment-gateway: Contains payment management data and methods
- traffic: Contains traffic tracking and analysis data
`}

${sqlGuidelines}

IMPORTANT DATABASE SELECTION RULES:
1. The 'pam' service is THE MAIN DATABASE for user information - it contains the primary "User" table with ALL registered users. ALWAYS use 'pam' for user-centric queries.
2. ALWAYS USE 'pam' service for any queries about user counts, user lists, or general user information. Target the "User" table for this.
3. For counting total users, always use: SELECT COUNT(*) FROM "User" in the pam service (or the exact table name for users specified in the schema if different).

IMPORTANT POSTGRESQL SYNTAX AND SCHEMA ADHERENCE RULES:
1. SQL Generation: When drafting SQL queries, you MUST use the EXACT table and column names provided in the schema description (loaded from database-descriptions.json). Do not invent or assume column names.
2. Case Sensitivity: PostgreSQL can be case-sensitive. If table or column names in the schema description are enclosed in double quotes (e.g., "User", "createdAt"), they MUST be used with quotes and the exact case in the SQL query. If they are not quoted in the schema, use them as is, respecting their original case.
3. Date Columns: For queries involving dates (e.g., registrations today, transactions last week), meticulously check the schema for the correct date column names for each relevant table (e.g., 'created_at', 'user_registered_at'). DO NOT use generic names like 'date' or 'registration_date' unless that exact name is specified in the schema for that table.
4. Keywords: Capitalize SQL keywords (SELECT, FROM, WHERE, etc.) for clarity.
5. Intervals: Use proper PostgreSQL date/interval syntax: NOW() - INTERVAL '7 days'.
6. Quoting Table Names: If a table name in the schema description starts with an uppercase letter or contains special characters (e.g., "User"), it almost certainly requires double quotes in PostgreSQL: SELECT * FROM "User". Follow the schema's examples if available.

IMPORTANT: USING THE USER TABLE (from 'pam' service for user data):
When planning queries related to users (e.g., count, list, details, registration dates):
- Always target the 'pam' service and its main user table (typically "User", but verify with the schema).
- For user registration dates, specifically look up the column name in the schema for the "User" table (it might be 'created_at', 'registered_at', or similar). Do not assume 'registration_date'.

For each step in the plan, you need to specify:
1. Which service to query (from the available list).
2. A description of what information to retrieve from that service.
3. Optionally, a draft SQL query. If you provide a query, it MUST strictly follow the schema rules above.

Respond with:
- steps: Array of steps to execute.
- requiredServices: Array of database services needed (should match the services in steps).

You MUST only use the available database services listed and described.

IMPORTANT: You must respond with a valid JSON object. Your response must be ONLY valid JSON without any text before or after it.
Example response format:
{
  "steps": [
    {
      "service": "financial-history",
      "description": "Count deposits made in the last week using the correct date column from schema",
      "sqlQuery": "SELECT COUNT(*) FROM \"Transaction\" WHERE \"type\" = 'DEPOSIT' AND \"created_at\"::date >= (NOW() - INTERVAL '7 days')::date" // Assumes Transaction table and created_at column from schema
    }
  ],
  "requiredServices": ["financial-history"]
}`;

  return basePrompt;
};

/**
 * Creates a query plan based on the perception result
 * @param perceptionResult - Result from the perception module
 * @param query - Original user query
 * @returns Query plan
 */
export const createQueryPlan = async (
  perceptionResult: PerceptionResult,
  query: string
): Promise<QueryPlan> => {
  const model = getOpenAIModel();
  const parser = createOutputParser(queryPlanSchema);
  
  try {
    const { intent, entities, requiredServices } = perceptionResult;
    const entitiesStr = JSON.stringify(entities);
    const servicesStr = JSON.stringify(requiredServices);
    
    // System message
    const systemMessage = {
      role: 'system',
      content: getSystemPrompt()
    };
    
    // User message
    const userMessage = {
      role: 'user',
      content: `User query: ${query}

Intent analysis: ${intent}
Required services from perception: ${servicesStr}
Extracted entities: ${entitiesStr}

Please create a plan to answer this query.`
    };
    
    // Prepare messages for the model
    const messages = [systemMessage, userMessage];
    
    const response = await model.invoke(messages);
    
    if (typeof response.content !== 'string') {
      throw new Error('LLM response content is not a string');
    }
    
    console.log(`Raw planning response: ${response.content}`);
    
    const result = await parser.parse(response.content) as PlanningOutput;

    return {
      steps: result.steps.map(step => ({
        service: step.service as DatabaseService,
        description: step.description,
        sqlQuery: step.sqlQuery,
      })),
      requiredServices: result.requiredServices as DatabaseService[],
    };
  } catch (error) {
    console.error('Error in planning module:', error);
    // Return a fallback plan with basic information retrieval
    return {
      steps: perceptionResult.requiredServices.map(service => {
        let defaultQuery: string;
        
        // Default queries for each service
        switch(service) {
          case 'wallet':
            defaultQuery = 'SELECT * FROM wallets LIMIT 10';
            break;
          case 'bets-history':
            defaultQuery = 'SELECT * FROM bets LIMIT 10';
            break;
          case 'user-activities':
            defaultQuery = 'SELECT * FROM activities LIMIT 10';
            break;
          case 'financial-history':
            defaultQuery = 'SELECT * FROM transactions LIMIT 10';
            break;
          default:
            defaultQuery = 'SELECT 1';
        }
        
        return {
          service,
          description: `Retrieve basic information from ${service}`,
          sqlQuery: defaultQuery
        };
      }),
      requiredServices: perceptionResult.requiredServices,
    };
  }
}; 