/**
 * Server Process Manager
 * 
 * This script adds an extra layer of stability to the server by:
 * 1. Auto-restarting in case of crashes
 * 2. Handling process termination gracefully
 * 3. Monitoring memory usage
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const MAX_RESTARTS = 10;
const RESTART_DELAY = 5000; // 5 seconds
const LOG_DIR = path.join(__dirname, 'logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Create log streams
const outLogPath = path.join(LOG_DIR, 'server-out.log');
const errLogPath = path.join(LOG_DIR, 'server-err.log');
const outStream = fs.createWriteStream(outLogPath, { flags: 'a' });
const errStream = fs.createWriteStream(errLogPath, { flags: 'a' });

// Tracking
let restartCount = 0;
let lastRestartTime = Date.now();
let serverProcess = null;

// Log with timestamp
function log(message) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${message}`;
  console.log(logMsg);
  outStream.write(logMsg + '\n');
}

// Start server process
function startServer() {
  // Reset restart count if last restart was more than 1 hour ago
  if (Date.now() - lastRestartTime > 60 * 60 * 1000) {
    restartCount = 0;
  }
  
  // Check if restart limit has been exceeded
  if (restartCount >= MAX_RESTARTS) {
    const message = `Maximum restart limit (${MAX_RESTARTS}) reached. Waiting for manual intervention.`;
    console.error(message);
    errStream.write(message + '\n');
    return;
  }
  
  // Update restart tracking
  restartCount++;
  lastRestartTime = Date.now();
  
  // Log startup
  log(`Starting server (attempt ${restartCount}/${MAX_RESTARTS})...`);
  
  // Start the server
  serverProcess = spawn('node', ['src/server.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });
  
  // Handle standard output
  serverProcess.stdout.on('data', (data) => {
    process.stdout.write(data);
    outStream.write(data);
  });
  
  // Handle standard error
  serverProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
    errStream.write(data);
  });
  
  // Handle process exit
  serverProcess.on('exit', (code, signal) => {
    const exitReason = signal ? `signal ${signal}` : `exit code ${code}`;
    log(`Server process terminated with ${exitReason}`);
    
    // Restart server if it crashed
    if (code !== 0 && code !== null) {
      log(`Server crashed. Restarting in ${RESTART_DELAY / 1000} seconds...`);
      setTimeout(startServer, RESTART_DELAY);
    }
    
    serverProcess = null;
  });
  
  // Handle process error
  serverProcess.on('error', (err) => {
    console.error('Failed to start server process:', err);
    errStream.write(`Failed to start server process: ${err.message}\n`);
    
    // Attempt to restart
    log(`Error starting server. Retrying in ${RESTART_DELAY / 1000} seconds...`);
    setTimeout(startServer, RESTART_DELAY);
  });
  
  // Log process ID
  log(`Server process started with PID: ${serverProcess.pid}`);
}

// Handle script termination
function handleTermination() {
  log('Received termination signal');
  
  if (serverProcess) {
    log('Shutting down server process...');
    
    // Try to terminate gracefully
    serverProcess.kill('SIGTERM');
    
    // Force kill after timeout
    setTimeout(() => {
      if (serverProcess) {
        log('Force terminating server process...');
        serverProcess.kill('SIGKILL');
      }
      
      cleanup();
    }, 5000);
  } else {
    cleanup();
  }
}

// Cleanup resources
function cleanup() {
  log('Cleaning up and exiting...');
  outStream.end();
  errStream.end();
  process.exit(0);
}

// Handle termination signals
process.on('SIGINT', handleTermination);
process.on('SIGTERM', handleTermination);
process.on('SIGHUP', handleTermination);

// Handle uncaught exceptions in this script
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in process manager:', err);
  errStream.write(`Uncaught exception in process manager: ${err.stack}\n`);
  
  // Try to keep running
  if (serverProcess === null) {
    log('Attempting to restart server after uncaught exception...');
    setTimeout(startServer, RESTART_DELAY);
  }
});

// Start the server
log('Server process manager started');
startServer(); 