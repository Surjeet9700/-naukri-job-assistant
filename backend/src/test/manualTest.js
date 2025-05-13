/**
 * Manual Test Script for LLM Chatbot Action
 * 
 * This script simulates API calls to the LLM chatbot action endpoint
 * to test its behavior with disability-related questions.
 * 
 * Run with: node manualTest.js
 */

const http = require('http');

// Test data - sample profile
const profile = {
  name: 'Test User',
  email: 'test@example.com',
  phone: '9876543210',
  skills: ['JavaScript', 'React', 'Node.js'],
  experience: [
    {
      title: 'Software Developer',
      company: 'Tech Corp',
      startDate: '2020-01-01',
      endDate: '2022-12-31',
      description: 'Worked on web applications'
    }
  ],
  education: [
    {
      degree: 'B.Tech',
      field: 'Computer Science',
      institution: 'Tech University',
      startDate: '2016-01-01',
      endDate: '2020-01-01'
    }
  ]
};

// Test cases - questions to test
const testCases = [
  {
    name: 'Disability Percentage Question',
    question: 'What is your Disability Percentage?',
    options: null
  },
  {
    name: 'Disability Yes/No Question',
    question: 'Do you have any disabilities?',
    options: ['Yes', 'No']
  },
  {
    name: 'Disability Status Selection',
    question: 'Please select your disability status',
    options: ['None', 'Partial', 'Full']
  },
  {
    name: 'Another Disability Question',
    question: 'Are you a differently-abled person?',
    options: ['Yes', 'No']
  },
  {
    name: 'Generic Question (for comparison)',
    question: 'Tell us about your experience with React',
    options: null
  }
];

/**
 * Send a request to the LLM Chatbot Action API
 */
function sendRequest(testCase) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      question: testCase.question,
      options: testCase.options,
      profile: profile
    });
    
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/llm-chatbot-action',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };
    
    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(responseData);
          resolve({
            statusCode: res.statusCode,
            response: parsedData
          });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.write(data);
    req.end();
  });
}

/**
 * Run all test cases
 */
async function runTests() {
  console.log('=========================================');
  console.log('Manual Test for LLM Chatbot Action');
  console.log('=========================================');
  console.log('Make sure your backend server is running!');
  console.log('=========================================\n');
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  for (const testCase of testCases) {
    console.log(`\n🧪 Running test: ${testCase.name}`);
    console.log(`Question: "${testCase.question}"`);
    if (testCase.options) {
      console.log(`Options: ${JSON.stringify(testCase.options)}`);
    } else {
      console.log(`Options: None (text input)`);
    }
    
    try {
      const result = await sendRequest(testCase);
      
      console.log(`Status Code: ${result.statusCode}`);
      console.log(`Response: ${JSON.stringify(result.response, null, 2)}`);
      
      // Basic validation
      if (result.statusCode !== 200) {
        console.log('❌ FAILED: Status code is not 200');
        testsFailed++;
        continue;
      }
      
      if (!result.response.success) {
        console.log('❌ FAILED: Response indicates failure');
        testsFailed++;
        continue;
      }
      
      // Specific validation for disability questions
      if (testCase.question.toLowerCase().includes('disability') || 
          testCase.question.toLowerCase().includes('differently')) {
        
        // For percentage questions, expect "0%"
        if (testCase.question.toLowerCase().includes('percentage')) {
          if (result.response.answer === '0%') {
            console.log('✅ PASSED: Correct answer for disability percentage question');
          } else {
            console.log(`❌ FAILED: Expected "0%" but got "${result.response.answer}"`);
            testsFailed++;
            continue;
          }
        }
        
        // For yes/no questions, expect "No" option
        else if (testCase.options && 
                 testCase.options.map(o => o.toLowerCase()).includes('no')) {
          if (result.response.answer.toLowerCase() === 'no') {
            console.log('✅ PASSED: Correctly selected "No" for disability question');
          } else {
            console.log(`❌ FAILED: Expected "No" but got "${result.response.answer}"`);
            testsFailed++;
            continue;
          }
        }
        
        // For other disability questions, verify action type is not "none"
        else if (result.response.actionType === 'none') {
          console.log('❌ FAILED: Action type should not be "none"');
          testsFailed++;
          continue;
        }
      }
      
      // If we made it here, the test passed
      console.log('✅ PASSED!');
      testsPassed++;
      
    } catch (error) {
      console.error(`❌ ERROR: ${error.message}`);
      testsFailed++;
    }
  }
  
  // Print summary
  console.log('\n=========================================');
  console.log(`Test Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('=========================================');
}

// Run the tests
runTests().catch(error => {
  console.error('Fatal error:', error);
}); 