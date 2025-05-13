/// <reference lib="webworker" />

import { ApplicationStatus, Job } from '../popup/types/job';
import { UserProfile } from '../popup/types/profile';
import { parseResumeWithGemini } from './services/geminiService';
import { getMatchingJobs } from './services/jobService';
import { startAutomation } from './services/automationService';
import { config } from '../config';

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activated!');
  self.clients.claim();
});

// Type definitions for messages
type MessageAction = 
  | 'parseResume'
  | 'fetchMatchingJobs'
  | 'applyToJob'
  | 'updateJobStatus'
  | 'getSavedJobs';

interface ResumeData {
  fileName: string;
  fileType: string;
  content: string;
}

interface MessageData {
  profile?: UserProfile;
  job?: Job;
  jobId?: string;
  status?: ApplicationStatus;
  resumeData?: ResumeData;
}

interface ChromeMessage {
  type: string;
  action?: MessageAction;
  data?: MessageData;
}

interface MessageResponse {
  profile?: UserProfile;
  jobs?: Job[];
  success?: boolean;
  message?: string;
  error?: string;
}

class ApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplicationError';
  }
}

const APPLICATION_TIMEOUT = 1 * 60 * 1000; 

let currentJobAutomation: {
  jobId: string;
  status: ApplicationStatus;
  naukriTabId?: number;
} | null = null;

const automationTimeouts = new Map<string, NodeJS.Timeout>();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);
  
  if (message.type === 'API_REQUEST' || message.type === 'api_request') {
    handleApiRequest(message.endpoint, message.method, message.data)
      .then(data => {
        sendResponse({ success: true, data });
        console.log('API request successful:', data);
      })
      .catch(error => {
        console.error('API request failed:', error);
        sendResponse({ 
          success: false, 
          error: error.message || 'API request failed' 
        });
      });
    
    return true; // Indicates that the response will be sent asynchronously
  }
  
  if (message.type === 'PARSE_RESUME' || message.action === 'parseResume') {
    console.log('Resume parse request received');
    parseResumeFile(message.data?.file, message.data?.fileType)
      .then(result => {
        console.log('Resume parsed successfully');
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        console.error('Resume parsing failed:', error);
        sendResponse({ 
          success: false, 
          error: error.message || 'Failed to parse resume' 
        });
      });
    return true;
  }
  
  if (message.type === 'START_AUTOMATION') {
    if (!message.data?.job || !message.data?.profile) {
      sendResponse({ success: false, error: 'Both job and profile are required' });
      return true;
    }
    
    startAutomation(message.data.job, message.data.profile)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.type === 'JOB_SEARCH') {
    getMatchingJobs(message.query)
      .then(jobs => sendResponse({ success: true, jobs: jobs }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.type === 'AUTOMATION_STATUS' || message.action === 'automationStatus') {
    handleAutomationStatus(message.data || message.data);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'FORM_ACTION' || message.action === 'formAction') {
    console.log('Received form action request:', message.action, message.data);
    sendResponse({ success: true, message: 'Action received' });
    return true;
  }
  
  const handleAsyncMessage = async (): Promise<MessageResponse> => {
    try {
      if (!message.action) {
        console.warn('Message received without action property:', message);
        return { 
          error: 'No action specified in message',
          success: false 
        };
      }
      
      switch (message.action) {
        case 'parseResume': {
          if (!message.data?.resumeData) {
            throw new ApplicationError('Resume data is required');
          }
          const profile = await parseResumeWithGemini(message.data.resumeData);
          return { profile };
        }
          
        case 'fetchMatchingJobs': {
          if (!message.data?.profile) {
            throw new ApplicationError('Profile data is required');
          }
          const jobs = await getMatchingJobs(message.data.profile);
          return { jobs };
        }
          
        case 'applyToJob': {
          if (!message.data?.jobId) {
            throw new ApplicationError('Job ID is required');
          }
          const result = await handleJobApplication(message.data.jobId);
          return result;
        }
          
        case 'updateJobStatus': {
          if (!message.data?.jobId || !message.data?.status) {
            throw new ApplicationError('Job ID and status are required');
          }
          await updateJobStatus(message.data.jobId, message.data.status);
          return { success: true };
        }
          
        case 'getSavedJobs': {
          const savedJobs = await getSavedJobs();
          return { jobs: savedJobs };
        }
        
        case 'automationAction': 
        case 'clickElement':
        case 'fillForm':
        case 'navigateTo':
        case 'selectOption': {
          console.log(`Handling automation action: ${message.action}`);
          return { success: true, message: `Processed ${message.action}` };
        }
          
        default:
          console.warn(`Unknown action received: ${message.action}`);
          throw new ApplicationError(`Unknown action: ${message.action}`);
      }
    } catch (error) {
      console.error('Error in background script:', error);
      return { 
        error: error instanceof Error ? error.message : 'An unknown error occurred',
        success: false 
      };
    }
  };
  
  handleAsyncMessage().then(sendResponse);
  return true;
});

