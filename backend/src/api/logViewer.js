const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Log directory path
const LOGS_DIR = path.join(__dirname, '../../logs');

/**
 * GET /api/logs
 * Returns a list of all log files
 */
router.get('/logs', (req, res) => {
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      return res.json({ 
        success: true, 
        logs: [] 
      });
    }
    
    const files = fs.readdirSync(LOGS_DIR)
      .filter(file => file.startsWith('llm-interaction-') && file.endsWith('.json'))
      .sort((a, b) => {
        // Sort by creation time (newest first)
        return fs.statSync(path.join(LOGS_DIR, b)).mtime.getTime() - 
               fs.statSync(path.join(LOGS_DIR, a)).mtime.getTime();
      });
    
    const logs = files.map(file => {
      const stats = fs.statSync(path.join(LOGS_DIR, file));
      return {
        filename: file,
        created: stats.mtime,
        size: stats.size
      };
    });
    
    res.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Error getting logs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/logs/:filename
 * Returns the content of a specific log file
 */
router.get('/logs/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    
    // Sanitize filename to prevent directory traversal
    if (!filename.match(/^llm-interaction-[\w\-\.]+\.json$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filename format'
      });
    }
    
    const filePath = path.join(LOGS_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'Log file not found'
      });
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const logData = JSON.parse(content);
    
    res.json({
      success: true,
      log: logData
    });
  } catch (error) {
    console.error('Error reading log file:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/logs/dashboard/stats
 * Returns aggregated statistics about LLM interactions
 */
router.get('/logs/dashboard/stats', (req, res) => {
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      return res.json({ 
        success: true, 
        stats: {
          totalLogs: 0,
          questionTypes: {},
          responseTypes: {},
          accuracy: 0
        }
      });
    }
    
    const files = fs.readdirSync(LOGS_DIR)
      .filter(file => file.startsWith('llm-interaction-') && file.endsWith('.json'));
    
    // Initialize stats
    const stats = {
      totalLogs: files.length,
      questionCategories: {},
      responseTypes: {},
      accuracy: 0,
      mostCommonQuestions: []
    };
    
    // Track unique questions for frequency analysis
    const questions = {};
    
    // Process each log file
    files.forEach(file => {
      try {
        const filePath = path.join(LOGS_DIR, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const logData = JSON.parse(content);
        
        // Track question text
        if (logData.question) {
          const questionText = logData.question.toLowerCase();
          questions[questionText] = (questions[questionText] || 0) + 1;
        }
        
        // Track question categories
        if (logData.questionCategories) {
          Object.entries(logData.questionCategories).forEach(([category, value]) => {
            if (value === true) {
              stats.questionCategories[category] = (stats.questionCategories[category] || 0) + 1;
            }
          });
        }
        
        // Track response types
        if (logData.response && logData.response.type) {
          const responseType = logData.response.type;
          stats.responseTypes[responseType] = (stats.responseTypes[responseType] || 0) + 1;
        }
      } catch (error) {
        console.error(`Error processing log file ${file}:`, error);
      }
    });
    
    // Calculate most common questions
    stats.mostCommonQuestions = Object.entries(questions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([question, count]) => ({ question, count }));
    
    // Calculate accuracy (non-fallback responses / total)
    const totalResponses = Object.values(stats.responseTypes).reduce((sum, count) => sum + count, 0);
    const fallbackResponses = stats.responseTypes['fallback'] || 0;
    stats.accuracy = totalResponses > 0 ? 
      ((totalResponses - fallbackResponses) / totalResponses * 100).toFixed(2) : 0;
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error generating stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/logs/:filename
 * Deletes a specific log file
 */
router.delete('/logs/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    
    // Sanitize filename to prevent directory traversal
    if (!filename.match(/^llm-interaction-[\w\-\.]+\.json$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filename format'
      });
    }
    
    const filePath = path.join(LOGS_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'Log file not found'
      });
    }
    
    fs.unlinkSync(filePath);
    
    res.json({
      success: true,
      message: `Log file ${filename} deleted successfully`
    });
  } catch (error) {
    console.error('Error deleting log file:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/logs/batch
 * Returns the content of multiple log files at once
 */
router.post('/logs/batch', (req, res) => {
  try {
    const { filenames } = req.body;
    
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or empty filenames array'
      });
    }
    
    // Limit to 20 logs max for performance
    const limitedFilenames = filenames.slice(0, 20);
    
    const logs = {};
    
    limitedFilenames.forEach(filename => {
      // Sanitize filename to prevent directory traversal
      if (!filename.match(/^llm-interaction-[\w\-\.]+\.json$/)) {
        console.warn(`Invalid filename format: ${filename}`);
        return;
      }
      
      const filePath = path.join(LOGS_DIR, filename);
      
      if (!fs.existsSync(filePath)) {
        console.warn(`Log file not found: ${filename}`);
        return;
      }
      
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        logs[filename] = JSON.parse(content);
      } catch (readError) {
        console.error(`Error reading log file ${filename}:`, readError);
      }
    });
    
    res.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Error reading batch log files:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router; 