import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { QueryPlan, DatabaseService, PerceptionResult } from '@common/types';
import { getOpenAIModel, createOutputParser } from '@common/llm';
import { databaseKnowledge } from '@common/knowledge';
import { PLANNING_SYSTEM_PROMPT } from '../../data/prompts';

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
 * Gets the system prompt with placeholders replaced
 * @returns Formatted system prompt
 */
const getSystemPrompt = (): string => {
  const sqlGuidelines = loadSqlGuidelines();
  
  let basePrompt = PLANNING_SYSTEM_PROMPT;
  
  // Replace placeholders with actual data
  basePrompt = basePrompt.replace('DATABASE_DESCRIPTIONS_PLACEHOLDER', 
    databaseKnowledge.isLoaded() ? databaseKnowledge.getDetailedDatabaseDescriptionsForLLM() : `
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
    `);
  
  basePrompt = basePrompt.replace('SQL_GUIDELINES_PLACEHOLDER', sqlGuidelines);
  
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
            defaultQuery = 'SELECT * FROM information_schema.tables LIMIT 10';
        }
        
        return {
          service,
          description: `Fallback information retrieval for ${service}`,
          sqlQuery: defaultQuery,
        };
      }),
      requiredServices: perceptionResult.requiredServices,
    };
  }
}; 