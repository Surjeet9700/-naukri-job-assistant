/// <reference types="chrome"/>

// Import the functions we know exist
import { checkForFinalSaveButton, handleTechEducationQuestion, handleNaukriChatbotFlow, findAndClickSaveButton, handleNaukriRadioSelection } from './services/questionAnswering';
import { fillApplicationForm } from './services/formFilling';
import { detectApplicationStatus, detectApplicationCompletionWithLLM, detectApplicationForm, detectApplicationCompletion } from './services/statusDetection';
import { analyzePageContent } from './services/pageAnalyzer';
import { UserProfile } from '../popup/types/profile';
import { ApplicationStatus } from '../popup/types/job';

// Define the missing exports from questionAnswering.ts
// These will be matched by our type declarations
async function answerApplicationQuestions(profile: UserProfile): Promise<boolean> {
  try {
    console.log('Starting application question answering process');
    
    // First check if this is a Naukri chatbot interface
    const chatbotSelectors = [
      '[id*="Drawer"][class*="chatbot"]', 
      '.chatbot_Drawer', 
      '.chatbot_DrawerContentWrapper', 
      '[class*="DrawerContentWrapper"]',
      // Add more specific selectors from the screenshot
      '[id*="_9zis3xx9xInputBox"]',
      '.chatbot_SendMessageContainer',
      '[class*="chatbot_"]'
    ];
    
    let isChatbot = false;
    let matchedSelector = '';
    
    // Try each selector and log what we find
    for (const selector of chatbotSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        isChatbot = true;
        matchedSelector = selector;
        console.log(`[CHAT] Found chatbot element with selector "${selector}":`, element);
        break;
      }
    }
    
    // Special case check for notice period dialog
    if (!isChatbot) {
      const noticeElement = document.querySelector('[id*="SingleSelectRadioButton"], [id$="xSingleSelectRadioButton"]');
      if (noticeElement) {
        console.log('[CHAT] Detected notice period selection dialog:', noticeElement);
        if (document.body.textContent?.includes('notice period')) {
          console.log('[CHAT] Question appears to be about notice period');
          return await handleNaukriNoticePeriod();
        }
      }
    }
    
    if (isChatbot) {
      console.log(`Detected Naukri chatbot interface with selector "${matchedSelector}", using specialized handler`);
      return await handleNaukriChatbotFlow(profile);
    }
    
    // If not chatbot, fall back to general form detection and filling
    console.log('No chatbot detected, checking for standard form');
    const form = await detectApplicationForm();
    
    if (form) {
      console.log('Detected standard application form, filling it');
      try {
        await fillApplicationForm(profile);
        return true; // If no exception was thrown, consider it successful
      } catch (error) {
        console.error('Error filling application form:', error);
        return false;
      }
    }
    
    console.warn('Could not detect chatbot or form structure');
    return false;
  } catch (error) {
    console.error('Error in answerApplicationQuestions:', error);
    return false;
  }
}

