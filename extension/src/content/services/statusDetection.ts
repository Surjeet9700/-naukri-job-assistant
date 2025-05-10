/**
 * Detects the current application status on the Naukri job page
 */
export function detectApplicationStatus(): 'not_started' | 'in_progress' | 'applied' | 'already_applied' | 'failed' {
  // First check for the "Applied" button or success message
  const appliedIndicators = [
    // Direct button text matches
    'button:contains("Applied")',
    'a:contains("Applied")',
    // Success messages
    '.success-message',
    '.confirmation-message',
    '.application-success',
    // Additional selectors for Naukri's UI
    '[data-type="applied"]',
    '.already-applied-status',
    '.applied-success',
    '.applied-text',
    // Text content matches
    'div:contains("Application Submitted Successfully")',
    'div:contains("You have already applied")',
    'div:contains("Thank you for applying")',
    '.applied-status-text'
  ];

  for (const selector of appliedIndicators) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const text = element.textContent?.toLowerCase() || '';
        if (
          text.includes('applied') ||
          text.includes('success') ||
          text.includes('thank you') ||
          text.includes('submitted')
        ) {
          // Check if the element is visible
          const style = window.getComputedStyle(element);
          if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
            return element.textContent?.toLowerCase().includes('already') 
              ? 'already_applied' 
              : 'applied';
          }
        }
      }
    } catch (e) {
      // Ignore selector errors
      console.debug('Selector error:', e);
    }
  }

  // Check for application form or chatbot
  const inProgressIndicators = [
    // Form elements
    '.application-form',
    '#application-form',
    'form[name*="apply"]',
    'form[name*="application"]',
    // Chatbot
    '.chatbot-container',
    '#ChatbotContainer',
    '[id*="chatbot"]',
    // Question form
    '.screening-questions',
    '.application-questions',
    // Generic form with relevant fields
    'form input[name*="resume"]',
    'form input[name*="cv"]',
    'form textarea[name*="cover"]'
  ];

  for (const selector of inProgressIndicators) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        const style = window.getComputedStyle(element);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          return 'in_progress';
        }
      }
    } catch (e) {
      console.debug('Selector error:', e);
    }
  }

  // Check for error messages
  const errorIndicators = [
    '.error-message',
    '.application-error',
    '.error-state',
    'div.error',
    'div:contains("Application Failed")',
    'div:contains("Error submitting")',
    'div:contains("Something went wrong")'
  ];

  for (const selector of errorIndicators) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        const style = window.getComputedStyle(element);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          return 'failed';
        }
      }
    } catch (e) {
      console.debug('Selector error:', e);
    }
  }

  // Check if apply button exists and is clickable
  const applyButtonSelectors = [
    'button[type="button"][class*="apply"]',
    'button.apply-button',
    'button:contains("Apply")',
    'a[class*="apply"]',
    'a:contains("Apply")',
    '[data-type="apply"]'
  ];

  for (const selector of applyButtonSelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (
          element.textContent?.toLowerCase().includes('apply') &&
          !element.hasAttribute('disabled') &&
          !element.classList.contains('disabled')
        ) {
          const style = window.getComputedStyle(element);
          if (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            style.pointerEvents !== 'none'
          ) {
            return 'not_started';
          }
        }
      }
    } catch (e) {
      console.debug('Selector error:', e);
    }
  }

  // If no clear status detected, default to not started
  return 'not_started';
}

// Cache to store previous LLM detection results
const completionDetectionCache = {
  lastRequestTime: 0,
  lastResult: null as null | {
    isComplete: boolean;
    confidence: number;
    reason: string;
    status: 'complete' | 'in_progress' | 'unknown';
    timestamp: number;
  },
  cacheDuration: 10000, // 10 seconds cache duration
  minInterval: 3000, // Minimum 3 seconds between LLM API calls
};

/**
 * Uses LLM to detect if all application questions have been successfully answered
 * and the application has been submitted
 */
