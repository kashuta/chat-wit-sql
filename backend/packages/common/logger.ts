/**
 * Модуль логирования с поддержкой вывода на русском языке
 */

enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

const LOG_COLORS = {
  ERROR: '\x1b[31m', // Красный
  WARN: '\x1b[33m',  // Желтый
  INFO: '\x1b[36m',  // Голубой
  DEBUG: '\x1b[90m', // Серый
  RESET: '\x1b[0m',  // Сброс цвета
};

// Получение текущего уровня логирования из переменных окружения
const getCurrentLogLevel = (): LogLevel => {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  
  switch (level) {
    case 'error': return LogLevel.ERROR;
    case 'warn': return LogLevel.WARN;
    case 'info': return LogLevel.INFO;
    case 'debug': return LogLevel.DEBUG;
    default: return LogLevel.INFO; // По умолчанию INFO
  }
};

// Проверка, включено ли логирование на русском языке
const isRussianLoggingEnabled = (): boolean => {
  return process.env.ENABLE_RUSSIAN_LOGS === 'true';
};

/**
 * Логирование сообщения с определенным уровнем
 * @param message - Сообщение для логирования
 * @param level - Уровень логирования
 * @param extra - Дополнительные данные для логирования
 */
const log = (message: string, level: LogLevel, extra?: any): void => {
  const currentLevel = getCurrentLogLevel();
  
  if (level > currentLevel) {
    return; // Пропускаем сообщения с более высоким уровнем логирования
  }
  
  const timestamp = new Date().toISOString();
  let levelName: string;
  let colorCode: string;
  
  switch (level) {
    case LogLevel.ERROR:
      levelName = 'ОШИБКА';
      colorCode = LOG_COLORS.ERROR;
      break;
    case LogLevel.WARN:
      levelName = 'ВНИМАНИЕ';
      colorCode = LOG_COLORS.WARN;
      break;
    case LogLevel.INFO:
      levelName = 'ИНФО';
      colorCode = LOG_COLORS.INFO;
      break;
    case LogLevel.DEBUG:
      levelName = 'ОТЛАДКА';
      colorCode = LOG_COLORS.DEBUG;
      break;
  }
  
  const formattedMessage = `${colorCode}[${timestamp}] [${levelName}]${LOG_COLORS.RESET} ${message}`;
  
  switch (level) {
    case LogLevel.ERROR:
      console.error(formattedMessage);
      if (extra) console.error(extra);
      break;
    case LogLevel.WARN:
      console.warn(formattedMessage);
      if (extra) console.warn(extra);
      break;
    default:
      console.log(formattedMessage);
      if (extra) console.log(extra);
      break;
  }
};

/**
 * Логирование ошибки
 * @param message - Сообщение об ошибке
 * @param error - Объект ошибки (опционально)
 */
export const logError = (message: string, error?: any): void => {
  if (!isRussianLoggingEnabled()) {
    console.error(`[ERROR] ${message}`, error || '');
    return;
  }
  
  log(message, LogLevel.ERROR, error);
};

/**
 * Логирование предупреждения
 * @param message - Предупреждающее сообщение
 * @param extra - Дополнительные данные (опционально)
 */
export const logWarn = (message: string, extra?: any): void => {
  if (!isRussianLoggingEnabled()) {
    console.warn(`[WARN] ${message}`, extra || '');
    return;
  }
  
  log(message, LogLevel.WARN, extra);
};

/**
 * Логирование информационного сообщения
 * @param message - Информационное сообщение
 * @param extra - Дополнительные данные (опционально)
 */
export const logInfo = (message: string, extra?: any): void => {
  if (!isRussianLoggingEnabled()) {
    console.log(`[INFO] ${message}`, extra || '');
    return;
  }
  
  log(message, LogLevel.INFO, extra);
};

/**
 * Логирование отладочного сообщения
 * @param message - Отладочное сообщение
 * @param extra - Дополнительные данные (опционально)
 */
export const logDebug = (message: string, extra?: any): void => {
  if (!isRussianLoggingEnabled()) {
    console.log(`[DEBUG] ${message}`, extra || '');
    return;
  }
  
  log(message, LogLevel.DEBUG, extra);
}; 