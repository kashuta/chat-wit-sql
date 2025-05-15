/**
 * Модуль логирования с поддержкой вывода на русском языке и записи в файл
 */
import fs from 'fs';
import path from 'path';

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

// Папка для хранения логов
const LOG_DIR = path.join(process.cwd(), 'logs');

// Создаем директорию для логов, если она не существует
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (error) {
  console.error('Не удалось создать директорию для логов:', error);
}

// Пути к файлам логов
const LOG_FILES = {
  ERROR: path.join(LOG_DIR, 'error.log'),
  WARN: path.join(LOG_DIR, 'warn.log'),
  INFO: path.join(LOG_DIR, 'info.log'),
  DEBUG: path.join(LOG_DIR, 'debug.log'),
  ALL: path.join(LOG_DIR, 'all.log'),
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

// Проверка, включена ли запись логов в файл
const isFileLoggingEnabled = (): boolean => {
  return process.env.ENABLE_FILE_LOGS !== 'false'; // По умолчанию включено
};

/**
 * Запись сообщения в файл лога
 * @param message - Сообщение для записи
 * @param level - Уровень логирования
 * @param extra - Дополнительные данные
 */
const writeToLogFile = (message: string, level: LogLevel, extra?: any): void => {
  if (!isFileLoggingEnabled()) return;
  
  const timestamp = new Date().toISOString();
  let levelName: string;
  let logFile: string;
  
  switch (level) {
    case LogLevel.ERROR:
      levelName = 'ERROR';
      logFile = LOG_FILES.ERROR;
      break;
    case LogLevel.WARN:
      levelName = 'WARN';
      logFile = LOG_FILES.WARN;
      break;
    case LogLevel.INFO:
      levelName = 'INFO';
      logFile = LOG_FILES.INFO;
      break;
    case LogLevel.DEBUG:
      levelName = 'DEBUG';
      logFile = LOG_FILES.DEBUG;
      break;
    default:
      levelName = 'UNKNOWN';
      logFile = LOG_FILES.ALL;
      break;
  }
  
  const logEntry = `[${timestamp}] [${levelName}] ${message}${extra ? '\n' + JSON.stringify(extra, null, 2) : ''}\n`;
  
  // Запись в файл конкретного уровня логирования
  try {
    fs.appendFileSync(logFile, logEntry);
  } catch (error) {
    console.error(`Не удалось записать в файл лога ${logFile}:`, error);
  }
  
  // Дублирование в общий файл логов
  try {
    fs.appendFileSync(LOG_FILES.ALL, logEntry);
  } catch (error) {
    console.error(`Не удалось записать в общий файл лога:`, error);
  }
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
  
  // Запись в файл
  writeToLogFile(message, level, extra);
};

/**
 * Логирование ошибки
 * @param message - Сообщение об ошибке
 * @param error - Объект ошибки (опционально)
 */
export const logError = (message: string, error?: any): void => {
  if (!isRussianLoggingEnabled()) {
    console.error(`[ERROR] ${message}`, error || '');
    writeToLogFile(message, LogLevel.ERROR, error);
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
    writeToLogFile(message, LogLevel.WARN, extra);
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
    writeToLogFile(message, LogLevel.INFO, extra);
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
    writeToLogFile(message, LogLevel.DEBUG, extra);
    return;
  }
  
  log(message, LogLevel.DEBUG, extra);
}; 