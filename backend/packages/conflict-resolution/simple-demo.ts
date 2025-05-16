/**
 * Простой демонстрационный скрипт для проверки концепции обнаружения конфликтов
 */

// Тип сервиса базы данных (упрощенная версия)
type DatabaseService = 'wallet' | 'payment-gateway';

// Структура плана запроса
interface QueryPlan {
  steps: Array<{
    service: DatabaseService;
    description: string;
    sqlQuery?: string;
  }>;
  requiredServices: DatabaseService[];
}

// Структура информации о таблице
interface TableDescription {
  name: string;
  description: string;
  columns: Array<{
    name: string;
    type: string;
    description: string;
  }>;
}

// Структура описания базы данных
interface DatabaseDescription {
  service: DatabaseService;
  name: string;
  description: string;
  tables: TableDescription[];
}

// Структура конфликта таблиц
interface TableConflict {
  tableName: string;
  services: DatabaseService[];
  schemas: Record<string, TableDescription>;
}

// Структура результата обнаружения конфликтов
interface ConflictDetectionResult {
  conflicts: TableConflict[];
  hasConflicts: boolean;
  suggestedResolution?: string;
  errorProbability: 'high' | 'medium' | 'low';
}

/**
 * Класс для обнаружения конфликтов таблиц
 */
class ConflictDetector {
  private databaseMetadata: DatabaseDescription[];
  private tableServiceMap: Map<string, DatabaseService[]> = new Map();
  private tableSchemaMap: Map<string, Record<string, TableDescription>> = new Map();
  
  constructor(databaseMetadata: DatabaseDescription[]) {
    this.databaseMetadata = databaseMetadata;
    this.buildTableMaps();
    console.log(`ConflictDetector initialized with ${this.databaseMetadata.length} database services`);
  }
  
  /**
   * Строит карты таблиц для быстрого поиска конфликтов
   */
  private buildTableMaps(): void {
    for (const db of this.databaseMetadata) {
      const service = db.service;
      
      for (const table of db.tables) {
        const tableName = table.name;
        
        // Добавляем сервис в список сервисов для этой таблицы
        if (!this.tableServiceMap.has(tableName)) {
          this.tableServiceMap.set(tableName, []);
          this.tableSchemaMap.set(tableName, {});
        }
        
        this.tableServiceMap.get(tableName)?.push(service);
        this.tableSchemaMap.get(tableName)![service] = table;
      }
    }
    
    console.log(`Built table maps with ${this.tableServiceMap.size} unique table names`);
  }
  
  /**
   * Определяет, имеет ли таблица конфликты (присутствует в нескольких сервисах)
   */
  public detectTableConflicts(tableName: string): TableConflict | null {
    const services = this.tableServiceMap.get(tableName);
    
    if (!services || services.length <= 1) {
      return null;
    }
    
    const schemas = this.tableSchemaMap.get(tableName) || {};
    
    console.log(`Detected conflict for table "${tableName}" across services: ${services.join(', ')}`);
    
    return {
      tableName,
      services,
      schemas
    };
  }
  
  /**
   * Извлекает имена таблиц из SQL-запроса
   */
  private extractTableNamesFromSql(sql: string): string[] {
    const tables: string[] = [];
    
    // Простой алгоритм извлечения имен таблиц из SQL
    // Находим все совпадения после FROM и JOIN
    
    // Находим таблицы после FROM
    const fromRegex = /FROM\s+["`']?([a-zA-Z0-9_]+)["`']?/gi;
    let match;
    while ((match = fromRegex.exec(sql)) !== null) {
      tables.push(match[1]);
    }
    
    // Находим таблицы после JOIN
    const joinRegex = /JOIN\s+["`']?([a-zA-Z0-9_]+)["`']?/gi;
    while ((match = joinRegex.exec(sql)) !== null) {
      tables.push(match[1]);
    }
    
    return [...new Set(tables)]; // Убираем дубликаты
  }
  
  /**
   * Проверяет план запроса на наличие конфликтов между таблицами
   */
  public detectPlanConflicts(plan: QueryPlan): ConflictDetectionResult {
    const conflicts: TableConflict[] = [];
    const tablesInPlan = new Set<string>();
    
    // Извлекаем имена таблиц из SQL-запросов в плане
    for (const step of plan.steps) {
      if (step.sqlQuery) {
        const tableNames = this.extractTableNamesFromSql(step.sqlQuery);
        tableNames.forEach(table => tablesInPlan.add(table));
      }
    }
    
    // Проверяем каждую таблицу на конфликты
    for (const tableName of tablesInPlan) {
      const conflict = this.detectTableConflicts(tableName);
      if (conflict) {
        conflicts.push(conflict);
      }
    }
    
    // Определяем вероятность ошибки
    let errorProbability: 'high' | 'medium' | 'low' = 'low';
    if (conflicts.length > 0) {
      // Если есть конфликты между сервисами, указанными в плане, вероятность ошибки высокая
      const servicesInPlan = new Set(plan.requiredServices);
      
      const hasCrossServiceConflict = conflicts.some(conflict => {
        const conflictingServicesInPlan = conflict.services.filter(service => 
          servicesInPlan.has(service)
        );
        return conflictingServicesInPlan.length > 1;
      });
      
      errorProbability = hasCrossServiceConflict ? 'high' : 'medium';
    }
    
    // Формируем рекомендации по разрешению конфликтов
    let suggestedResolution: string | undefined;
    if (conflicts.length > 0) {
      suggestedResolution = this.createResolutionSuggestion(conflicts, plan);
    }
    
    return {
      conflicts,
      hasConflicts: conflicts.length > 0,
      suggestedResolution,
      errorProbability
    };
  }
  