async function handleNaukriNoticePeriod(): Promise<boolean> {
  try {
    console.log('[NOTICE] Implementing Naukri notice period selection');
    
    // First look for the container that holds the notice period options
    const radioContainer = document.querySelector('.singleselect-radiobutton-container, [id*="SingleSelectRadioButton"], [id$="SingleSelectRadioButton"]');
    
    if (!radioContainer) {
      console.error('[NOTICE] Could not find notice period radio container, checking for alternative selectors');
      
      // Try the specific ID pattern from the screenshot
      const specificContainer = document.querySelector('[id$="xSingleSelectRadioButton"], [id*="_9zis3xx9xSingleSelectRadioButton"]');
      if (specificContainer) {
        console.log('[NOTICE] Found radio container with specific ID pattern:', specificContainer);
        const radioButtons = specificContainer.querySelectorAll('input[type="radio"]');
        const radioLabels = specificContainer.querySelectorAll('label');
        
        console.log('[NOTICE] Found radio buttons:', radioButtons.length);
        console.log('[NOTICE] Found radio labels:', radioLabels.length);
        
        // If we have radio buttons, select the first one (15 Days or less)
        if (radioButtons.length > 0) {
          const firstRadio = radioButtons[0] as HTMLInputElement;
          firstRadio.checked = true;
          firstRadio.click();
          firstRadio.dispatchEvent(new Event('change', { bubbles: true }));
          
          // Also try clicking the label if available
          if (radioLabels.length > 0) {
            (radioLabels[0] as HTMLElement).click();
          }
          
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Find and click the save button
          await findAndClickSaveButton();
          
          return true;
        }
        
        return false;
      }
      
      return false;
    }
    
    console.log('[NOTICE] Found radio container:', radioContainer);
    
    // Get all radio buttons in the container
    const radioButtons = radioContainer.querySelectorAll('input[type="radio"]');
    const radioLabels = radioContainer.querySelectorAll('.ssrc__label, label');
    
    console.log('[NOTICE] Found radio buttons:', radioButtons.length);
    console.log('[NOTICE] Found radio labels:', radioLabels.length);
    
    // Debug log all radio buttons and their values
    radioButtons.forEach((radio, index) => {
      const input = radio as HTMLInputElement;
      console.log(`[NOTICE] Radio button #${index}:`, {
        id: input.id,
        value: input.value,
        checked: input.checked,
        label: document.querySelector(`label[for="${input.id}"]`)?.textContent
      });
    });
    
    // Get the "15 Days or less" option
    const shortestNoticeOption = Array.from(radioButtons).find(radio => {
      const input = radio as HTMLInputElement;
      const id = input.id;
      const value = input.value;
      const labelText = document.querySelector(`label[for="${id}"]`)?.textContent || '';
      
      return value === '15 Days or less' || 
             id === '15 Days or less' || 
             labelText.includes('15 Days') || 
             labelText.includes('15 days') ||
             (id.toLowerCase().includes('radio') && parseInt(id.replace(/\D/g, '')) === 0);
    }) as HTMLInputElement | undefined;
    
    // If we found the option directly
    if (shortestNoticeOption) {
      console.log('[NOTICE] Found "15 Days or less" option directly');
      
      // Select the radio button
      shortestNoticeOption.checked = true;
      shortestNoticeOption.click();
      shortestNoticeOption.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Also try clicking the label for additional reliability
      const label = document.querySelector(`label[for="${shortestNoticeOption.id}"]`);
      if (label) {
        (label as HTMLElement).click();
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Find and click the save/submit button
      await findAndClickSaveButton();
      
      return true;
    }
    
    // If the direct approach fails, try finding by index or label text
    const radioContainers = radioContainer.querySelectorAll('.ssrc__radio-btn-container');
    
    console.log('[NOTICE] Found radio containers:', radioContainers.length);
    
    // Try the first option (usually the shortest notice period)
    if (radioContainers.length > 0) {
      console.log('[NOTICE] Selecting first radio option (shortest notice period)');
      
      const firstRadio = radioContainers[0].querySelector('input[type="radio"]') as HTMLInputElement;
      if (firstRadio) {
        firstRadio.checked = true;
        firstRadio.click();
        firstRadio.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Also click the label
        const label = radioContainers[0].querySelector('label');
        if (label) {
          (label as HTMLElement).click();
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Find and click the save/submit button
        await findAndClickSaveButton();
        
        return true;
      }
    }
    
    // Final attempt: use the radio selection helper function from questionAnswering
    // Get options as strings for the helper function
    const options = Array.from(radioLabels).map(label => label.textContent || '');
    
    // Select the first option (shortest notice period)
    if (options.length > 0) {
      console.log('[NOTICE] Using radio selection helper with options:', options);
      return await handleNaukriRadioSelection(0, [], options);
    }
    
    console.warn('[NOTICE] Could not find or select any notice period options');
    return false;
  } catch (error) {
    console.error('[NOTICE] Error handling Naukri notice period:', error);
    return false;
  }
}

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
    console.log("Starting Naukri automation for job:", jobId);
    
    // Update UI with starting status
    chrome.runtime.sendMessage({
      action: 'automationStatus',
      data: {
        state: ApplicationStatus.IN_PROGRESS,
        jobId,
        message: 'Starting application process...'
      }
    });
    
    // First check if already applied
    const initialStatus = detectApplicationStatus();
    console.log('[AUTOMATION] Initial status detection:', initialStatus);
    
    if (initialStatus === 'applied' || initialStatus === 'already_applied') {
      console.log('[AUTOMATION] Job already applied, updating status');
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
    
    // Update UI with progress
    chrome.runtime.sendMessage({
      action: 'automationStatus',
      data: {
        state: ApplicationStatus.IN_PROGRESS,
        jobId,
        message: 'Page loaded, beginning application process...'
      }
    });
    
    // Check if we have a form or chatbot
    let chatbotContainer = document.querySelector('[id$="ChatbotContainer"], [id*="chatbot_Drawer"], .chatbot-container');
    let applicationForm = document.querySelector('.application-form');
    console.log('[AUTOMATION] Initial chatbotContainer:', !!chatbotContainer, 'applicationForm:', !!applicationForm);
    if (chatbotContainer) {
      console.log('[AUTOMATION] Chatbot mode detected, skipping Apply button logic.');
      
      // Update UI with progress
      chrome.runtime.sendMessage({
        action: 'automationStatus',
        data: {
          state: ApplicationStatus.IN_PROGRESS,
          jobId,
          message: 'Detected chatbot interview, starting to answer questions...'
        }
      });
      
      await startApplicationQuestionAnswering(profile);
    } else if (applicationForm) {
      // Update UI
      chrome.runtime.sendMessage({
        action: 'automationStatus',
        data: {
          state: ApplicationStatus.IN_PROGRESS,
          jobId,
          message: 'Detected application form, filling out details...'
        }
      });
      
      await fillApplicationForm(profile);
    } else {
      // Wait up to 15 seconds for chatbot or form to appear before trying Apply
      let chatbotAppeared = false;
      let formAppeared = false;
      
      // Update UI
      chrome.runtime.sendMessage({
        action: 'automationStatus',
        data: {
          state: ApplicationStatus.IN_PROGRESS,
          jobId,
          message: 'Looking for application form or chatbot...'
        }
      });
      
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
        
        // Update UI with progress
        chrome.runtime.sendMessage({
          action: 'automationStatus',
          data: {
            state: ApplicationStatus.IN_PROGRESS,
            jobId,
            message: 'Found chatbot interview, starting to answer questions...'
          }
        });
        
        await startApplicationQuestionAnswering(profile);
      } else if (formAppeared) {
        // Update UI
        chrome.runtime.sendMessage({
          action: 'automationStatus',
          data: {
            state: ApplicationStatus.IN_PROGRESS,
            jobId,
            message: 'Found application form, filling out details...'
          }
        });
        
        await fillApplicationForm(profile);
      } else {
        // Final check for chatbot/form before clicking Apply
        chatbotContainer = document.querySelector('[id$="ChatbotContainer"], [id*="chatbot_Drawer"], .chatbot-container');
        applicationForm = document.querySelector('.application-form');
        if (chatbotContainer || applicationForm) {
          console.log('[AUTOMATION] Chatbot or form appeared at last moment, skipping Apply button logic.');
          
          // Update UI
          chrome.runtime.sendMessage({
            action: 'automationStatus',
            data: {
              state: ApplicationStatus.IN_PROGRESS,
              jobId,
              message: chatbotContainer ? 'Starting chatbot interview...' : 'Filling application form...'
            }
          });
          
          if (chatbotContainer) {
            await startApplicationQuestionAnswering(profile);
          } else {
            await fillApplicationForm(profile);
          }
        } else {
          // Update UI
          chrome.runtime.sendMessage({
            action: 'automationStatus',
            data: {
              state: ApplicationStatus.IN_PROGRESS,
              jobId,
              message: 'Looking for Apply button...'
            }
          });
          
          // Try to click Apply button
          const applySuccess = await clickApplyButtonWithDebug();
          if (!applySuccess) {
            throw new Error('Could not find or click Apply button');
          }
          
          // Update UI
          chrome.runtime.sendMessage({
            action: 'automationStatus',
            data: {
              state: ApplicationStatus.IN_PROGRESS,
              jobId,
              message: 'Apply button clicked, waiting for form to appear...'
            }
          });
          
          // Wait for application form or chatbot to appear
          await waitForElement('[id$="ChatbotContainer"], .application-form');
          // Re-check for form or chatbot
          chatbotContainer = document.querySelector('[id$="ChatbotContainer"], [id*="chatbot_Drawer"], .chatbot-container');
          applicationForm = document.querySelector('.application-form');
          if (applicationForm) {
            // Update UI
            chrome.runtime.sendMessage({
              action: 'automationStatus',
              data: {
                state: ApplicationStatus.IN_PROGRESS,
                jobId,
                message: 'Filling out application form...'
              }
            });
            
            await fillApplicationForm(profile);
          } else if (chatbotContainer) {
            // Update UI
            chrome.runtime.sendMessage({
              action: 'automationStatus',
              data: {
                state: ApplicationStatus.IN_PROGRESS,
                jobId,
                message: 'Starting chatbot interview process...'
              }
            });
            
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
    console.log('[AUTOMATION] Final status detection:', finalStatus);
    
    if (finalStatus === 'applied' || finalStatus === 'already_applied') {
      // If traditional detection finds success, report it immediately
      stopCompletionDetection();
      
      console.log('[AUTOMATION] Application successful, setting status to APPLIED');
      
      // Notify background script of completion
      chrome.runtime.sendMessage({
        action: 'automationStatus',
        data: {
          state: ApplicationStatus.APPLIED,
          jobId,
          message: 'Application successfully submitted'
        }
      });
      
      // Double-check message was sent by sending again after a short delay
      setTimeout(() => {
        chrome.runtime.sendMessage({
          action: 'automationStatus',
          data: {
            state: ApplicationStatus.APPLIED,
            jobId,
            message: 'Application successfully submitted (confirmation)'
          }
        });
      }, 1000);
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
          
          // Send final status update
          chrome.runtime.sendMessage({
            action: 'automationStatus',
            data: {
              state: ApplicationStatus.UNKNOWN,
              jobId,
              message: 'Application process timed out, please check manually'
            }
          });
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
    
    // Double check message was sent
    setTimeout(() => {
      chrome.runtime.sendMessage({
        action: 'automationStatus',
        data: {
          state: ApplicationStatus.FAILED,
          jobId,
          message: `Error: ${automationError.message || 'Application process failed'}`,
          code: automationError.code
        }
      });
    }, 1000);
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
    
    // Create a safer override that matches the signature exactly
    XMLHttpRequest.prototype.open = function(
      method: string, 
      url: string | URL, 
      async: boolean = true, 
      username?: string | null, 
      password?: string | null
    ) {
      lastNetworkActivity.timestamp = Date.now();
      // Use Function.prototype.call to avoid the type errors with .apply() and the arguments
      return originalXHR.call(this, method, url, async, username as string, password as string);
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