export async function detectApplicationCompletionWithLLM(): Promise<{
  isComplete: boolean;
  confidence: number;
  reason: string;
  status: 'complete' | 'in_progress' | 'unknown';
}> {
  try {
    console.log('Starting LLM-based application completion detection');
    
    // First try enhanced client-side detection
    const clientDetectionResult = detectCompletionClientSide();
    if (clientDetectionResult.confidence > 0.7) {
      console.log('Using high-confidence client-side detection:', clientDetectionResult);
      return clientDetectionResult;
    }

    // Check if we should use cached result
    const now = Date.now();
    if (completionDetectionCache.lastResult && 
        now - completionDetectionCache.lastResult.timestamp < completionDetectionCache.cacheDuration) {
      console.log('Using cached completion detection result');
      return completionDetectionCache.lastResult;
    }

    // Check throttling
    if (now - completionDetectionCache.lastRequestTime < completionDetectionCache.minInterval) {
      console.log('Throttling LLM API request - using client detection only');
      return clientDetectionResult;
    }
    completionDetectionCache.lastRequestTime = now;
    
    // Detect Naukri dialog patterns (as seen in screenshot)
    const isNaukriDialog = detectNaukriDialog();
    if (isNaukriDialog) {
      const naukriDialogResult = {
        isComplete: false,
        confidence: 0.8,
        reason: 'Active Naukri application dialog with unanswered questions',
        status: 'in_progress' as const
      };
      completionDetectionCache.lastResult = { ...naukriDialogResult, timestamp: now };
      return naukriDialogResult;
    }
    
    // Send request to the background script to use Gemini API for analysis
    // if we couldn't determine the status confidently
    const response = await sendApiRequestViaBackground(
      'api/analyze-page',
      'POST',
      {
        html: getPageHTML(),
        taskType: 'application_completion_detection',
        currentState: 'checking_completion'
      }
    );
    
    const result = {
      isComplete: response && response.status === 'complete',
      confidence: response?.confidence || 0.7,
      reason: response?.explanation || 'LLM analysis result',
      status: response?.status || 'unknown' as const
    };
    
    // Cache the result
    completionDetectionCache.lastResult = { ...result, timestamp: now };
    return result;
  } catch (error) {
    console.error('Error in LLM-based completion detection:', error);
    
    // On error, fall back to client-side detection
    const fallbackResult = detectCompletionClientSide();
    return {
      ...fallbackResult,
      reason: `API Error - using client detection: ${fallbackResult.reason}`
    };
  }
}

/**
 * Performs enhanced client-side detection for application completion
 * without requiring LLM API calls
 */
function detectCompletionClientSide(): {
  isComplete: boolean;
  confidence: number;
  reason: string;
  status: 'complete' | 'in_progress' | 'unknown';
} {
  // Capture relevant parts of the page
  const visibleContent = getVisibleTextContent();
  
  // Look for common success indicators in the visible content
  const successIndicators = [
    'application submitted',
    'thank you for applying',
    'successfully applied',
    'application complete',
    'application received',
    'we have received your application',
    'all questions answered'
  ];
  
  const containsSuccessIndicator = successIndicators.some(indicator => 
    visibleContent.toLowerCase().includes(indicator.toLowerCase())
  );
  
  if (containsSuccessIndicator) {
    console.log('Found success indicators in visible text');
    return {
      isComplete: true,
      confidence: 0.9,
      reason: 'Success message found on page',
      status: 'complete'
    };
  }
  
  // Check for Naukri-specific completion patterns
  const naukriConfirmationElement = document.querySelector('.confirmed-application, .application-confirmed');
  if (naukriConfirmationElement && isElementVisible(naukriConfirmationElement)) {
    return {
      isComplete: true,
      confidence: 0.9,
      reason: 'Naukri confirmation element found',
      status: 'complete'
    };
  }
  
  // If no obvious success indicators, analyze the page structure
  const noMoreQuestions = !document.querySelector('textarea:not(:disabled):not([readonly])') && 
                          !document.querySelector('input[type="text"]:not(:disabled):not([readonly])') &&
                          !document.querySelector('input[type="radio"]:not(:checked):not(:disabled)');
  
  const hasSubmitConfirmation = Boolean(
    document.querySelector('.confirmation') || 
    document.querySelector('.success') ||
    document.querySelector('[class*="confirm"]') ||
    document.querySelector('[class*="success"]')
  );
  
  if (noMoreQuestions && hasSubmitConfirmation) {
    return {
      isComplete: true,
      confidence: 0.8,
      reason: 'No more input fields and confirmation element found',
      status: 'complete'
    };
  }
  
  // Check for active dialog with questions
  const hasActiveQuestionFields = Boolean(
    document.querySelector('textarea:not(:disabled)') || 
    document.querySelector('input[type="text"]:not(:disabled)') ||
    document.querySelector('input[type="radio"]:not(:disabled)') ||
    document.querySelector('select:not(:disabled)')
  );
  
  if (hasActiveQuestionFields) {
    return {
      isComplete: false,
      confidence: 0.8,
      reason: 'Active input fields still present',
      status: 'in_progress'
    };
  }
  
  // If we can't determine confidently, return low confidence result
  return {
    isComplete: false,
    confidence: 0.5,
    reason: 'Could not confidently determine completion status',
    status: 'unknown'
  };
}

