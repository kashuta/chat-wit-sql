#!/usr/bin/env node

/**
 * Script to create database migrations for service schemas
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// Path to service schema files
const SERVICES_DIR = path.join(__dirname, '../prisma/services');

// Check if directory exists
if (!fs.existsSync(SERVICES_DIR)) {
  console.error(`Services directory not found: ${SERVICES_DIR}`);
  process.exit(1);
}

// Get all .prisma files in the services directory
const schemaFiles = fs.readdirSync(SERVICES_DIR)
  .filter(file => file.endsWith('.prisma'))
  .map(file => path.join(SERVICES_DIR, file));

if (schemaFiles.length === 0) {
  console.error('No Prisma schema files found in services directory');
  process.exit(1);
}

// Create a readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Ask which service to create a migration for
console.log('Available services:');
schemaFiles.forEach((file, index) => {
  const serviceName = path.basename(file, '.prisma');
  console.log(`${index + 1}. ${serviceName}`);
});

rl.question('Select a service number (or "all" for all services): ', (answer) => {
  const selectedFiles = answer.toLowerCase() === 'all' 
    ? schemaFiles 
    : [schemaFiles[parseInt(answer, 10) - 1]];
  
  if (!selectedFiles[0]) {
    console.error('Invalid selection');
    rl.close();
    process.exit(1);
  }
  
  rl.question('Enter migration name: ', (migrationName) => {
    // Create migrations for selected schemas
    selectedFiles.forEach(schemaFile => {
      const serviceName = path.basename(schemaFile, '.prisma');
      console.log(`Creating migration for ${serviceName}...`);
      
      try {
        execSync(`npx prisma migrate dev --name ${migrationName} --schema ${schemaFile}`, {
          stdio: 'inherit',
        });
        console.log(`✅ Successfully created migration for ${serviceName}`);
      } catch (error) {
        console.error(`❌ Failed to create migration for ${serviceName}:`, error.message);
      }
    });
    
    rl.close();
  });
}); 