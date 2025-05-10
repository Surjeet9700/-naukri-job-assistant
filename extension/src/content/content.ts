/// <reference types="chrome"/>

import { answerApplicationQuestions, handleNaukriNoticePeriod, checkForFinalSaveButton, handleTechEducationQuestion } from './services/questionAnswering';
import { fillApplicationForm } from './services/formFilling';
import { detectApplicationStatus, detectApplicationCompletionWithLLM, detectApplicationForm, detectApplicationCompletion } from './services/statusDetection';
import { analyzePageContent } from './services/pageAnalyzer';
import { UserProfile } from '../popup/types/profile';
import { ApplicationStatus } from '../popup/types/job';

interface AutomationData {
  jobId: string;
  profile: UserProfile;
  timestamp: number;
}

interface AutomationError extends Error {
  code?: string;
}

let automationRunning = false;
let completionCheckInterval: number | null = null;
let completionCheckCount = 0;
const MAX_COMPLETION_CHECKS = 60; // Maximum number of checks (5 minutes with progressive intervals)

// Get necessary data when the page loads
chrome.storage.local.get('currentAutomation', (data: { currentAutomation?: AutomationData }) => {
  if (data.currentAutomation) {
    const { jobId, profile, timestamp } = data.currentAutomation;
    
    // Check if automation data is fresh (less than 1 minute old)
    if (Date.now() - timestamp < 60000) {
      // Start automation once page is fully loaded
      window.addEventListener('load', () => {
        startNaukriAutomation(jobId, profile);
      });
    }
  }
});

// Listen for commands from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkStatus') {
    const status = detectApplicationStatus();
    sendResponse({ status });
  } else if (message.action === 'checkCompletionWithLLM') {
    // New handler for LLM-based completion detection
    detectApplicationCompletionWithLLM()
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ 
        success: false, 
        error: error.message || 'Failed to check completion status' 
      }));
    return true; // Indicates we'll respond asynchronously
  }
  return true;
});

// Add a global event listener to log if the page is being reloaded or navigated away
window.addEventListener('beforeunload', (e) => {
  console.warn('[AUTOMATION] Page is being reloaded or navigated away!');
});
window.addEventListener('popstate', (e) => {
  console.warn('[AUTOMATION] History navigation detected!');
});

/**
 * Main automation logic for Naukri application
 */
