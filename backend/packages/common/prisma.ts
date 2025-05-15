import { PrismaClient as WalletPrismaClient } from '../../node_modules/.prisma/wallet-client';
import { PrismaClient as BetsHistoryPrismaClient } from '../../node_modules/.prisma/bets-history-client';
import { PrismaClient as UserActivitiesPrismaClient } from '../../node_modules/.prisma/user-activities-client';
import { PrismaClient as FinancialHistoryPrismaClient } from '../../node_modules/.prisma/financial-history-client';
import { DatabaseService } from './types';

// Global client instances for each service
let walletClient: WalletPrismaClient | undefined;
let betsHistoryClient: BetsHistoryPrismaClient | undefined;
let userActivitiesClient: UserActivitiesPrismaClient | undefined;
let financialHistoryClient: FinancialHistoryPrismaClient | undefined;

/**
 * Get prisma client for a specific service
 * @param service - Database service to get client for
 * @returns Appropriate Prisma client instance
 */
export const getPrismaClient = (service: DatabaseService): any => {
  switch (service) {
    case 'wallet':
      if (!walletClient) {
        walletClient = new WalletPrismaClient({
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
      }
      return walletClient;
    
    case 'bets-history':
      if (!betsHistoryClient) {
        betsHistoryClient = new BetsHistoryPrismaClient({
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
      }
      return betsHistoryClient;
    
    case 'user-activities':
      if (!userActivitiesClient) {
        userActivitiesClient = new UserActivitiesPrismaClient({
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
      }
      return userActivitiesClient;
    
    case 'financial-history':
      if (!financialHistoryClient) {
        financialHistoryClient = new FinancialHistoryPrismaClient({
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
      }
      return financialHistoryClient;
    
    default:
      throw new Error(`Unsupported database service: ${service}`);
  }
};

/**
 * Connect to all database services
 * @returns Promise that resolves when all clients are connected
 */
export const connectAllDatabases = async (): Promise<void> => {
  try {
    // Initialize all clients
    const wallet = getPrismaClient('wallet');
    const betsHistory = getPrismaClient('bets-history');
    const userActivities = getPrismaClient('user-activities');
    const financialHistory = getPrismaClient('financial-history');
    
    // Test connections
    await wallet.$connect();
    await betsHistory.$connect();
    await userActivities.$connect();
    await financialHistory.$connect();
    
    console.log('All database connections established successfully');
  } catch (error) {
    console.error('Failed to connect to one or more databases:', error);
    throw error;
  }
};

/**
 * Disconnect from all database services
 * @returns Promise that resolves when all clients are disconnected
 */
export const disconnectAllDatabases = async (): Promise<void> => {
  try {
    if (walletClient) await walletClient.$disconnect();
    if (betsHistoryClient) await betsHistoryClient.$disconnect();
    if (userActivitiesClient) await userActivitiesClient.$disconnect();
    if (financialHistoryClient) await financialHistoryClient.$disconnect();
    
    console.log('All database connections closed successfully');
  } catch (error) {
    console.error('Failed to disconnect from one or more databases:', error);
    throw error;
  }
}; 