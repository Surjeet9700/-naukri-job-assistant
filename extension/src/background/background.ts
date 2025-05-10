import { ApplicationStatus, Job } from '../popup/types/job';
import { UserProfile } from '../popup/types/profile';
import { parseResumeWithGemini } from './services/geminiService';
import { getMatchingJobs } from './services/jobService';
import { startAutomation } from './services/automationService';
import { config } from '../config';

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

// Define message structure for chrome messaging
interface ChromeMessage {
  type: string;
  action?: MessageAction;
  data?: MessageData;
}

// Define response structure for messages
interface MessageResponse {
  profile?: UserProfile;
  jobs?: Job[];
  success?: boolean;
  message?: string;
  error?: string;
}

// Custom error class for application errors
class ApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplicationError';
  }
}

// Constants
const APPLICATION_TIMEOUT = 1 * 60 * 1000; 

// Store of current job automation state
let currentJobAutomation: {
  jobId: string;
  status: ApplicationStatus;
  naukriTabId?: number;
} | null = null;

// Store of automation timeouts
const automationTimeouts = new Map<string, NodeJS.Timeout>();

// Setup message listeners
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);
  
  // Handle API requests from content scripts and popup
  if (message.type === 'API_REQUEST') {
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
  
  // Handle automation requests
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
  
  // Handle job search requests
  if (message.type === 'JOB_SEARCH') {
    getMatchingJobs(message.query)
      .then(jobs => sendResponse({ success: true, jobs: jobs }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  // Handle automation status updates
  if (message.type === 'AUTOMATION_STATUS' || message.action === 'automationStatus') {
    handleAutomationStatus(message.data || message.data);
    sendResponse({ success: true });
    return true;
  }
  
  // Handle specific automation actions (like form filling, clicking buttons)
  if (message.type === 'FORM_ACTION' || message.action === 'formAction') {
    console.log('Received form action request:', message.action, message.data);
    sendResponse({ success: true, message: 'Action received' });
    return true;
  }
  
  const handleAsyncMessage = async (): Promise<MessageResponse> => {
    try {
      // Ensure action is defined before switch statement
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
          // Handle various automation actions
          // IMPORTANT: All UI actions (Apply/Save/Next/Submit) must be guarded by isChatbotActive and use findSmartSaveButton on the content script side.
          // Do NOT trigger Apply/Save clicks directly from background; always send a message and let content script guard it.
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
  
  // Handle asynchronous response
  handleAsyncMessage().then(sendResponse);
  return true; // Indicates async response
});

// Handle automation notification from content script
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

// Handle tab close during automation
chrome.tabs.onRemoved.addListener((tabId: number) => {
  if (currentJobAutomation?.naukriTabId === tabId) {
    // Job application was interrupted by tab close
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
    
    // Store current automation state
    currentJobAutomation = {
      jobId,
      status: ApplicationStatus.IN_PROGRESS,
      naukriTabId
    };
    
    // Set timeout for application
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
    
    // Clean up timeout if exists
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
  if (!currentJobAutomation || currentJobAutomation.jobId !== data.jobId) {
    return;
  }
  
  switch (data.state) {
    case 'completed':
      updateJobStatus(data.jobId, ApplicationStatus.APPLIED)
        .then(() => {
          currentJobAutomation = null;
        })
        .catch(console.error);
      break;
      
    case 'failed':
      updateJobStatus(data.jobId, ApplicationStatus.FAILED)
        .then(() => {
          currentJobAutomation = null;
        })
        .catch(console.error);
      break;
      
    case 'progress':
      // Just log progress updates
      console.log(`Application progress: ${data.message}`);
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
      
      return await response.json();
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

// Initialize services when the extension loads
console.log('Extension background script initialized');
console.log('Using API URL:', config.apiUrl);

// Listen for extension installation or update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed or updated:', details.reason);
});