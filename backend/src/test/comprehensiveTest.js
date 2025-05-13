/**
 * Comprehensive Test for Disability Question Handling
 * 
 * This file tests all aspects of disability question handling in the job application assistant.
 * It focuses on verifying that:
 * 1. "none" action types are properly converted
 * 2. Disability percentage questions return "0%"
 * 3. Disability yes/no questions select "No" when available
 * 4. All other disability questions provide appropriate responses
 */

const fs = require('fs');

// Mock the essential functions
function getFallbackTextResponse(question, profile) {
  const questionLower = question.toLowerCase();
  
  if ((questionLower.includes('disability') || questionLower.includes('differently')) && 
      (questionLower.includes('percentage') || questionLower.includes('%'))) {
    return "0%";
  }
  
  // Generic response for other questions
  return "Default response";
}

// Constants
const ALLOWED_ACTION_TYPES = ["select", "type", "textarea", "multiSelect", "dropdown", "click"];

// The implementation of validateAndFixLLMResponse
function validateAndFixLLMResponse(action, question, options, profile) {
  // Ensure action has required fields
  if (!action) {
    action = { actionType: 'type', actionValue: getFallbackTextResponse(question, profile) };
  }
  
  if (!action.actionType) {
    action.actionType = 'type';
  }
  
  // Never allow "none" action type
  if (action.actionType === 'none') {
    console.log('[LLM] Converting "none" action type to "type" for question:', question);
    action.actionType = 'type';
    
    // Add a value based on the question 
    if ((question.toLowerCase().includes('disability') || question.toLowerCase().includes('differently')) && 
        (question.toLowerCase().includes('percentage') || question.toLowerCase().includes('%'))) {
      action.actionValue = "0%";
    } else {
      action.actionValue = getFallbackTextResponse(question, profile);
    }
  }
  
  // Validate actionType
  if (!ALLOWED_ACTION_TYPES.includes(action.actionType)) {
    console.log(`Invalid actionType: ${action.actionType}, defaulting to 'type'`);
    action.actionType = 'type';
  }
  
  // Validate actionValue for select type
  if (action.actionType === 'select' && options && options.length > 0) {
    // If actionValue is not in options, find closest match
    if (!options.includes(action.actionValue)) {
      console.log(`Selected option "${action.actionValue}" not found in available options`);
      // Try case-insensitive matching
      const matchingOption = options.find(opt => 
        opt.toLowerCase() === (action.actionValue || '').toLowerCase()
      );
      
      if (matchingOption) {
        action.actionValue = matchingOption;
      } else {
        // Fallback to first option if no match
        action.actionValue = options[0];
      }
    }
  }
  
  // Ensure text responses aren't empty
  if ((action.actionType === 'type' || action.actionType === 'textarea') && 
      (!action.actionValue || action.actionValue.trim() === '')) {
    action.actionValue = getFallbackTextResponse(question, profile);
  }
  
  return action;
}

// Implementation of handlePersonalInfoQuestion
function handlePersonalInfoQuestion(question, options, profile) {
  const questionLower = question.toLowerCase();
  
  // Detect different types of personal questions - IMPORTANT: Include all variations
  const isDisabilityQuestion = questionLower.includes('disability') || 
                              questionLower.includes('disabled') ||
                              questionLower.includes('differently') ||
                              questionLower.includes('disabilities') ||
                              questionLower.includes('special needs') ||
                              questionLower.includes('handicap');
  
  // Handle specific personal questions with appropriate default responses
  if (options && options.length > 0) {
    // If this is a multiple choice question
    if (isDisabilityQuestion) {
      // For disability questions with options, look for the "No" option first or "0%" option
      const noIndex = options.findIndex(opt => 
        opt.toLowerCase() === 'no' || 
        opt.toLowerCase() === 'n' || 
        opt.toLowerCase().includes('none') || 
        opt.toLowerCase().includes('0%')
      );
      
      if (noIndex !== -1) {
        return {
          json: () => ({
            success: true,
            answer: options[noIndex],
            actionType: 'select'
          })
        };
      }
      
      // If no "No" option, select the most appropriate option (usually the first)
      return {
        json: () => ({
          success: true,
          answer: options[0],
          actionType: 'select'
        })
      };
    }
  }
  
  // If this is a text input question for disability
  if (isDisabilityQuestion) {
    if (questionLower.includes('percentage') || questionLower.includes('%')) {
      return {
        json: () => ({
          success: true,
          answer: '0%',
          actionType: 'type'
        })
      };
    }
    
    return {
      json: () => ({
        success: true,
        answer: 'I do not have any disabilities that would affect my ability to perform the job duties.',
        actionType: 'type'
      })
    };
  }
  
  // Generic fallback
  return {
    json: () => ({
      success: true, 
      answer: 'Prefer not to disclose',
      actionType: 'type'
    })
  };
}

// Test profile data
const profile = {
  name: 'Test User',
  email: 'test@example.com',
  phone: '9876543210',
  skills: ['JavaScript', 'React', 'Node.js']
};

