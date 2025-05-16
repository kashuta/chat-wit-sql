# Table Conflict Resolution Module

Модуль для обнаружения и разрешения конфликтов таблиц в микросервисной архитектуре приложения chat-with-sql.

## Описание

В микросервисном приложении chat-with-sql несколько сервисов могут содержать таблицы с одинаковыми названиями (например, таблица Transaction существует и в wallet, и в payment-gateway). Это приводит к ошибкам при попытке выполнения распределенных запросов.

Данный модуль решает эту проблему путём:
1. Обнаружения конфликтов таблиц в плане запроса
2. Оценки вероятности ошибки из-за конфликта
3. Разрешения конфликтов с помощью LLM (Language Model)

## Компоненты

### ConflictDetector

Основной класс для обнаружения конфликтов между таблицами различных сервисов:

```typescript
const detector = new ConflictDetector();
const result = detector.detectPlanConflicts(plan);
```

### ConflictDetectionChain

Цепочка для разрешения конфликтов с использованием LLM:

```typescript
const chain = new ConflictDetectionChain({ verbose: true });
const result = await chain.run({ plan, query });
```

## Интеграция с планированием

Модуль интегрирован с процессом планирования запросов в `backend/packages/planning/index.ts`. После создания плана запроса автоматически происходит проверка на конфликты и их разрешение.

## Демонстрационный пример

Для тестирования функциональности можно запустить демонстрационный пример:

```bash
npx ts-node -r tsconfig-paths/register backend/packages/conflict-resolution/demo.ts
```

## API

### Функции

- `detectConflictsInPlan(plan, query)` - обнаружение конфликтов в плане запроса
- `resolveConflictsInPlan(plan, query, verbose)` - разрешение конфликтов в плане запроса

### Интерфейсы

- `TableConflict` - информация о конфликте таблиц
- `ConflictDetectionResult` - результат обнаружения конфликтов
- `ConflictDetectionInput` - входные данные для разрешения конфликтов
- `ConflictDetectionOutput` - результат разрешения конфликтов

## Пример использования

```typescript
import { detectConflictsInPlan, resolveConflictsInPlan } from '@conflict-resolution';

// Проверяем на конфликты
const detectionResult = await detectConflictsInPlan(plan, userQuery);

if (detectionResult.hasConflicts) {
  console.log(`Found conflicts with probability: ${detectionResult.errorProbability}`);
  
  // Пытаемся разрешить конфликты
  const resolutionResult = await resolveConflictsInPlan(plan, userQuery);
  
  if (resolutionResult.amended) {
    console.log('Plan was amended successfully.');
    // Используем скорректированный план
    const resolvedPlan = resolutionResult.resolvedPlan;
  }
}
``` 