/**
 * Specifically detect Naukri.com application dialogs
 * Similar to the one in the screenshot
 */
function detectNaukriDialog(): boolean {
  // Check for dialog with question pattern matching Naukri screenshot
  const isNoticePeriodQuestion = Boolean(
    document.querySelector('div:contains("What is your notice period?")') || 
    document.querySelector('h3:contains("What is your notice period?")') || 
    document.querySelector('label:contains("What is your notice period?")')
  );
  
  const hasRadioOptions = Boolean(
    document.querySelector('input[type="radio"]') &&
    (document.querySelector('label:contains("15 Days or less")') ||
     document.querySelector('label:contains("1 Month")') ||
     document.querySelector('label:contains("2 Months")') ||
     document.querySelector('label:contains("3 Months")'))
  );
  
  const hasNaukriLogo = Boolean(
    document.querySelector('img[alt*="Naukri"]') ||
    document.querySelector('img[alt*="naukri"]') ||
    document.querySelector('svg[class*="naukri"]')
  );
  
  return (isNoticePeriodQuestion || hasRadioOptions) && hasNaukriLogo;
}

/**
 * Get only the visible text content from the page
 */
function getVisibleTextContent(): string {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Skip script and style nodes
        if (
          node.parentElement &&
          (node.parentElement.tagName === 'SCRIPT' || 
           node.parentElement.tagName === 'STYLE' ||
           isElementHidden(node.parentElement))
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let visibleText = '';
  let node;
  while (node = walker.nextNode()) {
    visibleText += node.nodeValue + ' ';
  }
  
  return visibleText.trim();
}

/**
 * Check if an element is hidden/invisible
 */
function isElementHidden(element: Element): boolean {
  const style = window.getComputedStyle(element);
  return style.display === 'none' || 
         style.visibility === 'hidden' || 
         style.opacity === '0' ||
         element.hasAttribute('hidden');
}

/**
 * Check if an element is visible
 */
function isElementVisible(element: Element): boolean {
  return !isElementHidden(element);
}

/**
 * Get a simplified version of the page HTML for analysis
 * Now with better HTML optimization to reduce token usage
 */
function getPageHTML(): string {
  // Get a simplified version of the page to reduce payload size
  const bodyClone = document.body.cloneNode(true) as HTMLElement;
  
  // Remove scripts, styles, and other non-essential elements
  const nonEssential = bodyClone.querySelectorAll('script, style, link, meta, svg, img');
  nonEssential.forEach(el => el.remove());
  
  // Focus on capturing the most relevant elements for application status detection
  const importantElements = {
    dialogs: Array.from(bodyClone.querySelectorAll('dialog, [role="dialog"], .modal, .popup, .dialog')),
    forms: Array.from(bodyClone.querySelectorAll('form')),
    inputs: Array.from(bodyClone.querySelectorAll('input, textarea, select')),
    buttons: Array.from(bodyClone.querySelectorAll('button, [role="button"], .button')),
    headings: Array.from(bodyClone.querySelectorAll('h1, h2, h3, h4, h5')),
    messages: Array.from(bodyClone.querySelectorAll('.message, .notification, .alert, [class*="success"], [class*="error"], [class*="confirm"]'))
  };
  
  // Construct a minimal HTML representation with just the important elements
  let minimalHTML = '<html><body>';
  
  // Add visible text content
  minimalHTML += `<div id="text-content">${getVisibleTextContent()}</div>`;
  
  // Add important elements
  for (const [category, elements] of Object.entries(importantElements)) {
    minimalHTML += `<div id="${category}">`;
    for (const el of elements) {
      if (isElementVisible(el)) {
        const clone = el.cloneNode(true) as HTMLElement;
        
        // Remove excessive attributes to reduce size
        for (const attr of Array.from(clone.attributes)) {
          if (!['id', 'class', 'type', 'name', 'role'].includes(attr.name)) {
            clone.removeAttribute(attr.name);
          }
        }
        
        minimalHTML += clone.outerHTML;
      }
    }
    minimalHTML += '</div>';
  }
  
  minimalHTML += '</body></html>';
  return minimalHTML;
}

/**
 * Send API requests through the background script to avoid CORS issues
 */
async function sendApiRequestViaBackground(
  endpoint: string,
  method: string = 'GET',
  data: any = null
): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'API_REQUEST',
        endpoint,
        method,
        data
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error sending message:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
          return;
        }
        
        if (response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response.error || 'Unknown error'));
        }
      }
    );
  });
}

