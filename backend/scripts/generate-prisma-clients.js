#!/usr/bin/env node

/**
 * Script to generate Prisma clients for all service schemas
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

// Function to generate client for a schema file
function generateClient(schemaPath) {
  const serviceName = path.basename(schemaPath, '.prisma');
  console.log(`Generating Prisma client for ${serviceName}...`);
  
  try {
    // Run prisma generate for this schema
    execSync(`npx prisma generate --schema ${schemaPath}`, {
      stdio: 'inherit',
    });
    console.log(`✅ Successfully generated client for ${serviceName}`);
  } catch (error) {
    console.error(`❌ Failed to generate client for ${serviceName}:`, error.message);
    process.exit(1);
  }
}

// Generate clients for all schema files
console.log(`Found ${schemaFiles.length} Prisma schema files`);
schemaFiles.forEach(generateClient);

console.log('✅ All Prisma clients generated successfully'); 