async function startNaukriAutomation(jobId: string, profile: UserProfile): Promise<void> {
  // Prevent multiple automation runs
  if (automationRunning) return;
  automationRunning = true;
  
  try {
    console.log("Testing logs from here")
    console.log('Starting Naukri automation for job:', jobId);
    
    // First check if already applied
    const initialStatus = detectApplicationStatus();
    if (initialStatus === 'applied' || initialStatus === 'already_applied') {
      // Notify that job was already applied
      chrome.runtime.sendMessage({
        action: 'automationStatus',
        data: {
          state: ApplicationStatus.APPLIED,
          jobId,
          message: 'You have already applied to this job'
        }
      });
      return;
    }
    
    // Wait for page to be fully loaded and stable
    await waitForPageStability();
    
    // Check if we have a form or chatbot
    let chatbotContainer = document.querySelector('[id$="ChatbotContainer"], [id*="chatbot_Drawer"], .chatbot-container');
    let applicationForm = document.querySelector('.application-form');
    console.log('[AUTOMATION] Initial chatbotContainer:', !!chatbotContainer, 'applicationForm:', !!applicationForm);
    if (chatbotContainer) {
      console.log('[AUTOMATION] Chatbot mode detected, skipping Apply button logic.');
      await startApplicationQuestionAnswering(profile);
    } else if (applicationForm) {
      await fillApplicationForm(profile);
    } else {
      // Wait up to 15 seconds for chatbot or form to appear before trying Apply
      let chatbotAppeared = false;
      let formAppeared = false;
      for (let i = 0; i < 30; i++) { // 30 checks, 500ms each = 15s
        chatbotContainer = document.querySelector('[id$="ChatbotContainer"], [id*="chatbot_Drawer"], .chatbot-container');
        applicationForm = document.querySelector('.application-form');
        if (chatbotContainer) {
          chatbotAppeared = true;
          break;
        }
        if (applicationForm) {
          formAppeared = true;
          break;
        }
        await new Promise(res => setTimeout(res, 500));
      }
      console.log('[AUTOMATION] After waiting: chatbotAppeared:', chatbotAppeared, 'formAppeared:', formAppeared);
      if (chatbotAppeared) {
        console.log('[AUTOMATION] Chatbot appeared before Apply, skipping Apply button logic.');
        await startApplicationQuestionAnswering(profile);
      } else if (formAppeared) {
        await fillApplicationForm(profile);
      } else {
        // Final check for chatbot/form before clicking Apply
        chatbotContainer = document.querySelector('[id$="ChatbotContainer"], [id*="chatbot_Drawer"], .chatbot-container');
        applicationForm = document.querySelector('.application-form');
        if (chatbotContainer || applicationForm) {
          console.log('[AUTOMATION] Chatbot or form appeared at last moment, skipping Apply button logic.');
          if (chatbotContainer) {
            await startApplicationQuestionAnswering(profile);
          } else {
            await fillApplicationForm(profile);
          }
        } else {
          // Try to click Apply button
          const applySuccess = await clickApplyButtonWithDebug();
          if (!applySuccess) {
            throw new Error('Could not find or click Apply button');
          }
          // Wait for application form or chatbot to appear
          await waitForElement('[id$="ChatbotContainer"], .application-form');
          // Re-check for form or chatbot
          chatbotContainer = document.querySelector('[id$="ChatbotContainer"], [id*="chatbot_Drawer"], .chatbot-container');
          applicationForm = document.querySelector('.application-form');
          if (applicationForm) {
            await fillApplicationForm(profile);
          } else if (chatbotContainer) {
            await startApplicationQuestionAnswering(profile);
          } else {
            throw new Error('Could not find application form or chatbot');
          }
        }
      }
    }
    
    // Start periodic checks for application completion using LLM
    startCompletionDetection(jobId);
    
    // Final check of application status using traditional methods
    const finalStatus = detectApplicationStatus();
    if (finalStatus === 'applied' || finalStatus === 'already_applied') {
      // If traditional detection finds success, report it immediately
      stopCompletionDetection();
      
      // Notify background script of completion
      chrome.runtime.sendMessage({
        action: 'automationStatus',
        data: {
          state: ApplicationStatus.APPLIED,
          jobId,
          message: 'Application successfully submitted'
        }
      });
    } else {
      // If traditional detection doesn't find success, notify that we're waiting for confirmation
      chrome.runtime.sendMessage({
        action: 'automationStatus',
        data: {
          state: ApplicationStatus.IN_PROGRESS,
          jobId,
          message: 'Application process in progress, monitoring for completion...'
        }
      });
      
      // Set a timeout to stop checking after 5 minutes
      setTimeout(() => {
        if (completionCheckInterval) {
          stopCompletionDetection();
          console.log('Stopped completion detection after timeout');
        }
      }, 5 * 60 * 1000); // 5 minutes
    }
  } catch (error) {
    console.error('Automation error:', error);
    const automationError = error as AutomationError;
    
    // Notify background script of failure
    chrome.runtime.sendMessage({
      action: 'automationStatus',
      data: {
        state: ApplicationStatus.FAILED,
        jobId,
        message: automationError.message || 'Application process failed',
        code: automationError.code
      }
    });
  } finally {
    automationRunning = false;
  }
}

/**
 * Start periodic checks for application completion using LLM
 */
