require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { connectToDatabase, closeDatabase } = require('./db/mongodb');
const resumeParserRoutes = require('./api/resumeParser');
const jobMatchingRoutes = require('./api/jobMatching');
const questionAnsweringRoutes = require('./api/questionAnswering');
const llmChatbotAction = require('./api/llmChatbotAction');
const logViewer = require('./api/logViewer');
const { router: parseResumeTextRoutes } = require('./api/parseResumeText');

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// API Routes
app.use('/api', resumeParserRoutes);
app.use('/api', jobMatchingRoutes);
app.use('/api', questionAnsweringRoutes);
app.use('/api', llmChatbotAction);
app.use('/api', logViewer);
app.use('/api', parseResumeTextRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Create a simple dashboard page for viewing LLM logs
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Server Error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// Database connection state
let isConnected = false;
let server = null;

// Start server
async function startServer() {
  try {
    if (!isConnected) {
      // Connect to MongoDB
      await connectToDatabase();
      isConnected = true;
    }

    // Start Express server if not already running
    if (!server) {
      server = app.listen(port, () => {
        console.log(`Server running on port ${port}`);
      });

      // Handle connection errors
      server.on('error', (err) => {
        console.error('Server error:', err);
        if (err.code === 'EADDRINUSE') {
          console.error(`Port ${port} is already in use. Trying again in 5 seconds...`);
          setTimeout(() => {
            server.close();
            server = null;
            startServer();
          }, 5000);
        }
      });
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    isConnected = false;
    
    // Attempt to reconnect in 5 seconds
    setTimeout(startServer, 5000);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  try {
    console.log('Shutting down gracefully');
    if (server) {
      server.close();
    }
    await closeDatabase();
    console.log('Server stopped');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  // Don't exit process, just log the error
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit process, just log the error
});

// Start the server
startServer();