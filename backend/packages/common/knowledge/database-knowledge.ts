import fs from 'fs';
import { logError, logInfo, logWarn } from '../logger';

/**
 * Структура описания таблицы базы данных
 */
export interface TableDescription {
  name: string;
  description: string;
  columns: {
    name: string;
    type: string;
    description: string;
    isPrimaryKey?: boolean;
    isUnique?: boolean;
    isNullable?: boolean;
    isForeignKey?: boolean;
    references?: {
      table: string;
      column: string;
    };
  }[];
  relations?: {
    type: 'oneToOne' | 'oneToMany' | 'manyToOne' | 'manyToMany';
    table: string;
    sourceColumn: string;
    targetColumn: string;
    description: string;
  }[];
  examples?: {
    description: string;
    query: string;
  }[];
}

/**
 * Структура описания базы данных
 */
export interface DatabaseDescription {
  name: string;
  service: string;
  description: string;
  tables: TableDescription[];
  commonQueries?: {
    description: string;
    query: string;
  }[];
}

/**
 * Хранилище знаний о базах данных
 */
class DatabaseKnowledge {
  private descriptions: Map<string, DatabaseDescription> = new Map();
  private tableMap: Map<string, TableDescription> = new Map();
  private loaded: boolean = false;
  private knowledgeFilePath: string = '';

  /**
   * Загрузить описания баз данных из файла
   * @param filePath - путь к файлу с описаниями
   */
  public async loadFromFile(filePath: string): Promise<void> {
    try {
      this.knowledgeFilePath = filePath;
      
      if (!fs.existsSync(filePath)) {
        logWarn(`Database knowledge file not found at ${filePath}`);
        return;
      }
      
      const data = await fs.promises.readFile(filePath, 'utf-8');
      const descriptions = JSON.parse(data) as DatabaseDescription[];
      
      // Очистить существующие описания
      this.descriptions.clear();
      this.tableMap.clear();
      
      // Заполнить хранилище 
      descriptions.forEach(desc => {
        this.descriptions.set(desc.service, desc);
        
        // Создать карту таблиц для быстрого доступа
        desc.tables.forEach(table => {
          this.tableMap.set(`${desc.service}.${table.name}`, table);
        });
      });
      
      this.loaded = true;
      logInfo(`Loaded database knowledge from ${filePath}: ${descriptions.length} databases, ${this.tableMap.size} tables`);
    } catch (error) {
      logError(`Failed to load database knowledge from ${filePath}: ${error}`);
      throw error;
    }
  }
  
  /**
   * Обновить описания баз данных на основе данных Prisma
   * Эту функцию можно расширить в будущем для автоматического анализа схем
   */
  public async updateFromPrisma(): Promise<void> {
    // TODO: Реализовать автоматическое обновление описаний на основе интроспекции Prisma
    logInfo('Automatic database schema discovery is not implemented yet');
  }
  
  /**
   * Получить описание всех баз данных
   */
  public getAllDatabases(): DatabaseDescription[] {
    if (!this.loaded) {
      logWarn('Database descriptions are not loaded yet');
      return [];
    }
    
    return Array.from(this.descriptions.values());
  }
  
  /**
   * Получить описание конкретной базы данных
   * @param service - идентификатор сервиса базы данных
   */
  public getDatabaseDescription(service: string): DatabaseDescription | undefined {
    return this.descriptions.get(service);
  }
  
  /**
   * Получить описание конкретной таблицы
   * @param service - идентификатор сервиса базы данных
   * @param tableName - имя таблицы
   */
  public getTableDescription(service: string, tableName: string): TableDescription | undefined {
    return this.tableMap.get(`${service}.${tableName}`);
  }
  
  /**
   * Получить текстовое описание баз данных для контекста модели LLM
   */
  public getDatabaseDescriptionsForLLM(): string {
    if (!this.loaded) {
      return 'Database descriptions are not loaded yet.';
    }
    
    let result = 'AVAILABLE DATABASE SERVICES:\n\n';
    
    this.descriptions.forEach(db => {
      result += `- "${db.service}": ${db.description}\n`;
      result += `  Tables: ${db.tables.map(t => t.name).join(', ')}\n\n`;
    });
    
    return result;
  }
  
  /**
   * Получить подробное текстовое описание баз данных для контекста модели LLM
   */
  public getDetailedDatabaseDescriptionsForLLM(): string {
    if (!this.loaded) {
      return 'Database descriptions are not loaded yet.';
    }
    
    let result = 'AVAILABLE DATABASE SERVICES AND TABLES:\n\n';
    
    this.descriptions.forEach(db => {
      result += `## "${db.service}": ${db.description}\n\n`;
      
      db.tables.forEach(table => {
        result += `### Table: ${table.name}\n`;
        result += `${table.description}\n\n`;
        
        result += "Columns:\n";
        table.columns.forEach(col => {
          const flags = [
            col.isPrimaryKey ? 'PK' : '',
            col.isUnique ? 'UNIQUE' : '',
            col.isNullable ? 'NULL' : 'NOT NULL',
            col.isForeignKey ? 'FK' : ''
          ].filter(Boolean).join(', ');
          
          result += `- ${col.name} (${col.type}${flags ? ` ${flags}` : ''}): ${col.description}\n`;
        });
        
        if (table.examples && table.examples.length > 0) {
          result += "\nExample queries:\n";
          table.examples.forEach(ex => {
            result += `- ${ex.description}: \`${ex.query}\`\n`;
          });
        }
        
        result += '\n';
      });
      
      result += '\n';
    });
    
    return result;
  }

  /**
   * Проверить, загружены ли описания баз данных
   */
  public isLoaded(): boolean {
    return this.loaded;
  }
  
  /**
   * Перезагрузить описания баз данных
   */
  public async reload(): Promise<void> {
    if (!this.knowledgeFilePath) {
      logWarn('Cannot reload database knowledge: file path is not set');
      return;
    }
    
    await this.loadFromFile(this.knowledgeFilePath);
  }
}

// Экспортируем синглтон
export const databaseKnowledge = new DatabaseKnowledge();
