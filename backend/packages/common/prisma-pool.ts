import { DatabaseService } from './types';
import { PrismaClient } from '@prisma/client';
import EventEmitter from 'events';

/**
 * Connection status for a database connection
 */
enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}

/**
 * Connection pool stats
 */
interface ConnectionPoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  connectionAttempts: number;
  connectionErrors: number;
  lastError?: Error;
  serviceStatus: Record<DatabaseService, ConnectionStatus>;
}

/**
 * Connection pool options
 */
interface ConnectionPoolOptions {
  maxConnections: number;
  idleTimeout: number;
  connectTimeout: number;
  retryDelay: number;
  maxRetries: number;
}

/**
 * Default connection pool options
 */
const DEFAULT_POOL_OPTIONS: ConnectionPoolOptions = {
  maxConnections: 10,
  idleTimeout: 30_000, // 30 seconds
  connectTimeout: 5_000, // 5 seconds
  retryDelay: 1_000, // 1 second
  maxRetries: 3,
};

/**
 * Database connection pool for managing Prisma connections
 */
export class PrismaConnectionPool extends EventEmitter {
  private clients: Map<DatabaseService, PrismaClient>;
  private statuses: Map<DatabaseService, ConnectionStatus>;
  private options: ConnectionPoolOptions;
  private stats: ConnectionPoolStats;
  private retryTimers: Map<DatabaseService, NodeJS.Timeout>;
  private retryCount: Map<DatabaseService, number>;
  private pingInterval?: NodeJS.Timeout;

  /**
   * Create a new PrismaConnectionPool
   * @param options Connection pool options
   */
  constructor(options?: Partial<ConnectionPoolOptions>) {
    super();
    this.clients = new Map();
    this.statuses = new Map();
    this.retryTimers = new Map();
    this.retryCount = new Map();
    this.options = { ...DEFAULT_POOL_OPTIONS, ...options };
    
    // Initialize stats
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      connectionAttempts: 0,
      connectionErrors: 0,
      serviceStatus: {
        'wallet': ConnectionStatus.DISCONNECTED,
        'bets-history': ConnectionStatus.DISCONNECTED,
        'user-activities': ConnectionStatus.DISCONNECTED,
        'financial-history': ConnectionStatus.DISCONNECTED,
        'affiliate': ConnectionStatus.DISCONNECTED,
        'casino-st8': ConnectionStatus.DISCONNECTED,
        'geolocation': ConnectionStatus.DISCONNECTED,
        'kyc': ConnectionStatus.DISCONNECTED,
        'notification': ConnectionStatus.DISCONNECTED,
        'optimove': ConnectionStatus.DISCONNECTED,
        'pam': ConnectionStatus.DISCONNECTED,
        'payment-gateway': ConnectionStatus.DISCONNECTED,
        'traffic': ConnectionStatus.DISCONNECTED,
      },
    };
    