/**
 * Detects if the current page contains an application form
 */
export async function detectApplicationForm(): Promise<boolean> {
  // Check for common form indicators
  const formIndicators = [
    // Form containers
    '.application-form',
    '#application-form',
    'form[name*="apply"]',
    'form[name*="application"]',
    // Common form fields
    'textarea[name*="cover"]',
    'input[name*="resume"]',
    'input[name*="cv"]',
    // Chatbot interfaces
    '.chatbot-container',
    '#ChatbotContainer',
    '[id*="chatbot"]',
    // Question interfaces
    '.screening-questions',
    '.application-questions'
  ];

  for (const selector of formIndicators) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        const style = window.getComputedStyle(element);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          return true;
        }
      }
    } catch (e) {
      console.debug('Selector error:', e);
    }
  }

  // Also check for common input types that indicate a form
  const inputTypes = ['text', 'email', 'tel', 'file'];
  for (const type of inputTypes) {
    const inputs = document.querySelectorAll(`input[type="${type}"]:not([readonly]):not([disabled])`);
    if (inputs.length > 0) {
      // Check if inputs are visible
      for (const input of inputs) {
        if (!isElementHidden(input as Element)) {
          return true;
        }
      }
    }
  }

  // Check for textareas
  const textareas = document.querySelectorAll('textarea:not([readonly]):not([disabled])');
  if (textareas.length > 0) {
    for (const textarea of textareas) {
      if (!isElementHidden(textarea as Element)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Simple client-side detection for application completion
 * This is a simplified version compared to LLM-based detection
 */
export async function detectApplicationCompletion(): Promise<{
  isComplete: boolean;
  confidence: number;
  reason: string;
}> {
  // First check for simple completion indicators
  const status = detectApplicationStatus();
  if (status === 'applied' || status === 'already_applied') {
    return {
      isComplete: true,
      confidence: 0.9,
      reason: `Application status detected as: ${status}`
    };
  }

  // Use client-side detection as a fallback
  const clientDetection = detectCompletionClientSide();
  
  // If client detection is confident either way, use it
  if (clientDetection.confidence >= 0.7) {
    return {
      isComplete: clientDetection.isComplete,
      confidence: clientDetection.confidence,
      reason: clientDetection.reason
    };
  }

  // If not confident, default to not complete
  return {
    isComplete: false,
    confidence: 0.5,
    reason: 'Could not confidently determine completion status'
  };
}

// Add this utility function for future use if needed
function safeClickSaveOrApplyButton(selector: string) {
  if (isChatbotActive()) {
    const btn = findSmartSaveButton();
    if (btn) {
      btn.click();
      return;
    }
    console.warn('[GUARD] Chatbot is active, but no smart Save button found:', selector);
    return;
  }
  const btn = document.querySelector(selector) as HTMLElement;
  if (btn && btn.offsetParent !== null && !btn.hasAttribute('disabled')) {
    btn.click();
  }
}

import { isChatbotActive, findSmartSaveButton } from './uiUtils';