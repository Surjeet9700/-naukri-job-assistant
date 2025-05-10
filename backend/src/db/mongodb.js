const { MongoClient } = require('mongodb');

// MongoDB connection string
const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/naukri_apply_assist';

// Database Name
const dbName = process.env.DB_NAME || 'naukri_apply_assist';

// Create a new MongoClient
const client = new MongoClient(uri);

let db;

/**
 * Connect to MongoDB
 */
async function connectToDatabase() {
  try {
    // Connect the client to the server
    await client.connect();
    console.log('Connected successfully to MongoDB');
    
    // Get reference to the database
    db = client.db(dbName);
    
    return db;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

/**
 * Get the database instance
 */
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call connectToDatabase first.');
  }
  return db;
}

/**
 * Close the database connection
 */
async function closeDatabase() {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
}

module.exports = {
  connectToDatabase,
  getDb,
  closeDatabase
};