chrome.runtime.onMessage.addListener((message: { 
  action: string; 
  data: { 
    state: string; 
    jobId: string; 
    message?: string; 
  }; 
}) => {
  if (message.action === 'automationStatus') {
    handleAutomationStatus(message.data);
  }
});

chrome.tabs.onRemoved.addListener((tabId: number) => {
  if (currentJobAutomation?.naukriTabId === tabId) {
    updateJobStatus(currentJobAutomation.jobId, ApplicationStatus.FAILED)
      .then(() => {
        currentJobAutomation = null;
      })
      .catch(console.error);
  }
});

/**
 * Initiates the job application process
 */
async function handleJobApplication(jobId: string): Promise<MessageResponse> {
  try {
    // Get job details and user profile
    const storage = await chrome.storage.local.get(['savedJobs', 'userProfile']);
    const savedJobs: Job[] = storage.savedJobs || [];
    const userProfile: UserProfile = storage.userProfile;
    
    if (!userProfile) {
      throw new ApplicationError('User profile not found');
    }
    
    const job = savedJobs.find(j => j.id === jobId);
    if (!job) {
      throw new ApplicationError('Job not found');
    }
    
    // Update job status to in-progress
    await updateJobStatus(jobId, ApplicationStatus.IN_PROGRESS);
    
    // Start automation
    const naukriTabId = await startAutomation(job, userProfile);
    
    currentJobAutomation = {
      jobId,
      status: ApplicationStatus.IN_PROGRESS,
      naukriTabId
    };
    
    const timeoutId = setTimeout(() => {
      if (currentJobAutomation?.jobId === jobId) {
        updateJobStatus(jobId, ApplicationStatus.FAILED);
        currentJobAutomation = null;
      }
    }, APPLICATION_TIMEOUT);
    
    automationTimeouts.set(jobId, timeoutId);
    
    return { 
      success: true, 
      message: 'Job application started' 
    };
  } catch (error) {
    await updateJobStatus(jobId, ApplicationStatus.FAILED);
    return { 
      error: error instanceof Error ? error.message : 'Failed to start job application',
      success: false 
    };
  }
}

/**
 * Updates a job's application status
 */
async function updateJobStatus(jobId: string, status: ApplicationStatus): Promise<void> {
  try {
    const storage = await chrome.storage.local.get('savedJobs');
    const savedJobs: Job[] = storage.savedJobs || [];
    
    const updatedJobs = savedJobs.map(job => {
      if (job.id === jobId) {
        return { ...job, applicationStatus: status };
      }
      return job;
    });
    
    await chrome.storage.local.set({ savedJobs: updatedJobs });
    
    if (status !== ApplicationStatus.IN_PROGRESS) {
      const timeoutId = automationTimeouts.get(jobId);
      if (timeoutId) {
        clearTimeout(timeoutId);
        automationTimeouts.delete(jobId);
      }
    }
  } catch (error) {
    console.error('Error updating job status:', error);
    throw error;
  }
}

/**
 * Gets all saved jobs
 */
