import { PrismaClient as WalletPrismaClient } from '../../node_modules/.prisma/wallet-client';
import { PrismaClient as BetsHistoryPrismaClient } from '../../node_modules/.prisma/bets-history-client';
import { PrismaClient as UserActivitiesPrismaClient } from '../../node_modules/.prisma/user-activities-client';
import { PrismaClient as FinancialHistoryPrismaClient } from '../../node_modules/.prisma/financial-history-client';
import { PrismaClient as AffiliatePrismaClient } from '../../node_modules/.prisma/affiliate-client';
import { PrismaClient as CasinoSt8PrismaClient } from '../../node_modules/.prisma/casino-st8-client';
import { PrismaClient as GeolocationPrismaClient } from '../../node_modules/.prisma/geolocation-client';
import { PrismaClient as KycPrismaClient } from '../../node_modules/.prisma/kyc-client';
import { PrismaClient as NotificationPrismaClient } from '../../node_modules/.prisma/notification-client';
import { PrismaClient as OptimovePrismaClient } from '../../node_modules/.prisma/optimove-client';
import { PrismaClient as PamPrismaClient } from '../../node_modules/.prisma/pam-client';
import { PrismaClient as PaymentGatewayPrismaClient } from '../../node_modules/.prisma/payment-gateway-client';
import { PrismaClient as TrafficPrismaClient } from '../../node_modules/.prisma/traffic-client';
import { DatabaseService } from './types';

// Global client instances for each service
let walletClient: WalletPrismaClient | undefined;
let betsHistoryClient: BetsHistoryPrismaClient | undefined;
let userActivitiesClient: UserActivitiesPrismaClient | undefined;
let financialHistoryClient: FinancialHistoryPrismaClient | undefined;
let affiliateClient: AffiliatePrismaClient | undefined;
let casinoSt8Client: CasinoSt8PrismaClient | undefined;
let geolocationClient: GeolocationPrismaClient | undefined;
let kycClient: KycPrismaClient | undefined;
let notificationClient: NotificationPrismaClient | undefined;
let optimoveClient: OptimovePrismaClient | undefined;
let pamClient: PamPrismaClient | undefined;
let paymentGatewayClient: PaymentGatewayPrismaClient | undefined;
let trafficClient: TrafficPrismaClient | undefined;

/**
 * Get prisma client for a specific service
 * @param service - Database service to get client for
 * @returns Appropriate Prisma client instance
 */
export const getPrismaClient = (service: DatabaseService): any => {
  // Опции для логирования с использованием any типа
  const logOptions: any = process.env.NODE_ENV === 'development' 
    ? ['query', 'error', 'warn'] 
    : ['error'];
  
  switch (service) {
    case 'wallet':
      if (!walletClient) {
        walletClient = new WalletPrismaClient({ log: logOptions });
      }
      return walletClient;
    
    case 'bets-history':
      if (!betsHistoryClient) {
        betsHistoryClient = new BetsHistoryPrismaClient({ log: logOptions });
      }
      return betsHistoryClient;
    
    case 'user-activities':
      if (!userActivitiesClient) {
        userActivitiesClient = new UserActivitiesPrismaClient({ log: logOptions });
      }
      return userActivitiesClient;
    
    case 'financial-history':
      if (!financialHistoryClient) {
        financialHistoryClient = new FinancialHistoryPrismaClient({ log: logOptions });
      }
      return financialHistoryClient;
    
    case 'affiliate':
      if (!affiliateClient) {
        affiliateClient = new AffiliatePrismaClient({ log: logOptions });
      }
      return affiliateClient;
    
    case 'casino-st8':
      if (!casinoSt8Client) {
        casinoSt8Client = new CasinoSt8PrismaClient({ log: logOptions });
      }
      return casinoSt8Client;
    
    case 'geolocation':
      if (!geolocationClient) {
        geolocationClient = new GeolocationPrismaClient({ log: logOptions });
      }
      return geolocationClient;
    
    case 'kyc':
      if (!kycClient) {
        kycClient = new KycPrismaClient({ log: logOptions });
      }
      return kycClient;
    
    case 'notification':
      if (!notificationClient) {
        notificationClient = new NotificationPrismaClient({ log: logOptions });
      }
      return notificationClient;
    
    case 'optimove':
      if (!optimoveClient) {
        optimoveClient = new OptimovePrismaClient({ log: logOptions });
      }
      return optimoveClient;
    
    case 'pam':
      if (!pamClient) {
        pamClient = new PamPrismaClient({ log: logOptions });
      }
      return pamClient;
    
    case 'payment-gateway':
      if (!paymentGatewayClient) {
        paymentGatewayClient = new PaymentGatewayPrismaClient({ log: logOptions });
      }
      return paymentGatewayClient;
    
    case 'traffic':
      if (!trafficClient) {
        trafficClient = new TrafficPrismaClient({ log: logOptions });
      }
      return trafficClient;
    
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
    // All available services
    const services: DatabaseService[] = [
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
    ];
    
    // Initialize all clients and test connections
    const connectionPromises = services.map(async (service) => {
      try {
        const client = getPrismaClient(service);
        await client.$connect();
        console.log(`Connected to ${service} database successfully`);
        return { service, success: true };
      } catch (error) {
        console.error(`Failed to connect to ${service} database:`, error);
        return { service, success: false };
      }
    });
    
    const results = await Promise.all(connectionPromises);
    const successCount = results.filter(r => r.success).length;
    
    console.log(`Database connections established: ${successCount}/${services.length} successful`);
    
    if (successCount === 0) {
      throw new Error('Failed to connect to any databases');
    }
  } catch (error) {
    console.error('Failed to connect to databases:', error);
    throw error;
  }
};

/**
 * Disconnect from all database services
 * @returns Promise that resolves when all clients are disconnected
 */
export const disconnectAllDatabases = async (): Promise<void> => {
  const clients = [
    walletClient,
    betsHistoryClient,
    userActivitiesClient,
    financialHistoryClient,
    affiliateClient,
    casinoSt8Client,
    geolocationClient,
    kycClient,
    notificationClient,
    optimoveClient,
    pamClient,
    paymentGatewayClient,
    trafficClient
  ];
  
  const disconnectionPromises = clients
    .filter(client => client !== undefined)
    .map(async (client) => {
      try {
        await client?.$disconnect();
        return true;
      } catch (error) {
        console.error('Failed to disconnect client:', error);
        return false;
      }
    });
  
  await Promise.all(disconnectionPromises);
  console.log('All database connections closed successfully');
}; 