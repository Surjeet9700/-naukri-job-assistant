/**
 * Detects the current application status on the Naukri job page
 */
export function detectApplicationStatus(): 'not_started' | 'in_progress' | 'applied' | 'already_applied' | 'failed' {
  console.log('[STATUS] Checking application status');
  
  // Debug: Dump all potential applied indicators
  dumpPotentialAppliedIndicators();
  
  // First check for the "Applied" button or success message
  const appliedIndicators = [
    // Direct button text matches
    'button',
    'a',
    // Naukri-specific applied indicators
    'button.applied',
    '.apply-status-text',
    'div.applied',
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
    'div',
    '.applied-status-text',
    // Direct button or element matches
    '[title="Applied"]',
    '[aria-label="Applied"]',
    'span',
    // Additional Naukri success indicators
    '.success-dialog',
    '.success-status',
    '.application-submitted',
    '.applied-checkmark',
    '.applied-icon',
    '.confirmation-screen',
    '.thank-you-screen',
    '.success-confirmation',
    '.confirmation-check',
    // Additional specific classes for the Naukri.com UI
    '.already-applied',
    '.styles_already-applied__4KDhw',
    'span.already-applied',
    'span#already-applied',
    '#already-applied'
  ];

  // First, explicitly check for any button with text "Applied" instead of "Apply"
  const applyButtons = document.querySelectorAll('button, a');
  for (const button of applyButtons) {
    const buttonText = button.textContent?.trim().toLowerCase() || '';
    if (buttonText === 'applied') {
      console.log('[STATUS] Found direct "Applied" button:', button);
      return 'already_applied';
    }
  }
  
  // Direct search for the Applied button structure from the screenshot
  const appliedSpans = document.querySelectorAll('span#already-applied, .already-applied, .styles_already-applied__4KDhw');
  for (const span of appliedSpans) {
    const isVisible = isElementVisible(span);
    if (isVisible) {
      console.log('[STATUS] Found direct Applied span match:', span);
      return 'already_applied';
    }
  }
  
  // Also check for any container with a child that contains "already-applied"
  const containerSelectors = [
    '.styles_jhc__apply-button-container__5Bqnb',
    '[class*="apply-button-container"]',
    '[class*="button-container"]'
  ];
  
  for (const selector of containerSelectors) {
    const containers = document.querySelectorAll(selector);
    for (const container of containers) {
      const appliedChild = container.querySelector('.already-applied, #already-applied, [class*="already-applied"]');
      if (appliedChild && isElementVisible(appliedChild)) {
        console.log('[STATUS] Found applied indicator in container:', container, 'child:', appliedChild);
        return 'already_applied';
      }
      
      // Also check for "Applied" text content without the class
      const text = container.textContent?.toLowerCase() || '';
      if (text.includes('applied') && !text.includes('apply')) {
        console.log('[STATUS] Found container with "applied" text:', container);
        return 'already_applied';
      }
    }
  }

  // Specific check for the Naukri "Applied" indication with the styles_already-applied class
  const naukriAppliedElements = document.querySelectorAll('.styles_already-applied__4KDhw, #already-applied, .already-applied');
  if (naukriAppliedElements.length > 0) {
    for (const element of naukriAppliedElements) {
      const style = window.getComputedStyle(element);
      if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
        console.log('[STATUS] Found specific Naukri applied indicator:', element);
        return 'already_applied';
      }
    }
  }
  
  // Check for the specific button container with already-applied span
  const applyButtonContainers = document.querySelectorAll('.styles_jhc__apply-button-container__5Bqnb, [class*="apply-button-container"]');
  for (const container of applyButtonContainers) {
    const appliedSpan = container.querySelector('.styles_already-applied__4KDhw, .already-applied, #already-applied');
    if (appliedSpan) {
      const style = window.getComputedStyle(appliedSpan);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        console.log('[STATUS] Found Naukri applied button container with applied span:', appliedSpan);
        return 'already_applied';
      }
    }
  }

  // Check for specific indicators
  for (const selector of appliedIndicators) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const text = element.textContent?.toLowerCase() || '';
        if (
          text.includes('applied') ||
          text.includes('success') ||
          text.includes('thank you') ||
          text.includes('submitted') ||
          text.includes('already applied') ||
          text.includes('application submitted') ||
          text.includes('application sent') ||
          text.includes('successfully applied')
        ) {
          // Check if the element is visible
          const style = window.getComputedStyle(element);
          if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
            console.log('[STATUS] Found applied indicator:', element, 'with text:', text);
            
            // Log more detailed information about the success element
            console.log('[STATUS] Success element details:', {
              tagName: element.tagName,
              classes: element.className,
              id: element.id,
              text: element.textContent,
              isVisible: (style.display !== 'none' && style.visibility !== 'hidden')
            });
            
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

  // Additional check: Look for any elements with classes or IDs containing 'applied' or 'success'
  const appliedClassElements = document.querySelectorAll('[class*="applied" i], [class*="success" i], [id*="applied" i], [id*="success" i]');
  for (const element of appliedClassElements) {
    const style = window.getComputedStyle(element);
    if (style.display !== 'none' && style.visibility !== 'hidden') {
      console.log('[STATUS] Found element with applied/success class/id:', element);
      
      // Check if this is specifically an "already applied" indicator by inspecting the class name or text content
      const classes = element.className.toString().toLowerCase();
      const text = element.textContent?.toLowerCase() || '';
      
      if (classes.includes('already-applied') || 
          text.includes('already applied') || 
          text === 'applied' ||
          classes.includes('styles_already-applied')) {
        console.log('[STATUS] Element is specifically an "already applied" indicator');
        return 'already_applied';
      }
      
      return 'applied';
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
    'form textarea[name*="cover"]',
    // Additional Naukri indicators
    '.chatbot_Drawer',
    '[id*="chatbot_Drawer"]',
    '.application-step',
    '.application-flow',
    '.questionnaire',
    '.question-panel'
  ];

  for (const selector of inProgressIndicators) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        const style = window.getComputedStyle(element);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          console.log('[STATUS] Found in_progress indicator:', selector);
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
          console.log('[STATUS] Found error indicator:', selector);
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
            console.log('[STATUS] Found not_started indicator (apply button):', element);
            return 'not_started';
          }
        }
      }
    } catch (e) {
      console.debug('Selector error:', e);
    }
  }

  // Even more specific check for the exact HTML structure from the example
  const alreadyAppliedSpan = document.getElementById('already-applied');
  if (alreadyAppliedSpan && alreadyAppliedSpan.classList.contains('styles_already-applied__4KDhw')) {
    // Try to find the parent container
    const container = alreadyAppliedSpan.closest('.styles_jhc__apply-button-container__5Bqnb');
    if (container || alreadyAppliedSpan.parentElement) {
      console.log('[STATUS] Found exact match for the provided HTML structure:', alreadyAppliedSpan);
      return 'already_applied';
    }
  }
  
  // Check for any span with id "already-applied" regardless of its classes
  if (alreadyAppliedSpan) {
    console.log('[STATUS] Found #already-applied span:', alreadyAppliedSpan);
    return 'already_applied';
  }
  
  // Check specifically for elements with the exact classes from the example
  const exactClassMatch = document.querySelector('.styles_already-applied__4KDhw.already-applied');
  if (exactClassMatch) {
    console.log('[STATUS] Found exact class match:', exactClassMatch);
    return 'already_applied';
  }

  // If no clear status detected, default to not started
  console.log('[STATUS] No clear status detected, defaulting to not_started');
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

