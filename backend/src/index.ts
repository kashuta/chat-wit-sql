import dotenv from 'dotenv';
import { startServer } from './server';
import { setupDatabaseConnections } from '@execution/database';
import { initialize, shutdown } from '@common/initialize';
import { logInfo, logError } from '@common/logger';

// Load environment variables
dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);

const main = async () => {
  try {
    // Инициализация компонентов (включая загрузку данных о БД)
    await initialize();
    
    // Set up database connections
    await setupDatabaseConnections();
    
    // Запуск HTTP сервера
    await startServer(PORT);
    logInfo(`Server running on port ${PORT}`);
    
    // Регистрация обработчиков для корректного завершения работы
    const handleShutdown = async () => {
      logInfo('Shutting down server...');
      
      try {
        await shutdown();
        logInfo('Server shutdown complete.');
        process.exit(0);
      } catch (error) {
        logError(`Error during shutdown: ${(error as Error).message}`);
        process.exit(1);
      }
    };
    
    // Обрабатываем сигналы завершения
    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);
    process.on('SIGUSR2', handleShutdown); // Nodemon restart
    
    // Обрабатываем необработанные исключения
    process.on('uncaughtException', (error) => {
      logError(`Uncaught exception: ${error.message}`);
      logError(error.stack || 'No stack trace');
      handleShutdown();
    });
    
    // Обрабатываем необработанные отклоненные промисы
    process.on('unhandledRejection', (reason, _promise) => {
      logError(`Unhandled promise rejection: ${reason}`);
      handleShutdown();
    });
    
  } catch (error) {
    logError(`Failed to start server: ${(error as Error).message}`);
    process.exit(1);
  }
};

main(); 