function startCompletionDetection(jobId: string): void {
  // Stop any existing interval
  stopCompletionDetection();
  
  console.log('Starting application completion detection');
  completionCheckCount = 0;
  
  // Use an adaptive check interval that starts frequent and becomes less frequent over time
  // to reduce API calls while still being responsive
  const checkCompletion = async () => {
    try {
      if (completionCheckCount >= MAX_COMPLETION_CHECKS) {
        console.log('Reached maximum completion checks, stopping detection');
        stopCompletionDetection();
        return;
      }
      
      completionCheckCount++;
      console.log(`Running completion check #${completionCheckCount}`);
      
      // First try to check if there are no more questions and we need to click a final save button
      // This is critical for Naukri's interface
      if (completionCheckCount > 1) { // Skip on the first check to give time for questions to load
        try {
          const finalSaveButtonClicked = await checkForFinalSaveButton();
          if (finalSaveButtonClicked) {
            console.log('Final save button clicked, waiting for success confirmation');
            // Wait a moment for the application to be processed
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (error) {
          console.error('Error checking for final save button:', error);
        }
      }
      
      const completionStatus = await detectApplicationCompletionWithLLM();
      console.log('Completion check result:', completionStatus);
      
      if (completionStatus.isComplete && completionStatus.confidence > 0.7) {
        // If LLM is confident the application is complete, stop checking and notify
        stopCompletionDetection();
        
        // Notify background script of successful submission
        chrome.runtime.sendMessage({
          action: 'automationStatus',
          data: {
            state: ApplicationStatus.APPLIED,
            jobId,
            message: 'Application successfully submitted: ' + completionStatus.reason
          }
        });
        return;
      }
      
      if (completionCheckInterval !== null) {
        // Continue with adaptive interval timing
        const nextCheckDelay = calculateNextCheckDelay(completionCheckCount);
        completionCheckInterval = window.setTimeout(checkCompletion, nextCheckDelay);
      }
    } catch (error) {
      console.error('Error checking completion status:', error);
      
      if (completionCheckInterval !== null) {
        // If there was an error, wait a bit longer before next check
        completionCheckInterval = window.setTimeout(checkCompletion, 10000);
      }
    }
  };
  
  // Start the first check immediately
  completionCheckInterval = window.setTimeout(checkCompletion, 100);
}

/**
 * Calculate adaptive delay between completion checks
 * Starts with small intervals, then gradually increases
 */
function calculateNextCheckDelay(checkCount: number): number {
  if (checkCount < 5) {
    // First few checks: Every 3 seconds
    return 3000;
  } else if (checkCount < 10) {
    // Next few checks: Every 5 seconds
    return 5000;
  } else if (checkCount < 20) {
    // After 10 checks: Every 10 seconds
    return 10000;
  } else {
    // After 20 checks: Every 15 seconds
    return 15000;
  }
}

/**
 * Stop periodic completion checks
 */
function stopCompletionDetection(): void {
  if (completionCheckInterval !== null) {
    window.clearTimeout(completionCheckInterval);
    completionCheckInterval = null;
  }
}

// Enhanced Apply button click with debug logging
async function clickApplyButtonWithDebug(): Promise<boolean> {
  const applyButtonSelectors = [
    'button[type="button"][class*="apply"]',
    'button[type="button"][class*="btn"]',
    'button.waves-effect',
    '.apply-button-container button',
    '[data-ga-track="spa.apply-job"]',
    '#apply-button',
    '.jobTuple-action-btn',
    'button[class*="apply"]',
    'a[class*="apply"]'
  ];
  await new Promise(resolve => setTimeout(resolve, 2000));
  let foundCandidates: HTMLElement[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const selector of applyButtonSelectors) {
      try {
        const elements = Array.from(document.querySelectorAll(selector));
        foundCandidates.push(...(elements as HTMLElement[]));
        const applyButton = elements.find(el => {
          const text = el.textContent?.toLowerCase() || '';
          return (
            text.includes('apply') && 
            !text.includes('applied') &&
            (el as HTMLElement).offsetParent !== null
          );
        }) as HTMLElement;
        if (applyButton) {
          console.log('[AUTOMATION] Found apply button:', selector, applyButton, applyButton.outerHTML);
          applyButton.click();
          await new Promise(resolve => setTimeout(resolve, 1000));
          return true;
        }
      } catch (e) {
        console.warn(`[AUTOMATION] Error trying selector ${selector}:`, e);
      }
    }
    // If no button found, try looking by text content
    const allButtons = Array.from(document.querySelectorAll('button, a.button, a.btn'));
    foundCandidates.push(...(allButtons as HTMLElement[]));
    const applyButton = allButtons.find(btn => {
      const text = btn.textContent?.toLowerCase() || '';
      return (
        text.includes('apply') && 
        !text.includes('applied') &&
        (btn as HTMLElement).offsetParent !== null
      );
    }) as HTMLElement;
    if (applyButton) {
      console.log('[AUTOMATION] Found apply button by text content', applyButton, applyButton.outerHTML);
      applyButton.click();
      await new Promise(resolve => setTimeout(resolve, 1000));
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  // Log all candidates for debugging
  console.warn('[AUTOMATION] Could not find or click Apply button. Candidates were:', foundCandidates.map(el => ({
    text: el.textContent,
    class: el.className,
    id: el.id,
    disabled: el.hasAttribute('disabled'),
    offsetParent: (el as HTMLElement).offsetParent !== null,
    outerHTML: el.outerHTML
  })));
  return false;
}

/**
 * Waits for page to become stable (no more network activity)
 */
async function waitForPageStability(timeout = 5000): Promise<void> {
  return new Promise(resolve => {
    const lastNetworkActivity = { timestamp: Date.now() };
    const checkInterval = window.setInterval(() => {
      if (Date.now() - lastNetworkActivity.timestamp > 1000) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 200);
    
    // Intercept fetch and XHR to detect network activity
    const originalFetch = window.fetch;
    const originalXHR = XMLHttpRequest.prototype.open;
    
    window.fetch = function(...args) {
      lastNetworkActivity.timestamp = Date.now();
      return originalFetch.apply(this, args);
    };
    
    XMLHttpRequest.prototype.open = function(...args) {
      lastNetworkActivity.timestamp = Date.now();
      return originalXHR.apply(this, args);
    };
    
    // Set timeout
    setTimeout(() => {
      clearInterval(checkInterval);
      window.fetch = originalFetch;
      XMLHttpRequest.prototype.open = originalXHR;
      resolve();
    }, timeout);
  });
}

/**
 * Waits for an element to appear in the DOM
 */
async function waitForElement(selector: string, timeout = 10000): Promise<Element | null> {
  return new Promise((resolve) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }
    
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

/**
 * Handles the process of answering application questions in a chatbot interface
 */
async function startApplicationQuestionAnswering(profile: UserProfile) {
  try {
    console.log('Starting application question answering process');
    
    // Special case for Naukri notice period
    if (window.location.href.includes('naukri.com')) {
      const noticePeriodQuestion = document.querySelector('.chatbot_Drawer, [id*="chatbot_Drawer"]');
      if (noticePeriodQuestion) {
        const questionText = noticePeriodQuestion.textContent || '';
        if (questionText.toLowerCase().includes('notice period')) {
          console.log('Detected Naukri notice period question, using specialized handler');
          await handleNaukriNoticePeriod();
          return;
        }
      }
    }
    
    // If not Naukri notice period, proceed with general question handling
    await answerApplicationQuestions(profile);
  } catch (error) {
    console.error('Error in application question answering:', error);
  }
}

// Main content script execution
(async function() {
  try {
    // Listen for messages from the extension popup or background script
    chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
      console.log('Content script received message:', request.type);
      
      // Important: Return true to indicate we will send a response asynchronously
      if (request.type === 'ANALYZE_PAGE') {
        try {
          const pageAnalysis = await analyzePageContent();
          sendResponse({ success: true, data: pageAnalysis });
        } catch (error) {
          console.error('Error analyzing page:', error);
          sendResponse({ success: false, error: (error as Error).message });
        }
        return true;
      }
      
      if (request.type === 'START_APPLICATION') {
        try {
          const { profile } = request;
          
          // Check if we're on a Naukri notice period question page
          const isNaukriNoticePeriod = (
            document.querySelector('[id*="chatbot_Drawer"]') !== null &&
            document.querySelector('.src_radio-btn-container') !== null &&
            document.body.textContent?.includes('notice period')
          );
          
          if (isNaukriNoticePeriod) {
            console.log('Detected Naukri notice period question, using direct handler');
            await handleNaukriNoticePeriod();
            sendResponse({ success: true });
            return true;
          }
          
          // Check for B.E/B.Tech/CSE/IT education question
          const isEducationQuestion = (
            document.querySelector('[id*="chatbot_Drawer"]') !== null &&
            (document.querySelector('.src_radio-btn-container') !== null || 
             document.querySelector('.ssrc__radio-btn-container') !== null) &&
            document.body.textContent?.includes('B.E/B.Tech/M.E/M.Tech') &&
            document.body.textContent?.includes('CSE/IT')
          );
          
          if (isEducationQuestion) {
            console.log('Detected B.E/B.Tech with CSE/IT question, using specialized handler');
            await handleTechEducationQuestion();
            sendResponse({ success: true });
            return true;
          }
          
          // Detect if this is an application form
          const isApplicationForm = await detectApplicationForm();
          
          if (isApplicationForm) {
            console.log('Application form detected, starting form filling');
            await fillApplicationForm(profile);
          } else {
            console.log('No application form detected, checking for chatbot');
            await startApplicationQuestionAnswering(profile);
          }
          
          sendResponse({ success: true });
        } catch (error) {
          console.error('Error starting application:', error);
          sendResponse({ success: false, error: (error as Error).message });
        }
        return true;
      }
      
      if (request.type === 'CHECK_APPLICATION_COMPLETION') {
        try {
          // Special handling for Naukri notice period page
          const isNaukriNoticePeriod = (
            document.querySelector('[id*="chatbot_Drawer"]') !== null &&
            document.querySelector('.src_radio-btn-container') !== null &&
            document.body.textContent?.includes('notice period')
          );
          
          if (isNaukriNoticePeriod) {
            console.log('Naukri notice period dialog detected - attempting to handle automatically');
            await handleNaukriNoticePeriod();
            // Wait a moment for the UI to update after our action
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          // Special handling for Education question
          const isEducationQuestion = (
            document.querySelector('[id*="chatbot_Drawer"]') !== null &&
            (document.querySelector('.src_radio-btn-container') !== null || 
             document.querySelector('.ssrc__radio-btn-container') !== null) &&
            document.body.textContent?.includes('B.E/B.Tech/M.E/M.Tech') &&
            document.body.textContent?.includes('CSE/IT')
          );
          
          if (isEducationQuestion) {
            console.log('B.E/B.Tech education question detected - handling automatically');
            await handleTechEducationQuestion();
            // Wait a moment for the UI to update
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          const completionStatus = await detectApplicationCompletion();
          sendResponse({ success: true, data: completionStatus });
        } catch (error) {
          console.error('Error checking application completion:', error);
          sendResponse({ success: false, error: (error as Error).message });
        }
        return true;
      }
    });
    
    // Immediate actions when content script loads
    console.log('Content script loaded, performing initial checks');
    
    // Check if this is the Naukri notice period dialog and handle it immediately
    if (
      document.querySelector('[id*="chatbot_Drawer"]') !== null &&
      document.querySelector('.src_radio-btn-container') !== null &&
      document.body.textContent?.includes('notice period')
    ) {
      console.log('Detected Naukri notice period dialog on page load - handling automatically');
      setTimeout(async () => {
        try {
          await handleNaukriNoticePeriod();
          console.log('Successfully handled Naukri notice period dialog');
        } catch (error) {
          console.error('Error handling Naukri notice period dialog:', error);
        }
      }, 1000); // Give the page a second to fully initialize
    }
    
    // Check for B.E/B.Tech education question on page load
    if (
      document.querySelector('[id*="chatbot_Drawer"]') !== null &&
      (document.querySelector('.src_radio-btn-container') !== null ||
       document.querySelector('.ssrc__radio-btn-container') !== null) &&
      document.body.textContent?.includes('B.E/B.Tech/M.E/M.Tech') &&
      document.body.textContent?.includes('CSE/IT')
    ) {
      console.log('Detected B.E/B.Tech education question on page load - handling automatically');
      setTimeout(async () => {
        try {
          // Always select "Yes" for education questions when the user has a B.Tech in CSE
          await handleTechEducationQuestion();
          console.log('Successfully handled B.E/B.Tech education question');
        } catch (error) {
          console.error('Error handling education question:', error);
        }
      }, 1000); // Give the page a second to fully initialize
    }
    
  } catch (error) {
    console.error('Error in content script:', error);
  }
})();