/**
 * Debug helper to dump all potential "Applied" indicators on the page
 * This helps diagnose why status detection might be failing
 */
function dumpPotentialAppliedIndicators(): void {
  console.log('[STATUS-DEBUG] Dumping all potential applied indicators on the page:');
  
  // Check for elements with "applied" in their class name
  const appliedClassElements = document.querySelectorAll('[class*="applied" i]');
  console.log(`[STATUS-DEBUG] Found ${appliedClassElements.length} elements with "applied" in class name`);
  
  appliedClassElements.forEach((element, index) => {
    const isVisible = isElementVisible(element);
    const details = {
      tagName: element.tagName,
      className: element.className,
      id: element.id,
      textContent: element.textContent?.trim(),
      isVisible
    };
    console.log(`[STATUS-DEBUG] Element #${index}:`, details);
  });
  
  // Check for elements with "already" text in them
  const alreadyElements = Array.from(document.querySelectorAll('*'))
    .filter(el => el.textContent?.toLowerCase().includes('already'));
  console.log(`[STATUS-DEBUG] Found ${alreadyElements.length} elements containing "already" text`);
  
  // Check for specific Naukri selectors
  const naukriApplied = document.querySelectorAll(
    '#already-applied, .already-applied, .styles_already-applied__4KDhw, .styles_jhc__apply-button-container__5Bqnb'
  );
  
  if (naukriApplied.length > 0) {
    console.log(`[STATUS-DEBUG] Found ${naukriApplied.length} elements matching specific Naukri selectors`);
    naukriApplied.forEach((element, index) => {
      const isVisible = isElementVisible(element);
      const details = {
        tagName: element.tagName,
        className: element.className,
        id: element.id,
        textContent: element.textContent?.trim(),
        isVisible,
        selector: `Element matches specific Naukri selector`,
        outerHTML: element.outerHTML
      };
      console.log(`[STATUS-DEBUG] Naukri Element #${index}:`, details);
    });
  } else {
    console.log(`[STATUS-DEBUG] No elements found matching specific Naukri selectors`);
  }
  
  // Dump elements with "Apply" or "Applied" text
  const applyElements = Array.from(document.querySelectorAll('button, span, div, a'))
    .filter(el => {
      const text = el.textContent?.trim().toLowerCase() || '';
      return text === 'apply' || text === 'applied';
    });
  
  console.log(`[STATUS-DEBUG] Found ${applyElements.length} elements with exact "Apply" or "Applied" text`);
  applyElements.forEach((element, index) => {
    const details = {
      tagName: element.tagName,
      className: element.className,
      id: element.id,
      textContent: element.textContent?.trim(),
      isVisible: isElementVisible(element),
      outerHTML: element.outerHTML
    };
    console.log(`[STATUS-DEBUG] Apply Element #${index}:`, details);
  });
}