    // Start ping interval to keep connections alive
    this.startPingInterval();
  }

  /**
   * Get or create a Prisma client for a service
   * @param service Database service
   * @returns Prisma client
   */
  public getClient(service: DatabaseService): PrismaClient {
    if (!this.clients.has(service)) {
      return this.createClient(service);
    }
    
    return this.clients.get(service)!;
  }

  /**
   * Get connection stats
   * @returns Connection pool stats
   */
  public getStats(): ConnectionPoolStats {
    return { ...this.stats };
  }

  /**
   * Connect to a database service
   * @param service Database service
   * @returns Whether the connection was successful
   */
  public async connect(service: DatabaseService): Promise<boolean> {
    if (this.statuses.get(service) === ConnectionStatus.CONNECTING) {
      return false; // Already connecting
    }
    
    this.stats.connectionAttempts++;
    this.statuses.set(service, ConnectionStatus.CONNECTING);
    this.stats.serviceStatus[service] = ConnectionStatus.CONNECTING;
    
    try {
      const client = this.getClient(service);
      await client.$connect();
      
      this.statuses.set(service, ConnectionStatus.CONNECTED);
      this.stats.serviceStatus[service] = ConnectionStatus.CONNECTED;
      this.stats.activeConnections++;
      this.retryCount.set(service, 0); // Reset retry count
      
      this.emit('connected', service);
      return true;
    } catch (error) {
      this.statuses.set(service, ConnectionStatus.ERROR);
      this.stats.serviceStatus[service] = ConnectionStatus.ERROR;
      this.stats.connectionErrors++;
      this.stats.lastError = error as Error;
      
      const retries = (this.retryCount.get(service) || 0) + 1;
      this.retryCount.set(service, retries);
      
      this.emit('error', service, error);
      
      // Schedule retry if below max retries
      if (retries <= this.options.maxRetries) {
        this.scheduleRetry(service);
      }
      
      return false;
    }
  }

  /**
   * Disconnect from a database service
   * @param service Database service
   */
  public async disconnect(service: DatabaseService): Promise<void> {
    if (this.statuses.get(service) === ConnectionStatus.CONNECTED) {
      const client = this.clients.get(service);
      if (client) {
        await client.$disconnect();
        this.stats.activeConnections--;
      }
    }
    
    this.statuses.set(service, ConnectionStatus.DISCONNECTED);
    this.stats.serviceStatus[service] = ConnectionStatus.DISCONNECTED;
    this.emit('disconnected', service);
    
    // Cancel any pending retry
    if (this.retryTimers.has(service)) {
      clearTimeout(this.retryTimers.get(service));
      this.retryTimers.delete(service);
    }
  }

  /**
   * Connect to all database services
   * @returns Map of service to connection status
   */
  public async connectAll(): Promise<Map<DatabaseService, boolean>> {
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
    
    const results = new Map<DatabaseService, boolean>();
    
    for (const service of services) {
      results.set(service, await this.connect(service));
    }
    
    return results;
  }

  /**
   * Disconnect from all database services
   */
  public async disconnectAll(): Promise<void> {
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
    
    for (const service of services) {
      await this.disconnect(service);
    }
    
    // Stop ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }

  /**
   * Check if a database service is connected
   * @param service Database service
   * @returns Whether the service is connected
   */
  public isConnected(service: DatabaseService): boolean {
    return this.statuses.get(service) === ConnectionStatus.CONNECTED;
  }

  /**
   * Create a new Prisma client for a service
   * @param service Database service
   * @returns Prisma client
   */
  private createClient(service: DatabaseService): PrismaClient {
    let client: PrismaClient;
    
    // Create client based on service type
    switch (service) {
      case 'wallet':
        client = new PrismaClient({
          datasources: {
            db: {
              url: process.env.DATABASE_URL_WALLET,
            },
          },
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
        break;
      
      case 'bets-history':
        client = new PrismaClient({
          datasources: {
            db: {
              url: process.env.DATABASE_URL_BETS_HISTORY,
            },
          },
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
        break;
      
      case 'user-activities':
        client = new PrismaClient({
          datasources: {
            db: {
              url: process.env.DATABASE_URL_USER_ACTIVITIES,
            },
          },
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
        break;
      
      case 'financial-history':
        client = new PrismaClient({
          datasources: {
            db: {
              url: process.env.DATABASE_URL_FINANCIAL_HISTORY,
            },
          },
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
        break;
      
      case 'affiliate':
        client = new PrismaClient({
          datasources: {
            db: {
              url: process.env.DATABASE_URL_AFFILIATE,
            },
          },
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
        break;
      
      case 'casino-st8':
        client = new PrismaClient({
          datasources: {
            db: {
              url: process.env.DATABASE_URL_CASINO_ST8,
            },
          },
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
        break;
      
      case 'geolocation':
        client = new PrismaClient({
          datasources: {
            db: {
              url: process.env.DATABASE_URL_GEOLOCATION,
            },
          },
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
        break;
      
      case 'kyc':
        client = new PrismaClient({
          datasources: {
            db: {
              url: process.env.DATABASE_URL_KYC,
            },
          },
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
        break;
      
      case 'notification':
        client = new PrismaClient({
          datasources: {
            db: {
              url: process.env.DATABASE_URL_NOTIFICATION,
            },
          },
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
        break;
      
      case 'optimove':
        client = new PrismaClient({
          datasources: {
            db: {
              url: process.env.DATABASE_URL_OPTIMOVE,
            },
          },
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
        break;
      
      case 'pam':
        client = new PrismaClient({
          datasources: {
            db: {
              url: process.env.DATABASE_URL_PAM,
            },
          },
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
        break;
      
      case 'payment-gateway':
        client = new PrismaClient({
          datasources: {
            db: {
              url: process.env.DATABASE_URL_PAYMENT_GATEWAY,
            },
          },
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
        break;
      
      case 'traffic':
        client = new PrismaClient({
          datasources: {
            db: {
              url: process.env.DATABASE_URL_TRAFFIC,
            },
          },
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
        break;
      
      default:
        throw new Error(`Unsupported database service: ${service}`);
    }
    
    this.clients.set(service, client);
    this.statuses.set(service, ConnectionStatus.DISCONNECTED);
    this.stats.totalConnections++;
    
    return client;
  }

  /**
   * Schedule a connection retry
   * @param service Database service
   */
  private scheduleRetry(service: DatabaseService): void {
    // Cancel any existing retry timer
    if (this.retryTimers.has(service)) {
      clearTimeout(this.retryTimers.get(service));
    }
    
    // Calculate delay based on retry count (exponential backoff)
    const retryCount = this.retryCount.get(service) || 0;
    const delay = this.options.retryDelay * Math.pow(2, retryCount - 1);
    
    // Schedule retry
    const timer = setTimeout(async () => {
      this.retryTimers.delete(service);
      await this.connect(service);
    }, delay);
    
    this.retryTimers.set(service, timer);
    this.emit('retry', service, retryCount, delay);
  }

  /**
   * Start ping interval to keep connections alive
   */
  private startPingInterval(): void {
    const PING_INTERVAL = 5 * 60 * 1000; // 5 minutes
    
    this.pingInterval = setInterval(async () => {
      const services = Array.from(this.clients.keys());
      
      for (const service of services) {
        if (this.isConnected(service)) {
          try {
            // Execute a simple query to keep the connection alive
            const client = this.clients.get(service)!;
            await client.$queryRaw`SELECT 1`;
          } catch (error) {
            // Connection might be dead, attempt to reconnect
            this.stats.serviceStatus[service] = ConnectionStatus.ERROR;
            await this.connect(service);
          }
        }
      }
    }, PING_INTERVAL);
  }
}

// Singleton instance
let connectionPool: PrismaConnectionPool | undefined;

/**
 * Get the connection pool instance
 * @param options Connection pool options
 * @returns Connection pool instance
 */
export const getConnectionPool = (options?: Partial<ConnectionPoolOptions>): PrismaConnectionPool => {
  if (!connectionPool) {
    connectionPool = new PrismaConnectionPool(options);
  }
  return connectionPool;
}; 