// COMPREHENSIVE TEST CASES - Covering all possible disability question variations
const testCases = [
  // 1. Disability Percentage Questions (Various Phrasings)
  {
    group: 'Disability Percentage Questions',
    cases: [
      {
        name: 'Simple disability percentage',
        action: { actionType: 'none', actionValue: null },
        question: 'What is your Disability Percentage?',
        options: null,
        profile: profile,
        expectedResult: { actionType: 'type', actionValue: '0%' }
      },
      {
        name: 'Disability percentage with different phrasing',
        action: { actionType: 'none', actionValue: null },
        question: 'Disability percentage?',
        options: null,
        profile: profile,
        expectedResult: { actionType: 'type', actionValue: '0%' }
      },
      {
        name: 'Disability percentage with percentage symbol',
        action: { actionType: 'none', actionValue: null },
        question: 'Please enter your disability %',
        options: null,
        profile: profile,
        expectedResult: { actionType: 'type', actionValue: '0%' }
      },
      {
        name: 'Differently phrased disability percentage',
        action: { actionType: 'none', actionValue: null },
        question: 'If you are a person with disability, what is the percentage?',
        options: null,
        profile: profile,
        expectedResult: { actionType: 'type', actionValue: '0%' }
      }
    ]
  },
  
  // 2. Yes/No Disability Questions (Various Phrasings)
  {
    group: 'Yes/No Disability Questions',
    cases: [
      {
        name: 'Simple yes/no disability question',
        action: { actionType: 'select', actionValue: 'Yes' },
        question: 'Do you have any disabilities?',
        options: ['Yes', 'No'],
        profile: profile,
        expectedResult: { actionType: 'select', actionValue: 'Yes' },
        expectedHandlerResult: { actionType: 'select', answer: 'No' }
      },
      {
        name: 'Differently phrased yes/no disability question',
        action: { actionType: 'none', actionValue: null },
        question: 'Are you a differently-abled person?',
        options: ['Yes', 'No'],
        profile: profile,
        expectedResult: { actionType: 'type', actionValue: 'Default response' },
        expectedHandlerResult: { actionType: 'select', answer: 'No' }
      },
      {
        name: 'Differently phrased yes/no disability question (2)',
        action: { actionType: 'none', actionValue: null },
        question: 'Do you have any physical disabilities?',
        options: ['Yes', 'No'],
        profile: profile,
        expectedResult: { actionType: 'type', actionValue: 'Default response' },
        expectedHandlerResult: { actionType: 'select', answer: 'No' }
      },
      {
        name: 'Yes/no with additional options',
        action: { actionType: 'none', actionValue: null },
        question: 'Do you have any disabilities?',
        options: ['Yes', 'No', 'Prefer not to say'],
        profile: profile,
        expectedResult: { actionType: 'type', actionValue: 'Default response' },
        expectedHandlerResult: { actionType: 'select', answer: 'No' }
      }
    ]
  },
  
  // 3. Multiple-choice Disability Questions
  {
    group: 'Multiple-choice Disability Questions',
    cases: [
      {
        name: 'Multiple choice with "None" option',
        action: { actionType: 'select', actionValue: 'Visual' },
        question: 'Select your disability type',
        options: ['Visual', 'Hearing', 'Mobility', 'None'],
        profile: profile,
        expectedResult: { actionType: 'select', actionValue: 'Visual' },
        expectedHandlerResult: { actionType: 'select', answer: 'None' }
      },
      {
        name: 'Multiple choice without "None" option',
        action: { actionType: 'none', actionValue: null },
        question: 'Select your disability category',
        options: ['Category A', 'Category B', 'Category C'],
        profile: profile,
        expectedResult: { actionType: 'type', actionValue: 'Default response' },
        expectedHandlerResult: { actionType: 'select', answer: 'Category A' }
      },
      {
        name: 'Multiple choice with percentage ranges',
        action: { actionType: 'none', actionValue: null },
        question: 'Select your disability percentage range',
        options: ['0%', '1-40%', '41-80%', 'Above 80%'],
        profile: profile,
        expectedResult: { actionType: 'type', actionValue: 'Default response' },
        expectedHandlerResult: { actionType: 'select', answer: '0%' }
      }
    ]
  },
  
  // 4. Free-text Disability Questions
  {
    group: 'Free-text Disability Questions',
    cases: [
      {
        name: 'General disability description',
        action: { actionType: 'none', actionValue: null },
        question: 'Please describe your disability, if any',
        options: null,
        profile: profile,
        expectedResult: { actionType: 'type', actionValue: 'Default response' },
        expectedHandlerResult: { actionType: 'type', answer: 'I do not have any disabilities that would affect my ability to perform the job duties.' }
      },
      {
        name: 'Disability accommodations',
        action: { actionType: 'none', actionValue: null },
        question: 'What accommodations do you need for your disability?',
        options: null,
        profile: profile,
        expectedResult: { actionType: 'type', actionValue: 'Default response' },
        expectedHandlerResult: { actionType: 'type', answer: 'I do not have any disabilities that would affect my ability to perform the job duties.' }
      }
    ]
  },
  
  // 5. Edge Cases
  {
    group: 'Edge Cases',
    cases: [
      {
        name: 'Empty action with disability percentage question',
        action: null,
        question: 'What is your Disability Percentage?',
        options: null,
        profile: profile,
        expectedResult: { actionType: 'type', actionValue: '0%' }
      },
      {
        name: 'Invalid action type with disability question',
        action: { actionType: 'invalid_type', actionValue: 'Some value' },
        question: 'Do you have any disabilities?',
        options: null,
        profile: profile,
        expectedResult: { actionType: 'type', actionValue: 'Some value' }
      },
      {
        name: 'Empty action value with select type',
        action: { actionType: 'select', actionValue: '' },
        question: 'Select your disability status',
        options: ['Category A', 'Category B', 'None'],
        profile: profile,
        expectedResult: { actionType: 'select', actionValue: 'Category A' }
      }
    ]
  }
];

