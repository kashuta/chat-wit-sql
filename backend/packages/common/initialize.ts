/**
 * SQL assistant initialization
 */
import fs from 'fs';
import path from 'path';

/**
 * Adds quotes to table names in the query if they are needed
 * @param query SQL query
 * @returns Corrected query
 */
const fixTableNames = (query: string): string => {
  // Regular expression to find table names after FROM and JOIN
  const regex = /\b(FROM|JOIN)\s+([A-Z][a-zA-Z0-9]*)\b(?!\s*AS)(?!\s*"\w+")/g;
  
  // Replace found table names, adding quotes
  return query.replace(regex, (match, keyword, tableName) => {
    // If the table name is already in quotes, leave it as is
    if (tableName.startsWith('"') && tableName.endsWith('"')) {
      return match;
    }
    return `${keyword} "${tableName}"`;
  });
};

/**
 * Updates queries in knowledge base examples, adding quotes to table names
 */
const updateDatabaseDescriptions = () => {
  const dbDescPath = path.join(process.cwd(), 'data', 'database-descriptions.json');
  if (!fs.existsSync(dbDescPath)) {
    console.warn('Database descriptions file not found:', dbDescPath);
    return;
  }
  
  try {
    const data = fs.readFileSync(dbDescPath, 'utf-8');
    const descriptions = JSON.parse(data);
    let modified = false;
    
    // Iterate over all databases
    for (const db of descriptions) {
      // Update queries in tables
      if (db.tables) {
        for (const table of db.tables) {
          if (table.examples) {
            for (const example of table.examples) {
              const fixedQuery = fixTableNames(example.query);
              if (fixedQuery !== example.query) {
                example.query = fixedQuery;
                modified = true;
              }
            }
          }
        }
      }
      
      // Update common queries
      if (db.commonQueries) {
        for (const query of db.commonQueries) {
          const fixedQuery = fixTableNames(query.query);
          if (fixedQuery !== query.query) {
            query.query = fixedQuery;
            modified = true;
          }
        }
      }
    }
    
    // If there were changes, save the updated data
    if (modified) {
      console.log('Updating database descriptions with fixed SQL queries...');
      fs.writeFileSync(dbDescPath, JSON.stringify(descriptions, null, 2), 'utf-8');
      console.log('Database descriptions updated successfully.');
    } else {
      console.log('No SQL queries needed to be fixed in database descriptions.');
    }
  } catch (error) {
    console.error('Error updating database descriptions:', error);
  }
};

/**
 * Application initialization
 */
export const initialize = async () => {
  console.log('Initializing SQL assistant...');
  
  // Update queries in the knowledge base
  updateDatabaseDescriptions();
  
  console.log('SQL assistant initialized.');
};
