import { UserProfile } from '../../popup/types/profile';
import { Job } from '../../popup/types/job';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../../config';

// Initialize the Gemini API with the API key from config
const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

export interface PageAnalysisRequest {
  html: string;
  taskType: 'findChatbot' | 'findQuestionInput' | 'findAnswerSubmit' | 'application_completion_detection';
  currentState?: string;
}

export interface PageAnalysisResponse {
  selectors?: string[];
  explanation: string;
  strategy?: string;
  confidence: number;
  status?: 'complete' | 'in_progress' | 'unknown';
  indicators?: string[];
}

/**
 * Parses a resume using Gemini AI
 */
export async function parseResumeWithGemini(data: {
  fileName: string;
  fileType: string;
  content: string;
}): Promise<UserProfile> {
  try {
    // For the MVP, we'll use the backend service to handle resume parsing
    // This prevents exposing API keys in the extension
    const response = await fetch('http://localhost:3000/api/parse-resume', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to parse resume: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result.profile;
  } catch (error) {
    console.error('Error parsing resume with Gemini:', error);
    throw error;
  }
}

/**
 * Uses Gemini to generate responses to application questions
 */
export async function generateQuestionAnswer(
  question: string, 
  profile: UserProfile, 
  jobDetails: Job
): Promise<string> {
  try {
    // For the MVP, we'll use the backend service to handle AI responses
    const response = await fetch('http://localhost:3000/api/answer-question', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question,
        profile,
        jobDetails
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to generate answer: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result.answer;
  } catch (error) {
    console.error('Error generating answer with Gemini:', error);
    throw error;
  }
}

/**
 * Analyzes a page structure using Gemini AI
 */
export async function analyzePage(request: PageAnalysisRequest): Promise<PageAnalysisResponse> {
  try {
    // For application completion detection, use the backend service
    if (request.taskType === 'application_completion_detection') {
      return await analyzeApplicationCompletion(request);
    }
    
    // Use the latest Gemini model for other types of analysis
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `
Analyze this HTML structure and help find the best selectors for a ${request.taskType} task.
Current state: ${request.currentState || 'initial'}

HTML Structure:
${request.html}

Return ONLY a JSON object with:
- selectors: array of possible CSS selectors in order of likelihood
- explanation: why these selectors were chosen
- strategy: recommended interaction strategy
- confidence: number 0-1 indicating confidence in the analysis

Focus on finding selectors that are:
1. Most likely to be stable
2. Specific to the intended element
3. Based on semantic meaning when possible`;

    const result = await model.generateContent(prompt);
    const response = await result.response.text();
    
    try {
      return JSON.parse(response);
    } catch {
      // If parsing fails, return a structured fallback
      return {
        selectors: ['.chatbot_container', '._chatBotContainer', '[role="dialog"]'],
        explanation: 'Fallback selectors based on common patterns',
        strategy: 'Try each selector in sequence',
        confidence: 0.5
      };
    }
  } catch (error) {
    console.error('Error in page analysis:', error);
    throw error;
  }
}

/**
 * Uses the backend service to analyze if an application has been completed
 */
export async function analyzeApplicationCompletion(request: PageAnalysisRequest): Promise<PageAnalysisResponse> {
  try {
    console.log('Sending application completion detection request to backend');
    
    // Use the backend service for application completion detection
    const response = await fetch('http://localhost:3000/api/analyze-page', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html: request.html,
        taskType: request.taskType,
        currentState: request.currentState || 'checking_completion'
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to analyze page: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('Application completion analysis result:', result);
    
    return {
      explanation: result.explanation || 'Application completion analysis complete',
      confidence: result.confidence || 0.5,
      status: result.status || 'unknown',
      indicators: result.indicators || []
    };
  } catch (error) {
    console.error('Error analyzing application completion:', error);
    return {
      explanation: `Error: ${error.message}`,
      confidence: 0,
      status: 'unknown',
      indicators: []
    };
  }
}