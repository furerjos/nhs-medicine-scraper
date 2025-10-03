#!/usr/bin/env node

import { NHSMedicineScraper } from './scraper';
import { ScrapingOptions } from './types';
import * as fs from 'fs';
import * as path from 'path';

// Set up file logging
function setupLogging() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logFileName = `scraper-log-${timestamp}.txt`;
  const logFilePath = path.join(process.cwd(), 'logs', logFileName);
  
  // Create logs directory if it doesn't exist
  const logsDir = path.dirname(logFilePath);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  // Create write stream for logging
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  
  // Override console.log to write to both console and file
  const originalLog = console.log;
  const originalError = console.error;
  
  console.log = (...args: any[]) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ');
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    originalLog(...args);
    logStream.write(logMessage);
  };
  
  console.error = (...args: any[]) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ');
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ERROR: ${message}\n`;
    
    originalError(...args);
    logStream.write(logMessage);
  };
  
  // Log the start of the session
  console.log(`📝 Logging to: ${logFilePath}`);
  
  return { logFilePath, logStream };
}

async function main() {
  // Set up logging first
  const { logFilePath, logStream } = setupLogging();
  
  console.log('🏥 NHS Medicine Scraper');
  console.log('=====================\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const options: ScrapingOptions = {};

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--test':
        options.testMode = true;
        break;
      case '--limit':
        options.limit = parseInt(args[++i]) || 10;
        break;
      case '--output':
        options.outputFile = args[++i];
        break;
      case '--concurrency':
        options.maxConcurrency = parseInt(args[++i]) || 3;
        break;
      case '--delay':
        options.delayBetweenRequests = parseInt(args[++i]) || 1000;
        break;
      case '--help':
        printHelp();
        process.exit(0);
        break;
    }
  }

  const scraper = new NHSMedicineScraper(options);

  try {
    await scraper.initialize();
    
    if (options.testMode) {
      console.log(`🧪 Running in TEST MODE (limit: ${options.limit || 10} medicines)\n`);
    } else {
      console.log('🚀 Running in FULL MODE (all medicines)\n');
    }

    const result = await scraper.scrape();
    
    console.log('\n📊 Final Results:');
    console.log(`   Total medicines found: ${result.totalMedicines}`);
    console.log(`   Successfully scraped: ${result.scrapedMedicines}`);
    console.log(`   Failed: ${result.failedMedicines.length}`);
    console.log(`   Success rate: ${((result.scrapedMedicines / (result.scrapedMedicines + result.failedMedicines.length)) * 100).toFixed(1)}%`);
    
    if (result.failedMedicines.length > 0) {
      console.log('\n❌ Failed medicines:');
      result.failedMedicines.forEach(name => console.log(`   - ${name}`));
    }

  } catch (error) {
    console.error('❌ Scraping failed:', error);
    process.exit(1);
  } finally {
    await scraper.close();
    
    // Log the final message before closing the stream
    console.log(`\n📝 Log saved to: ${logFilePath}`);
    
    // Close the log stream
    logStream.end();
  }
}

function printHelp() {
  console.log(`
NHS Medicine Scraper

Usage: npm run dev [options]

Options:
  --test                    Run in test mode (limited medicines)
  --limit <number>          Number of medicines to scrape in test mode (default: 10)
  --output <file>           Output JSON file path (default: nhs-medicines.json)
  --concurrency <number>    Max concurrent requests (default: 3)
  --delay <ms>              Delay between requests in ms (default: 1000)
  --help                    Show this help message

Examples:
  npm run dev                           # Full scraping
  npm run dev -- --test                 # Test mode with 10 medicines
  npm run dev -- --test --limit 5       # Test mode with 5 medicines
  npm run dev -- --output my-data.json  # Custom output file
  npm run dev -- --concurrency 5        # Higher concurrency
`);
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Run the main function
if (require.main === module) {
  main().catch(console.error);
}