async function getSavedJobs(): Promise<Job[]> {
  try {
    const storage = await chrome.storage.local.get('savedJobs');
    return storage.savedJobs || [];
  } catch (error) {
    console.error('Error getting saved jobs:', error);
    throw error;
  }
}

/**
 * Handles automation status updates from content script
 */
function handleAutomationStatus(data: { state: string; jobId: string; message?: string }): void {
  console.log('[BACKGROUND] Received automation status update:', data);
  
  if (!currentJobAutomation || currentJobAutomation.jobId !== data.jobId) {
    console.log('[BACKGROUND] No active automation or job ID mismatch. Current:', 
                currentJobAutomation?.jobId, 'Received:', data.jobId);
    return;
  }
  
  switch (data.state) {
    case 'completed':
    case ApplicationStatus.APPLIED:
      console.log('[BACKGROUND] Setting job status to APPLIED');
      updateJobStatus(data.jobId, ApplicationStatus.APPLIED)
        .then(() => {
          currentJobAutomation = null;
          
          // Notify all tabs that the job status has changed
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
              if (tab.id) {
                chrome.tabs.sendMessage(tab.id, {
                  action: 'jobStatusChanged',
                  data: { jobId: data.jobId, status: ApplicationStatus.APPLIED }
                }).catch(() => {
                  // Ignore errors from tabs that can't receive messages
                });
              }
            });
          });
        })
        .catch(console.error);
      break;
      
    case 'failed':
    case ApplicationStatus.FAILED:
      console.log('[BACKGROUND] Setting job status to FAILED');
      updateJobStatus(data.jobId, ApplicationStatus.FAILED)
        .then(() => {
          currentJobAutomation = null;
        })
        .catch(console.error);
      break;
      
    case 'progress':
    case ApplicationStatus.IN_PROGRESS:
      console.log(`[BACKGROUND] Application progress: ${data.message}`);
      break;
      
    case ApplicationStatus.UNKNOWN:
      console.log('[BACKGROUND] Setting job status to UNKNOWN (timed out)');
      updateJobStatus(data.jobId, ApplicationStatus.UNKNOWN)
        .then(() => {
          currentJobAutomation = null;
        })
        .catch(console.error);
      break;
  }
}

/**
 * Handles API requests by proxying them to the backend server
 * @param endpoint API endpoint path
 * @param method HTTP method
 * @param data Request data
 * @returns Promise with the API response
 */
async function handleApiRequest(
  endpoint: string, 
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  data?: any
) {
  const baseUrl = config.apiUrl;
  
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  
  const url = `${normalizedBaseUrl}${normalizedEndpoint}`;
  
  console.log(`Making ${method} request to: ${url}`);
  
  if (endpoint.includes('llm-chatbot-action') && data) {
    console.log('LLM Request Data:', {
      question: data.question,
      hasOptions: data.options ? data.options.length : 0,
      hasProfile: !!data.profile,
      hasResumeProfile: !!data.resumeProfile
    });
    
    // Ensure resume data is properly included
    if (data.profile && data.profile.resumeUrl && !data.resumeProfile) {
      try {
        // Try to extract resume text if available
        const resumeText = await extractResumeText(data.profile.resumeUrl);
        if (resumeText) {
          // Add raw resume text to the request
          data.resumeProfile = {
            ...data.profile,
            rawText: resumeText
          };
          console.log('Added raw resume text to LLM request');
        }
      } catch (error) {
        console.error('Error extracting resume text:', error);
      }
    }
  }
  
  // Configure fetch options
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    credentials: 'include'
  };
  
  if (data && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(data);
  }
  
  // Implement retry mechanism
  const MAX_RETRIES = 3;
  let retryCount = 0;
  let lastError;
  
  while (retryCount < MAX_RETRIES) {
    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        throw new Error(`Server responded with status: ${response.status}`);
      }
      
      const result = await response.json();
      
      // Log LLM responses for debugging
      if (endpoint.includes('llm-chatbot-action') && result) {
        console.log('LLM Response:', {
          success: result.success,
          actionType: result.actionType,
          answer: result.answer,
          error: result.error
        });
      }
      
      return result;
    } catch (error) {
      lastError = error;
      retryCount++;
      
      if (retryCount < MAX_RETRIES) {
        // Wait before retrying (exponential backoff)
        const delay = Math.pow(2, retryCount) * 1000;
        console.log(`Retrying API request (${retryCount}/${MAX_RETRIES}) after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('API request failed after multiple retries');
}

/**
 * Helper function to extract text from resume URLs (PDF or other formats)
 * @param resumeUrl URL to the resume file
 * @returns Extracted text or null if extraction fails
 */
async function extractResumeText(resumeUrl?: string): Promise<string | null> {
  if (!resumeUrl) return null;
  
  try {
    // For URLs pointing to PDFs, we can extract the text
    if (resumeUrl.toLowerCase().endsWith('.pdf')) {
      // Fetch the PDF file
      const response = await fetch(resumeUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.statusText}`);
      }
      
      // Get the PDF data as ArrayBuffer
      const pdfData = await response.arrayBuffer();
      
      // Use dynamic import to avoid loading PDF.js unnecessarily
      const { extractResumeDataFromPdf } = await import('./services/pdfParser');
      
      // Extract resume data
      const resumeData = await extractResumeDataFromPdf(pdfData);
      
      console.log('Successfully extracted resume text from PDF');
      return resumeData.text;
    }
    
    // For other file types, we can use a placeholder message
    return `[Resume content from ${resumeUrl}]`;
  } catch (error) {
    console.error('Failed to extract resume text:', error);
    return null;
  }
}

