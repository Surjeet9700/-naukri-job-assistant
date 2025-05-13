const { expect } = require('chai');
const sinon = require('sinon');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Import the router directly, but we'll need to mock dependencies
let llmChatbotRouter;
const express = require('express');
const fs = require('fs');
const path = require('path');

// Mock response for tests
class MockResponse {
  constructor() {
    this.statusCode = 200;
    this.responseData = null;
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  json(data) {
    this.responseData = data;
    return this;
  }
}

describe('LLM Chatbot Action Handler', function() {
  let validateAndFixLLMResponse;
  let buildEnhancedPrompt;
  let handlePersonalInfoQuestion;
  let generateContentStub;
  let genAI;
  
  before(function() {
    // Mock GoogleGenerativeAI
    generateContentStub = sinon.stub();
    sinon.stub(GoogleGenerativeAI.prototype, 'getGenerativeModel').returns({
      generateContent: generateContentStub
    });
    
    // Mock fs and path functions that might be used
    sinon.stub(fs, 'writeFileSync').returns(undefined);
    sinon.stub(fs, 'existsSync').returns(true);
    sinon.stub(path, 'join').callsFake((...args) => args.join('/'));
    
    // Now we can safely require the router
    process.env.GEMINI_API_KEY = 'mock_api_key';
    llmChatbotRouter = require('../api/llmChatbotAction');
    
    // Extract the key functions for testing directly
    // This is a bit hacky but needed for proper unit testing
    const routerExports = llmChatbotRouter.__proto__;
    for (const key in routerExports) {
      if (key === 'validateAndFixLLMResponse') {
        validateAndFixLLMResponse = routerExports[key];
      } else if (key === 'buildEnhancedPrompt') {
        buildEnhancedPrompt = routerExports[key];
      } else if (key === 'handlePersonalInfoQuestion') {
        handlePersonalInfoQuestion = routerExports[key];
      }
    }
  });
  
  after(function() {
    // Restore all stubs
    sinon.restore();
  });
  
  describe('validateAndFixLLMResponse', function() {
    it('should convert "none" action type to "type" for disability percentage questions', function() {
      // Mock data
      const action = { actionType: 'none' };
      const question = 'What is your Disability Percentage?';
      const options = null;
      const profile = {};
      
      // Call the function
      const result = validateAndFixLLMResponse(action, question, options, profile);
      
      // Assert the result
      expect(result.actionType).to.equal('type');
      expect(result.actionValue).to.equal('0%');
    });
    
    it('should handle missing action properly', function() {
      const result = validateAndFixLLMResponse(null, 'Any question', null, {});
      expect(result.actionType).to.equal('type');
      expect(result.actionValue).to.exist;
    });
    
    it('should ensure valid actionValue for "select" type', function() {
      const action = { actionType: 'select', actionValue: 'Invalid Option' };
      const options = ['Option 1', 'Option 2'];
      
      const result = validateAndFixLLMResponse(action, 'Question?', options, {});
      
      expect(result.actionType).to.equal('select');
      expect(options).to.include(result.actionValue);
    });
  });
  
  describe('handlePersonalInfoQuestion', function() {
    it('should return 0% for disability percentage questions', function() {
      const question = 'What is your disability percentage?';
      const options = null;
      const profile = {};
      
      const response = handlePersonalInfoQuestion(question, options, profile);
      const result = response.json();
      
      expect(result.success).to.be.true;
      expect(result.answer).to.equal('0%');
      expect(result.actionType).to.equal('type');
    });
    
    it('should select "No" option for disability questions with options', function() {
      const question = 'Do you have any disabilities?';
      const options = ['Yes', 'No'];
      const profile = {};
      
      const response = handlePersonalInfoQuestion(question, options, profile);
      const result = response.json();
      
      expect(result.success).to.be.true;
      expect(result.answer).to.equal('No');
      expect(result.actionType).to.equal('select');
    });
    
    it('should handle disability questions without "No" option', function() {
      const question = 'Select your disability status';
      const options = ['Option 1', 'Option 2'];
      const profile = {};
      
      const response = handlePersonalInfoQuestion(question, options, profile);
      const result = response.json();
      
      expect(result.success).to.be.true;
      expect(result.answer).to.equal('Option 1');
      expect(result.actionType).to.equal('select');
    });
  });
  
  describe('API Request Handling', function() {
    it('should handle disability percentage questions correctly via API', async function() {
      // Setup mock request and response
      const req = {
        body: {
          question: 'What is your Disability Percentage?',
          profile: { name: 'Test User', email: 'test@example.com' }
        }
      };
      const res = new MockResponse();
      
      // Setup LLM response - returning "none" action type, which should be fixed
      generateContentStub.resolves({
        response: {
          text: () => Promise.resolve(JSON.stringify({
            actionType: 'none',
            actionValue: null
          }))
        }
      });
      
      // Find the route handler
      const routeHandler = llmChatbotRouter.stack.find(
        layer => layer.route && layer.route.path === '/llm-chatbot-action'
      );
      
      if (!routeHandler) {
        throw new Error('Could not find route handler for /llm-chatbot-action');
      }
      
      // Call the route handler
      await routeHandler.route.stack[0].handle(req, res);
      
      // Verify the response
      expect(res.responseData.success).to.be.true;
      expect(res.responseData.answer).to.equal('0%');
      expect(res.responseData.actionType).to.equal('type');
    });
    
    it('should handle missing required fields', async function() {
      // Setup mock request with missing profile
      const req = {
        body: {
          question: 'Some question'
          // profile is missing
        }
      };
      const res = new MockResponse();
      
      // Find the route handler
      const routeHandler = llmChatbotRouter.stack.find(
        layer => layer.route && layer.route.path === '/llm-chatbot-action'
      );
      
      // Call the route handler
      await routeHandler.route.stack[0].handle(req, res);
      
      // Verify the response
      expect(res.statusCode).to.equal(400);
      expect(res.responseData.success).to.be.false;
    });
    
    it('should use fallback responses on API errors', async function() {
      // Setup mock request
      const req = {
        body: {
          question: 'What is your notice period?',
          profile: { name: 'Test User', email: 'test@example.com' }
        }
      };
      const res = new MockResponse();
      
      // Setup LLM to throw an error
      generateContentStub.rejects(new Error('API timeout'));
      
      // Find the route handler
      const routeHandler = llmChatbotRouter.stack.find(
        layer => layer.route && layer.route.path === '/llm-chatbot-action'
      );
      
      // Call the route handler
      await routeHandler.route.stack[0].handle(req, res);
      
      // Verify the response uses fallback logic
      expect(res.responseData.success).to.be.true;
      expect(res.responseData.answer).to.exist;
      expect(res.responseData.actionType).to.exist;
    });
  });
  
  describe('buildEnhancedPrompt', function() {
    it('should include instructions to never use "none" action type', function() {
      const question = 'Any question';
      const options = null;
      const profile = { name: 'Test User' };
      
      const prompt = buildEnhancedPrompt(question, options, profile, null, {});
      
      expect(prompt).to.include('NEVER use actionType "none"');
      expect(prompt).to.include('use "type" instead with an appropriate text response');
    });
    
    it('should include specific instructions for disability percentage questions', function() {
      const question = 'Any question';
      const options = null;
      const profile = { name: 'Test User' };
      
      const prompt = buildEnhancedPrompt(question, options, profile, null, {});
      
      expect(prompt).to.include('For disability percentage questions, respond with "0%"');
    });
  });
}); 