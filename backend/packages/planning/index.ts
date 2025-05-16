import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { QueryPlan, DatabaseService, PerceptionResult } from '@common/types';
import { getOpenAIModel, createOutputParser } from '@common/llm';
import { databaseKnowledge } from '@common/knowledge';
import { PLANNING_SYSTEM_PROMPT } from '../../data/prompts';
import { resolveConflictsInPlan } from '../conflict-resolution';

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

type PlanningOutput = z.infer<typeof queryPlanSchema>;

const getSystemPrompt = (): string => {
  const sqlGuidelines = loadSqlGuidelines();
  
  let basePrompt = PLANNING_SYSTEM_PROMPT;
  
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
    
    const systemMessage = {
      role: 'system',
      content: getSystemPrompt()
    };
    
    const userMessage = {
      role: 'user',
      content: `User query: ${query}

Intent analysis: ${intent}
Required services from perception: ${servicesStr}
Extracted entities: ${entitiesStr}

IMPORTANT: Do NOT use dot notation like 'wallet.Transaction' when specifying service. Only use valid service names from the list.
Always specify table names in the SQL query, not in the service name.

Please create a plan to answer this query.`
    };
    
    const messages = [systemMessage, userMessage];
    
    const response = await model.invoke(messages);
    
    if (typeof response.content !== 'string') {
      throw new Error('LLM response content is not a string');
    }
    
    console.log(`Raw planning response: ${response.content}`);
    
    const result = await parser.parse(response.content) as PlanningOutput;

    const validatedPlan = validatePlanAgainstSchema(result);
    
    // Проверяем план на конфликты таблиц и пытаемся их разрешить
    const conflictResolution = await resolveConflictsInPlan(validatedPlan, query);
    
    // Если были внесены изменения, логируем это
    if (conflictResolution.amended) {
      console.log(`Plan was amended to resolve table conflicts. Affected tables: ${
        conflictResolution.conflicts.map((c: any) => c.tableName).join(', ')
      }`);
      
      return conflictResolution.resolvedPlan;
    }
    
    return validatedPlan;
  } catch (error) {
    console.error('Error in planning module:', error);
    
    return createFallbackPlan(perceptionResult, query);
  }
};

function validatePlanAgainstSchema(plan: PlanningOutput): QueryPlan {
  const validatedPlan: QueryPlan = {
    steps: [],
    requiredServices: plan.requiredServices as DatabaseService[],
  };

  for (const step of plan.steps) {
    const service = step.service as DatabaseService;
    
    if (!step.sqlQuery) {
      validatedPlan.steps.push({
        service,
        description: step.description,
        sqlQuery: `SELECT * FROM information_schema.tables LIMIT 10`,
      });
      continue;
    }
    
    const extractedTableNames = extractTableNames(step.sqlQuery);
    let validQuery = step.sqlQuery;
    
    for (const tableName of extractedTableNames) {
      const dbInfo = databaseKnowledge.getDatabaseDescription(service);
      
      if (dbInfo) {
        const tableExists = dbInfo.tables.some((t: any) => 
          t.name.toLowerCase() === tableName.toLowerCase());
          
        if (!tableExists) {
          const similarTables = findSimilarTables(dbInfo.tables, tableName);
          
          if (similarTables.length > 0) {
            const correctTable = similarTables[0];
            validQuery = validQuery.replace(
              new RegExp(`\\b${tableName}\\b`, 'gi'),
              `"${correctTable}"`
            );
          }
        } else {
          const exactTable = dbInfo.tables.find((t: any) => 
            t.name.toLowerCase() === tableName.toLowerCase());
            
          if (exactTable && exactTable.name !== tableName) {
            validQuery = validQuery.replace(
              new RegExp(`\\b${tableName}\\b`, 'gi'),
              `"${exactTable.name}"`
            );
          }
        }
      }
    }
    
    validatedPlan.steps.push({
      service,
      description: step.description,
      sqlQuery: validQuery,
    });
  }
  
  return validatedPlan;
}

function extractTableNames(query: string): string[] {
  const tableRegex = /FROM\s+["']?([a-zA-Z0-9_]+)["']?/gi;
  const tables = new Set<string>();
  let match;
  
  while ((match = tableRegex.exec(query)) !== null) {
    tables.add(match[1]);
  }
  
  const joinRegex = /JOIN\s+["']?([a-zA-Z0-9_]+)["']?/gi;
  while ((match = joinRegex.exec(query)) !== null) {
    tables.add(match[1]);
  }
  
  return Array.from(tables);
}

function findSimilarTables(tables: any[], tableName: string): string[] {
  return tables
    .map(t => t.name)
    .filter(name => 
      name.toLowerCase().includes(tableName.toLowerCase()) || 
      tableName.toLowerCase().includes(name.toLowerCase()))
    .sort((a, b) => {
      const scoreA = calculateSimilarity(tableName, a);
      const scoreB = calculateSimilarity(tableName, b);
      return scoreB - scoreA;
    });
}

function calculateSimilarity(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  
  if (aLower === bLower) return 1;
  if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.8;
  
  let matches = 0;
  const minLength = Math.min(a.length, b.length);
  
  for (let i = 0; i < minLength; i++) {
    if (aLower[i] === bLower[i]) matches++;
  }
  
  return matches / Math.max(a.length, b.length);
}

function createFallbackPlan(perceptionResult: PerceptionResult, _query: string): QueryPlan {
  const knownTables = new Map<string, string[]>();
  
  if (databaseKnowledge.isLoaded()) {
    const allDatabases = databaseKnowledge.getAllDatabases();
    
    for (const db of allDatabases) {
      knownTables.set(db.service, db.tables.map((t: any) => t.name));
    }
  }
  
  return {
    steps: perceptionResult.requiredServices.map((service: any) => {
      let defaultQuery: string;
      const serviceTableNames = knownTables.get(service) || [];
      
      if (serviceTableNames.length > 0) {
        const tableName = serviceTableNames[0];
        defaultQuery = `SELECT * FROM "${tableName}" LIMIT 10`;
      } else {
        switch(service) {
          case 'wallet':
            defaultQuery = 'SELECT * FROM "Transaction" LIMIT 10';
            break;
          case 'bets-history':
            defaultQuery = 'SELECT * FROM "Bet" LIMIT 10';
            break;
          case 'user-activities':
            defaultQuery = 'SELECT * FROM "Activity" LIMIT 10';
            break;
          case 'financial-history':
            defaultQuery = 'SELECT * FROM "FinancialTransaction" LIMIT 10';
            break;
          case 'pam':
            defaultQuery = 'SELECT * FROM "User" LIMIT 10';
            break;
          default:
            defaultQuery = 'SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\' LIMIT 20';
        }
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