# Установка и настройка Chat with SQL

В этом документе описаны детальные шаги для установки, настройки и запуска системы Chat with SQL.

## Требования

Перед началом установки убедитесь, что ваша система соответствует следующим требованиям:

### Обязательные компоненты
- Node.js 16+ (рекомендуется 18+)
- npm 7+ (или yarn/pnpm)
- Redis 6.2+
- PostgreSQL 14+ (для локальной разработки, опционально)

### Рекомендуемые компоненты
- Docker и Docker Compose (для запуска Redis и баз данных в контейнерах)
- Git для работы с репозиторием
- VS Code или другой редактор с поддержкой TypeScript

## Шаги установки

### 1. Клонирование репозитория

```bash
git clone https://github.com/kashuta/chat-wit-sql.git
cd chat-wit-sql
```

### 2. Установка зависимостей

```bash
# Установка зависимостей для всего проекта
npm install

# Или отдельно для бэкенда и фронтенда
npm install --workspace=backend
npm install --workspace=frontend
```

### 3. Настройка окружения

#### 3.1. Создание файла переменных окружения

Скопируйте пример файла окружения и настройте его:

```bash
cp .env.example .env
```

Откройте файл `.env` и заполните следующие параметры:

```
# OpenAI
OPENAI_API_KEY=your_openai_api_key

# Redis
REDIS_URL=redis://localhost:6379

# Базы данных (пример для локальной разработки)
DB_HOST_WALLET=localhost
DB_PORT_WALLET=5432
DB_NAME_WALLET=wallet
DB_USER_WALLET=postgres
DB_PASSWORD_WALLET=postgres

# Аналогично настройте для других сервисов
```

#### 3.2. Запуск Redis и БД в Docker (опционально)

Для локальной разработки можно использовать Docker:

```bash
# Запуск Redis
docker run --name redis -p 6379:6379 -d redis:6.2

# Запуск PostgreSQL (пример для одной БД)
docker run --name postgres -p 5432:5432 -e POSTGRES_PASSWORD=postgres -d postgres:14
```

### 4. Генерация Prisma-клиентов

```bash
cd backend
npm run prisma:generate
```

### 5. Интроспекция баз данных (если они уже существуют)

```bash
# Интроспекция для всех БД
npm run prisma:introspect:all

# Или для отдельных сервисов
npm run prisma:introspect:wallet
npm run prisma:introspect:bets
```

## Запуск системы

### Режим разработки

Запуск всего проекта в режиме разработки:

```bash
npm run dev
```

Или запуск отдельных частей:

```bash
# Только бэкенд
npm run dev:backend

# Только фронтенд
npm run dev:frontend
```

Сервисы будут доступны по адресам:
- Бэкенд: http://localhost:3000
- Фронтенд: http://localhost:3002

### Режим production

Для production-запуска необходимо сначала собрать проект:

```bash
# Сборка всего проекта
npm run build

# Запуск в production-режиме
npm start
```

## Тестирование

### Выполнение тестов

```bash
# Запуск всех тестов
npm test

# Запуск тестов с режимом watch
npm run test:watch
```

### Ручное тестирование API

Вы можете использовать Postman или curl для тестирования API:

```bash
# Пример запроса через curl
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"query":"покажи последние 5 транзакций пользователя с id 1234"}'
```

## Доступ к базам данных

Для прямого доступа к базам данных можно использовать:

```bash
# Запуск Prisma Studio (графический интерфейс для БД)
npm run prisma:studio
```

## Решение проблем

### Redis недоступен

Если возникают проблемы с подключением к Redis:

1. Проверьте, что Redis запущен:
   ```bash
   redis-cli ping
   ```

2. Убедитесь, что порт доступен:
   ```bash
   netstat -an | grep 6379
   ```

3. Проверьте правильность URL в .env файле

### Проблемы с базами данных

1. Проверьте подключение к конкретной БД:
   ```bash
   npm run db:connect
   ```

2. Если соединения нестабильны, увеличьте таймауты подключения в файле `backend/packages/common/prisma-pool.ts`

## Дополнительные команды

- `npm run lint` - Запуск линтера для проверки кода
- `npm run lint:fix` - Автоматическое исправление ошибок линтера
- `npm run format` - Форматирование кода с помощью Prettier
- `npm run clean` - Очистка сборочных директорий 