  /**
   * Создает предложение по разрешению конфликтов
   */
  private createResolutionSuggestion(conflicts: TableConflict[], plan: QueryPlan): string {
    let suggestion = 'Рекомендации по разрешению конфликтов:\n\n';
    
    for (const conflict of conflicts) {
      suggestion += `* Таблица "${conflict.tableName}" присутствует в нескольких сервисах: ${conflict.services.join(', ')}.\n`;
      
      // Рекомендации по уточнению сервиса
      suggestion += `  - Рекомендуется явно указать сервис в запросе или использовать полностью квалифицированные имена таблиц.\n`;
      
      // Определяем сервис на основе контекста запроса
      const suggestedService = this.suggestServiceBasedOnContext(conflict, plan);
      if (suggestedService) {
        suggestion += `  - На основе контекста запроса, вероятно, вы ищете таблицу "${conflict.tableName}" из сервиса "${suggestedService}".\n`;
      }
      
      suggestion += '\n';
    }
    
    return suggestion;
  }
  
  /**
   * Предлагает наиболее вероятный сервис на основе контекста запроса
   */
  private suggestServiceBasedOnContext(conflict: TableConflict, plan: QueryPlan): DatabaseService | undefined {
    // Если в плане указан только один сервис из конфликтующих, предлагаем его
    const servicesInPlan = new Set(plan.requiredServices);
    const conflictingServicesInPlan = conflict.services.filter(service => 
      servicesInPlan.has(service)
    );
    
    if (conflictingServicesInPlan.length === 1) {
      return conflictingServicesInPlan[0];
    }
    
    // Если в плане указано несколько конфликтующих сервисов, пытаемся определить на основе других таблиц
    if (conflictingServicesInPlan.length > 1) {
      // Пока простая эвристика: возвращаем первый сервис из списка
      return conflictingServicesInPlan[0];
    }
    
    // Если нет конфликтующих сервисов в плане, возвращаем первый из списка конфликтующих
    return conflict.services[0];
  }
}

// Пример метаданных баз данных
const mockDatabaseMetadata: DatabaseDescription[] = [
  {
    service: 'wallet',
    name: 'Wallet Database',
    description: 'База данных кошелька',
    tables: [
      {
        name: 'Transaction',
        description: 'Транзакции пользователя',
        columns: [
          { name: 'id', type: 'int', description: 'ID транзакции' },
          { name: 'userId', type: 'int', description: 'ID пользователя' },
          { name: 'amount', type: 'decimal', description: 'Сумма транзакции' },
          { name: 'type', type: 'string', description: 'Тип транзакции' }
        ]
      }
    ]
  },
  {
    service: 'payment-gateway',
    name: 'Payment Gateway Database',
    description: 'База данных платежного шлюза',
    tables: [
      {
        name: 'Transaction',
        description: 'Платежные транзакции',
        columns: [
          { name: 'id', type: 'string', description: 'ID транзакции' },
          { name: 'userId', type: 'int', description: 'ID пользователя' },
          { name: 'amount', type: 'int', description: 'Сумма транзакции' },
          { name: 'status', type: 'string', description: 'Статус транзакции' }
        ]
      }
    ]
  }
];

// Пример плана запроса с потенциальным конфликтом
const samplePlan: QueryPlan = {
  steps: [
    {
      service: 'wallet',
      description: 'Получить информацию о транзакциях пользователя',
      sqlQuery: 'SELECT * FROM Transaction WHERE userId = 123 LIMIT 10'
    },
    {
      service: 'payment-gateway',
      description: 'Получить детали платежных методов',
      sqlQuery: 'SELECT * FROM Transaction WHERE userId = 123 LIMIT 10'
    }
  ],
  requiredServices: ['wallet', 'payment-gateway']
};

// Главная функция для демонстрации
const runDemo = async () => {
  console.log('Starting conflict detection demo...');
  
  // Инициализируем детектор конфликтов с mock-данными
  const detector = new ConflictDetector(mockDatabaseMetadata);
  
  // Проверяем на конфликты
  console.log('\nChecking for conflicts in the plan...');
  const detectionResult = detector.detectPlanConflicts(samplePlan);
  
  if (detectionResult.hasConflicts) {
    console.log(`Found ${detectionResult.conflicts.length} conflicts with probability: ${detectionResult.errorProbability}`);
    console.log('Conflicts:');
    detectionResult.conflicts.forEach(conflict => {
      console.log(`- Table "${conflict.tableName}" exists in services: ${conflict.services.join(', ')}`);
    });
    
    if (detectionResult.suggestedResolution) {
      console.log('\nSuggested resolution:');
      console.log(detectionResult.suggestedResolution);
    }
  } else {
    console.log('No conflicts detected in the plan.');
  }
};

// Запускаем демо
runDemo().catch(err => {
  console.error('Error running demo:', err);
}); 