/**
 * Parse a resume file and extract structured data
 */
async function parseResumeFile(file: any, fileType: string): Promise<any> {
  try {
    if (!file) {
      throw new Error('No file provided');
    }
    
    // Convert file data to appropriate format
    let fileData: ArrayBuffer;
    
    if (file instanceof ArrayBuffer) {
      fileData = file;
    } else if (typeof file === 'string') {
      // If file is a Base64 string, convert it to ArrayBuffer
      fileData = base64ToArrayBuffer(file);
    } else {
      throw new Error('Unsupported file format');
    }
    
    // For PDF files
    if (fileType === 'application/pdf' || fileType.toLowerCase().includes('pdf')) {
      const { extractResumeDataFromPdf } = await import('./services/pdfParser');
      const resumeData = await extractResumeDataFromPdf(fileData);
      
      // Send the extracted data to our LLM API for structured parsing
      const structuredProfile = await sendResumeTextToLLM(resumeData.text);
      
      return {
        ...structuredProfile,
        rawText: resumeData.text
      };
    }
    
    // For text files
    if (fileType === 'text/plain') {
      const decoder = new TextDecoder('utf-8');
      const text = decoder.decode(fileData);
      
      // Send the text to our LLM API for structured parsing
      const structuredProfile = await sendResumeTextToLLM(text);
      
      return {
        ...structuredProfile,
        rawText: text
      };
    }
    
    throw new Error('Unsupported file type: ' + fileType);
  } catch (error) {
    console.error('Error parsing resume file:', error);
    throw error;
  }
}

/**
 * Convert Base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // Remove data URL prefix if present
  const base64Data = base64.includes('base64,') 
    ? base64.split('base64,')[1] 
    : base64;
  
  const binaryString = window.atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return bytes.buffer;
}

/**
 * Send resume text to LLM API for structured parsing
 */
async function sendResumeTextToLLM(resumeText: string): Promise<any> {
  try {
    const response = await handleApiRequest(
      'api/parse-resume-text',
      'POST',
      { resumeText }
    );
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to parse resume with LLM');
    }
    
    return response.profile || {};
  } catch (error) {
    console.error('Error sending resume text to LLM:', error);
    
    // Return basic structure with available text
    return {
      name: 'Unknown',
      email: '',
      phone: '',
      summary: resumeText.substring(0, 200) + '...',
      skills: [],
      experience: [],
      education: []
    };
  }
}

// Initialize services when the extension loads
console.log('Extension background script initialized');
console.log('Using API URL:', config.apiUrl);

// Listen for extension installation or update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed or updated:', details.reason);
});