// Run tests
function runTests() {
  console.log('\n=========================================');
  console.log('COMPREHENSIVE DISABILITY QUESTIONS TEST');
  console.log('=========================================\n');
  
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    details: []
  };
  
  // Process each test group
  testCases.forEach(group => {
    console.log(`\n== Testing ${group.group} ==\n`);
    
    // Process each case in the group
    group.cases.forEach(testCase => {
      results.total++;
      console.log(`${results.total}. Testing: ${testCase.name}`);
      
      // Test validateAndFixLLMResponse
      const result = validateAndFixLLMResponse(
        testCase.action,
        testCase.question,
        testCase.options,
        testCase.profile
      );
      
      console.log(`   Question: "${testCase.question}"`);
      console.log(`   Result: ${JSON.stringify(result)}`);
      
      // Compare with expected result
      let validatePassed = true;
      
      // Check action type
      if (result.actionType !== testCase.expectedResult.actionType) {
        console.log(`   ❌ FAILED: Expected actionType "${testCase.expectedResult.actionType}" but got "${result.actionType}"`);
        validatePassed = false;
      }
      
      // Check action value for percentage questions
      if (testCase.question.toLowerCase().includes('percentage') && 
          testCase.question.toLowerCase().includes('disability')) {
        if (result.actionValue !== '0%') {
          console.log(`   ❌ FAILED: Expected actionValue "0%" for disability percentage question but got "${result.actionValue}"`);
          validatePassed = false;
        }
      } 
      // Check other action values
      else if (testCase.expectedResult.actionValue && 
          result.actionValue !== testCase.expectedResult.actionValue) {
        console.log(`   ❌ FAILED: Expected actionValue "${testCase.expectedResult.actionValue}" but got "${result.actionValue}"`);
        validatePassed = false;
      }
      
      // Test handlePersonalInfoQuestion if expectedHandlerResult is provided
      let handlerPassed = true;
      if (testCase.expectedHandlerResult) {
        const handlerResult = handlePersonalInfoQuestion(
          testCase.question,
          testCase.options,
          testCase.profile
        ).json();
        
        console.log(`   Handler result: ${JSON.stringify(handlerResult)}`);
        
        // Check action type
        if (handlerResult.actionType !== testCase.expectedHandlerResult.actionType) {
          console.log(`   ❌ FAILED HANDLER: Expected actionType "${testCase.expectedHandlerResult.actionType}" but got "${handlerResult.actionType}"`);
          handlerPassed = false;
        }
        
        // Check answer/actionValue
        if (handlerResult.answer !== testCase.expectedHandlerResult.answer) {
          console.log(`   ❌ FAILED HANDLER: Expected answer "${testCase.expectedHandlerResult.answer}" but got "${handlerResult.answer}"`);
          handlerPassed = false;
        }
      } else {
        handlerPassed = null; // No handler test for this case
      }
      
      // Record result
      if (validatePassed && (handlerPassed === true || handlerPassed === null)) {
        console.log('   ✅ PASSED');
        results.passed++;
      } else {
        console.log('   ❌ FAILED');
        results.failed++;
      }
      
      results.details.push({
        name: testCase.name,
        question: testCase.question,
        validatePassed,
        handlerPassed,
        validateResult: result,
        handlerResult: testCase.expectedHandlerResult ? 
          handlePersonalInfoQuestion(testCase.question, testCase.options, testCase.profile).json() : null
      });
      
      console.log(''); // Empty line for spacing
    });
  });
  
  // Print summary
  console.log('=========================================');
  console.log(`SUMMARY: ${results.passed} passed, ${results.failed} failed (out of ${results.total} total tests)`);
  console.log(`Success rate: ${Math.round((results.passed / results.total) * 100)}%`);
  console.log('=========================================');
  
  // Write detailed results to file
  fs.writeFileSync('comprehensive-test-results.json', JSON.stringify(results, null, 2));
  console.log('\nDetailed results written to comprehensive-test-results.json');
}

// Run the tests
runTests(); 