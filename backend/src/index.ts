import dotenv from 'dotenv';
import { startServer } from './server';
import { setupDatabaseConnections } from '@execution/database';

// Load environment variables
dotenv.config();

// Initialize the application
const initApp = async (): Promise<void> => {
  try {
    // Set up database connections
    await setupDatabaseConnections();
    
    // Start the server
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    await startServer(port);
    console.log(`Server running on port ${port}`);
  } catch (err: Error | unknown) {
    console.error('Failed to initialize application:', err);
    process.exit(1);
  }
};

// Handle graceful shutdown
const handleShutdown = (): void => {
  console.log('Shutting down gracefully...');
  // Add cleanup logic here (close DB connections, etc.)
  process.exit(0);
};

// Register shutdown handlers
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

// Start the application
initApp().catch(err => {
  console.error('Unhandled error during initialization:', err);
  process.exit(1);
}); 