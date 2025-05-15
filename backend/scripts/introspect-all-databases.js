#!/usr/bin/env node

/**
 * Script to introspect all service databases
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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

// Function to introspect database schema
function introspectDatabase(schemaPath) {
  const serviceName = path.basename(schemaPath, '.prisma');
  console.log(`Introspecting database for ${serviceName}...`);
  
  try {
    // Run prisma db pull for this schema
    execSync(`npx prisma db pull --schema ${schemaPath}`, {
      stdio: 'inherit',
    });
    console.log(`✅ Successfully introspected database for ${serviceName}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to introspect database for ${serviceName}:`, error.message);
    return false;
  }
}

// Introspect all database schemas
console.log(`Found ${schemaFiles.length} Prisma schema files`);
let successCount = 0;

for (const schemaFile of schemaFiles) {
  const success = introspectDatabase(schemaFile);
  if (success) successCount++;
}

console.log(`Completed database introspection: ${successCount}/${schemaFiles.length} successful`);
