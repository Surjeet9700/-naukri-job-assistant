import { UserProfile } from '../../popup/types/profile';
import { findSmartSaveButton } from './uiUtils';

/**
 * Send an API request via the background script
 */
export async function sendApiRequestViaBackground(endpoint: string, method: string, data: any): Promise<any> {
  try {
    console.log(`[API] Sending ${method} request to ${endpoint}`);
    
    // If this is an LLM chatbot action request, ensure we have complete profile data
    if (endpoint.includes('llm-chatbot-action') && data && data.profile) {
      console.log('[API] Preparing enhanced profile data for LLM request');
      
      // Extract comprehensive resume context if it's not already included
      if (!data.resumeProfile) {
        data.resumeProfile = extractComprehensiveResumeContext(data.profile);
        console.log('[API] Added comprehensive resume context to request');
      }
      
      // Generate categories for the question to improve LLM context
      if (data.question) {
        const questionLower = data.question.toLowerCase();
        data.questionCategories = {
          projectDescription: questionLower.includes('project') || questionLower.includes('accomplishment'),
          education: isEducationQuestion(data.question),
          experience: isExperienceQuestion(data.question),
          skills: isSkillQuestion(data.question),
          relocation: isRelocationQuestion(data.question),
          salary: isSalaryQuestion(data.question),
          noticePeriod: isNoticePeriodQuestion(data.question),
          personalInfo: questionLower.includes('name') || questionLower.includes('address') || questionLower.includes('about yourself')
        };
        console.log('[API] Added question categories to request', data.questionCategories);
      }
    }

    // Send the request to the background script
    const message = {
      type: 'API_REQUEST',
      endpoint,
      method,
      data
    };
    
    // Add debug logging
    console.log(`[API] Request payload:`, {
      endpoint,
      method,
      dataKeys: data ? Object.keys(data) : null,
      hasProfile: data?.profile ? true : false,
      hasResumeProfile: data?.resumeProfile ? true : false
    });
    
    // Make request with retries
    const MAX_RETRIES = 3;
    let retryCount = 0;
    let lastError;
    
    while (retryCount < MAX_RETRIES) {
      try {
        // Send the message to the background script
        const response = await new Promise<any>((resolve, reject) => {
          chrome.runtime.sendMessage(message, (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (result && result.error) {
              reject(new Error(result.error));
            } else {
              resolve(result);
            }
          });
        });
        
        console.log(`[API] Received response from ${endpoint}:`, response);
        return response;
      } catch (error) {
        lastError = error;
        retryCount++;
        
        console.error(`[API] Request failed (attempt ${retryCount}/${MAX_RETRIES}):`, error);
        
        if (retryCount < MAX_RETRIES) {
          // Wait before retrying (exponential backoff)
          const delay = Math.pow(2, retryCount) * 1000;
          console.log(`[API] Retrying after ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError || new Error(`API request to ${endpoint} failed after ${MAX_RETRIES} attempts`);
  } catch (error) {
    console.error('[API] Error in sendApiRequestViaBackground:', error);
    throw error;
  }
}

/**
 * Enum representing different question formats that can be handled
 */
export enum QuestionFormat {
  TEXT_INPUT = 0,
  RADIO_BUTTONS = 1,
  MULTIPLE_CHOICE = 2,
  DROPDOWN = 3,
  NAUKRI_RADIO_BUTTONS = 4,
  UNKNOWN = 99
}

/**
 * Information about a parsed question from the chatbot or form
 */
interface QuestionInfo {
  questionElement: Element;
  questionText: string;
  format: QuestionFormat;
  options: string[];
}

/**
 * Finds the chatbot container element in the DOM
 */
export function findChatbotContainer(): Element | null {
  // Try multiple possible selectors for chatbot containers
  const selectors = [
    // Naukri-specific selectors based on the HTML structure
    '[id$="Drawer"].chatbot_Drawer',
    '.chatbot_DrawerContentWrapper',
    '[id^="_"][id$="Drawer"]',
    '[class*="Drawer"][class*="chatbot"]',
    '[class*="DrawerContentWrapper"]',
    // Generic selectors
    '[id*="chatbot_Drawer"]',
    '.chatbot_Drawer',
    '[id$="ChatbotContainer"]',
    '.chatbot-container',
    '[id*="chat"]',
    '[class*="chat"]',
    '[role="dialog"]',
    '.modal-content',
    '.conversation-container'
  ];

  for (const selector of selectors) {
    try {
      const elements = document.querySelectorAll(selector);
      // Convert NodeList to Array before iterating
      const elementsArray = Array.from(elements);
      for (const element of elementsArray) {
        if ((element as HTMLElement).offsetParent !== null) {
          console.log(`[CHAT] Found chatbot container with selector "${selector}":`, element);
          return element;
        }
      }
    } catch (error) {
      console.error(`[CHAT] Error finding chatbot container with selector "${selector}":`, error);
    }
  }

  console.warn('[CHAT] Could not find chatbot container');
  return null;
}

/**
 * Analyze the question format and extract the relevant information
 */
export function analyzeQuestionFormat(container: Element): QuestionInfo | null {
  try {
    // Look for bot messages using multiple selectors for better coverage
    const botMessageSelectors = [
      '.botMsg', 
      '.bot-msg', 
      '[class*="bot-message"]',
      '.chatbot_ListItem .botMsg',
      '[class*="botItem"] [class*="msg"]',
      'li.botItem .msg',
      'div.botMsg'
    ];
    
    let botMessages: Element[] = [];
    
    for (const selector of botMessageSelectors) {
      const messages = container.querySelectorAll(selector);
      if (messages.length > 0) {
        botMessages = Array.from(messages);
        console.log(`[QDET] Found bot messages with selector "${selector}":`, botMessages);
        break;
      }
    }
    
    let questionText = '';
    let questionElement: Element | null = null;

    // Try to extract the question text from the last bot message
    if (botMessages.length > 0) {
      questionElement = botMessages[botMessages.length - 1];
      questionText = questionElement.textContent?.trim() || '';
      console.log('[QDET] All candidate bot message texts:', botMessages.map(el => el.textContent?.trim()));
    }

    // If no bot messages found, try other common question containers
    if (!questionText) {
      const questionContainers = container.querySelectorAll('p, h3, h4, span, div:not(:has(*))');
      // Convert NodeList to Array before iterating
      const containerArray = Array.from(questionContainers);
      
      for (const el of containerArray) {
        const text = el.textContent?.trim() || '';
        if (text.length > 3 && text.length < 500 && (text.endsWith('?') || text.includes('?') || isLikelyQuestion(text))) {
          questionElement = el;
          questionText = text;
        break;
        }
      }
    }

    if (!questionElement) {
      console.warn('[QDET] Could not find question element');
      return null;
    }

    console.log('[QDET] Selected question element:', questionElement);
    console.log('[QDET] Question text:', questionText);

    // Detect if this is a radio button question
    const radioButtons = container.querySelectorAll('input[type="radio"]');
    const radioContainers = container.querySelectorAll('.ssrc__radio-btn-container, [class*="radio-btn-container"]');
    
    if (radioButtons.length > 0 || radioContainers.length > 0) {
      console.log('[QDET] Found radio buttons/containers:', {
        radioButtons: radioButtons.length,
        radioContainers: radioContainers.length
      });

      const options: string[] = [];
      
      // Try to collect options from radio button labels
      if (radioButtons.length > 0) {
        radioButtons.forEach(radio => {
          const id = radio.getAttribute('id');
          if (id) {
            const label = document.querySelector(`label[for="${id}"]`);
            if (label && label.textContent) {
              options.push(label.textContent.trim());
            }
          }
        });
      }
      
      // If we couldn't get options from labels, try container text
      if (options.length === 0 && radioContainers.length > 0) {
        radioContainers.forEach(container => {
          const text = container.textContent?.trim();
          if (text) {
            options.push(text);
          }
        });
      }
      
      console.log('[QDET] Detected radio button question with options:', options);
      
      return {
        questionElement,
        questionText,
        format: QuestionFormat.RADIO_BUTTONS,
        options
      };
    }
    
    // Detect if this is a text input question
    const textInputs = container.querySelectorAll('input[type="text"], textarea, [contenteditable="true"], div.textArea');
    if (textInputs.length > 0) {
      return {
        questionElement,
        questionText,
        format: QuestionFormat.TEXT_INPUT,
        options: []
      };
    }
    
    // If there's a contenteditable div in the page, assume it's for text input
    const contentEditableDivs = document.querySelectorAll('[contenteditable="true"], div.textArea');
    if (contentEditableDivs.length > 0) {
      return {
        questionElement,
        questionText,
        format: QuestionFormat.TEXT_INPUT,
        options: []
      };
    }
    
    // Default to text input if we found a question but couldn't determine the format
    // This is safer for Naukri as most questions require text input
    return {
      questionElement,
      questionText,
      format: QuestionFormat.TEXT_INPUT,
      options: []
    };
  } catch (error) {
    console.error('[QDET] Error analyzing question format:', error);
    return null;
  }
}

/**
 * Helper function to identify if a text is likely a question even without a question mark
 */
function isLikelyQuestion(text: string): boolean {
  const questionPatterns = [
    /tell (me|us) about/i,
    /describe your/i,
    /what (is|are|was|were)/i,
    /how (do|did|would|could)/i,
    /why (do|did|would|are)/i,
    /where (is|are|did)/i,
    /when (will|did|can)/i,
    /(full|first|last) name/i,
    /experience/i,
    /education/i,
    /qualification/i,
    /skill/i,
    /phone/i,
    /email/i,
    /address/i
  ];
  
  return questionPatterns.some(pattern => pattern.test(text));
}

/**
 * Handle Naukri's specific radio button UI structure with multiple reliable click strategies
 */
export async function handleNaukriRadioSelection(
  optionIndex: number,
  selectors: string[] | null = [],
  options: string[] = []
): Promise<boolean> {
  console.log('[RADIO] Attempting to select option(s):', optionIndex, 'from options:', options);
  
  // Try direct selection by input radio element first
  try {
    const radioButtons = document.querySelectorAll('input[type="radio"]');
    if (radioButtons && radioButtons.length > optionIndex) {
      (radioButtons[optionIndex] as HTMLInputElement).click();
      console.log('[RADIO] Successfully selected radio button at index', optionIndex);
      return true;
    }
  } catch (error) {
    console.error('[RADIO] Error selecting radio by direct input:', error);
  }
  
  // Find all radio button containers
  const radioContainers = document.querySelectorAll('.ssrc__radio-btn-container, [class*="radio-btn-container"]');
  
  // Specialized for Naukri's ratio buttons which are often not standard radio elements
  const ratioButtonSelectors = [
    '.radio-btn', 
    '[class*="radio-btn"]', 
    '[class*="ratio-btn"]', 
    '[class*="radio_btn"]', 
    'button[role="radio"]',
    // Additional Naukri selectors
    '.src_radio-btn-container',
    '.ssrc__radio-btn-container',
    '[class*="ratio_"]',
    '[role="radio"]',
    '.src_radio',
    '.ssrc__radio',
    '.radio-option',
    '.option-button',
    // Add selector directly from the user's screenshot
    '.singleselect-radiobutton-container input[type="radio"]'
  ];
  
  // Add any custom selectors passed in
  if (selectors && selectors.length) {
    ratioButtonSelectors.push(...selectors);
  }
  
  let anySuccessful = false;
  
  // Try each selector strategy in sequence
  for (const selector of ratioButtonSelectors) {
    try {
      const ratioButtons = document.querySelectorAll(selector);
      console.log(`[RADIO] Found ${ratioButtons.length} ratio buttons with selector:`, selector);
      
      if (ratioButtons.length > 0) {
        // If we have radio buttons but no options (or fewer options than buttons),
        // this might be a different layout where each button is a complete option
        if (options.length === 0 && radioContainers.length > 0) {
          // We found container elements, try to use those
          if (radioContainers.length > optionIndex) {
            const container = radioContainers[optionIndex] as HTMLElement;
            container.click();
            console.log('[RADIO] Clicked container element at index', optionIndex);
            anySuccessful = true;
            break;
          }
        }
        // If we have ratio buttons and they match our options count, select the one at the index
        else if (ratioButtons.length >= options.length && optionIndex < ratioButtons.length) {
          (ratioButtons[optionIndex] as HTMLElement).click();
          console.log('[RADIO] Clicked ratio button at index', optionIndex);
          anySuccessful = true;
          break;
        }
      }
    } catch (e) {
      console.error(`[RADIO] Error using selector ${selector}:`, e);
    }
  }
  
  // If standard approaches failed, try finding by ID or value that matches the option
  if (!anySuccessful && options && options.length > optionIndex) {
    const optionValue = options[optionIndex];
    
    try {
      // Try to find an input with matching ID (common pattern in forms)
      const radioById = document.getElementById(optionValue) as HTMLInputElement;
      if (radioById && radioById.type === 'radio') {
        console.log('[RADIO] Found radio by ID:', radioById);
        radioById.click();
        anySuccessful = true;
      }
    } catch (error) {
      console.error('[RADIO] Error finding radio by ID:', error);
    }
    
    // If still not successful, try more aggressive approaches
    if (!anySuccessful) {
      try {
        // Find any element with text content matching our option
        const elementsWithText = Array.from(document.querySelectorAll('label, span, div'))
          .filter(el => el.textContent?.trim() === optionValue);
          
        if (elementsWithText.length > 0) {
          console.log('[RADIO] Found element with matching text:', elementsWithText[0]);
          (elementsWithText[0] as HTMLElement).click();
          anySuccessful = true;
        }
      } catch (error) {
        console.error('[RADIO] Error with text-based selection:', error);
      }
    }
  }
  
  // After selecting with ratio buttons, look for the Save button and click it if found
  if (anySuccessful) {
    console.log('[RADIO] Successfully selected using ratio button strategy');
    
    // After selecting with ratio buttons, look for the Save button and click it if found
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // First try to find and enable the save button (Naukri specific)
    try {
      // Find the sendMsg div that contains "Save" text
      const saveDiv = document.querySelector('.sendMsg[tabindex="0"]');
      if (saveDiv) {
        console.log('[RADIO] Found Naukri save button:', saveDiv);
        
        // Check if parent has the disabled class and remove it
        const sendParent = saveDiv.closest('.send');
        if (sendParent && sendParent.classList.contains('disabled')) {
          console.log('[RADIO] Removing disabled class from parent');
          sendParent.classList.remove('disabled');
          
          // Wait a moment for any UI updates
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        // Find top-level container
        const container = saveDiv.closest('[id*="sendMsgbtn_container"]');
        if (container) {
          console.log('[RADIO] Found sendMsg container:', container);
          // Make sure it's visible
          (container as HTMLElement).style.display = 'block';
        }
        
        // Click the save button
        (saveDiv as HTMLElement).click();
        console.log('[RADIO] Clicked save button');
        return true;
      }
    } catch (error) {
      console.error('[RADIO] Error handling save button:', error);
    }
  }
  
  return anySuccessful;
}

/**
 * Handle text input response by typing into the appropriate field
 */
export async function handleTextInputAnswer(questionInfo: QuestionInfo, answer: string): Promise<boolean> {
  try {
    // Find potential text input elements in the chatbot container
    const container = questionInfo.questionElement.closest('[id*="chatbot_Drawer"], .chatbot_Drawer, .chatbot_DrawerContentWrapper, [class*="chatbot_Drawer"], [class*="DrawerContentWrapper"]') || document;
    
    // First, try the Naukri-specific method that directly targets their chatbot structure
    const naukriResult = await handleNaukriChatbotInput(container, answer);
    if (naukriResult) {
      return true;
    }
    
    // If Naukri-specific method failed, fall back to generic approach
    // Look for various forms of input elements
    const inputSelectors = [
      'textarea',
      'input[type="text"]',
      '[contenteditable="true"]',
      '[class*="textArea"]',
      '.chatbot_InputContainer [contenteditable]',
      'div[contenteditable]',
      'div.textArea',
      '[id*="userInput"]',
      '[id*="InputBox"][contenteditable]',
      '.textAreaWrapper [contenteditable]'
    ];
    
    let inputElement: HTMLElement | null = null;
    
    // Try each selector until we find a match
    for (const selector of inputSelectors) {
      const elements = container.querySelectorAll(selector);
      if (elements.length > 0) {
        // Use the last element found (usually the active one)
        inputElement = elements[elements.length - 1] as HTMLElement;
        console.log(`[TEXT] Found input element with selector "${selector}":`, inputElement);
        break;
      }
    }
    
    if (!inputElement) {
      console.warn('[TEXT] Could not find input element for text response, trying document-wide search');
      // Try a document-wide search as last resort
      for (const selector of inputSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          inputElement = elements[elements.length - 1] as HTMLElement;
          console.log(`[TEXT] Found input element with document-wide search "${selector}":`, inputElement);
          break;
        }
      }
      
      if (!inputElement) {
        console.error('[TEXT] Could not find any input element for text response');
        return false;
      }
    }
    
    // Clear any existing content
    if (inputElement.tagName === 'INPUT' || inputElement.tagName === 'TEXTAREA') {
      // Standard input/textarea element
      (inputElement as HTMLInputElement).value = '';
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Contenteditable div
      inputElement.textContent = '';
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    // For debugging, check if focus works
    inputElement.focus();
    
    // Type the answer character by character to trigger any character limit events
    const answerChars = answer.split('');
    for (let i = 0; i < answerChars.length; i++) {
      if (inputElement.tagName === 'INPUT' || inputElement.tagName === 'TEXTAREA') {
        (inputElement as HTMLInputElement).value += answerChars[i];
      } else {
        inputElement.textContent += answerChars[i];
      }
      
      // Dispatch input event to trigger any listeners
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Add a small delay for longer answers (but only every few characters to avoid being too slow)
      if (i % 10 === 0 && i > 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    
    // Fire change and blur events to ensure the input is registered
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    inputElement.dispatchEvent(new Event('blur', { bubbles: true }));
    
    // Also try to click the save button
    await findAndClickSaveButton();
    
    console.log('[TEXT] Successfully entered text answer:', answer);
    return true;
  } catch (error) {
    console.error('[TEXT] Error handling text input:', error);
    return false;
  }
}

/**
 * Special handler for Naukri's chatbot input which has a specific structure
 */
async function handleNaukriChatbotInput(container: Element | Document, answer: string): Promise<boolean> {
  try {
    console.log('[NAUKRI] Attempting to handle Naukri chatbot input specifically');
    
    // Find the contenteditable div by matching Naukri's specific structure
    // Look for ID patterns in Naukri's chat interface
    const contentEditableSelectors = [
      // Exact selector from the DOM structure provided
      '[id^="userInput_"][id$="InputBox"]',
      '.textArea[contenteditable="true"]',
      '.textAreaWrapper .textArea[contenteditable="true"]',
      // More generic selectors as fallbacks
      '[id*="userInput"][contenteditable="true"]',
      'div.textArea[contenteditable="true"]',
      '.chatbot_InputContainer .textArea'
    ];
    
    let inputDiv: HTMLElement | null = null;
    
    // Try each selector
    for (const selector of contentEditableSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        inputDiv = elements[elements.length - 1] as HTMLElement;
        console.log(`[NAUKRI] Found Naukri input element with selector "${selector}":`, inputDiv);
        break;
      }
    }
    
    // If nothing found yet, try document-wide
    if (!inputDiv) {
      for (const selector of contentEditableSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          inputDiv = elements[elements.length - 1] as HTMLElement;
          console.log(`[NAUKRI] Found Naukri input element document-wide with selector "${selector}":`, inputDiv);
          break;
        }
      }
    }
    
    // Last resort - try to find by the exact ID format seen in the HTML
    if (!inputDiv) {
      const exactPattern = document.querySelector('[id^="userInput__"][id$="InputBox"]');
      if (exactPattern) {
        inputDiv = exactPattern as HTMLElement;
        console.log('[NAUKRI] Found input by exact Naukri pattern:', inputDiv);
      }
    }
    
    // If we still can't find the input element, try any contenteditable
    if (!inputDiv) {
      const contentEditables = document.querySelectorAll('[contenteditable="true"]');
      if (contentEditables.length > 0) {
        inputDiv = contentEditables[contentEditables.length - 1] as HTMLElement;
        console.log('[NAUKRI] Found generic contenteditable as fallback:', inputDiv);
      }
    }
    
    if (!inputDiv) {
      console.warn('[NAUKRI] Could not find Naukri chatbot input element');
      return false;
    }
    
    console.log('[NAUKRI] Working with input div:', inputDiv);
    
    // Focus the div and clear it
    inputDiv.focus();
    inputDiv.textContent = '';
    inputDiv.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Simulate keyboard typing
    const simulateTyping = async () => {
      // Type each character with a small delay to look more human-like
      for (let i = 0; i < answer.length; i++) {
        // Add character
        inputDiv!.textContent += answer[i];
        
        // Dispatch input event to trigger Naukri's input handlers
        inputDiv!.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Vary the typing speed slightly to look more natural
        const charDelay = Math.floor(Math.random() * 15) + 10; // 10-25ms between characters
        
        // Add slightly longer pauses at natural breaks like spaces or punctuation
        if (answer[i] === ' ' || answer[i] === '.' || answer[i] === ',' || answer[i] === ';') {
          await new Promise(resolve => setTimeout(resolve, charDelay + 50));
        } else if (i % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, charDelay));
        }
      }
    };
    
    await simulateTyping();
    
    // Dispatch events to ensure text is registered
    inputDiv.dispatchEvent(new Event('change', { bubbles: true }));
    
    console.log('[NAUKRI] Text entered into chatbot input:', answer);
    
    // Now find and click the Save button using the exact structure from the HTML
    const saveButtonSelectors = [
      // Exact selectors from the HTML structure provided
      '.sendMsg[tabindex="0"]',
      '#sendMsg__\\w+InputBox .sendMsg',
      '[id^="sendMsg_"] .sendMsg',
      '[id$="sendMsgbtn_container"] .send .sendMsg',
      // Generic fallbacks
      '.send .sendMsg',
      '.sendMsg'
    ];
    
    let saveButton: HTMLElement | null = null;
    let saveButtonParent: HTMLElement | null = null;
    
    // Try to find the save button
    for (const selector of saveButtonSelectors) {
      const buttons = document.querySelectorAll(selector);
      if (buttons.length > 0) {
        saveButton = buttons[buttons.length - 1] as HTMLElement;
        saveButtonParent = saveButton.closest('.send');
        console.log(`[NAUKRI] Found save button with selector "${selector}":`, saveButton);
        break;
      }
    }
    
    if (!saveButton) {
      // Try looking for specific Save button text content
      const potentialSaveButtons = Array.from(document.querySelectorAll('div, button, span'))
        .filter(el => (el.textContent?.trim() === 'Save' || el.textContent?.trim() === 'send'));
        
      if (potentialSaveButtons.length > 0) {
        saveButton = potentialSaveButtons[0] as HTMLElement;
        saveButtonParent = saveButton.closest('.send');
        console.log('[NAUKRI] Found save button by text content:', saveButton);
      }
    }
    
    // Try to find any elements with classes or IDs containing "sendMsg"
    if (!saveButton) {
      const sendElements = document.querySelectorAll('[class*="sendMsg"], [id*="sendMsg"]');
      if (sendElements.length > 0) {
        saveButton = sendElements[0] as HTMLElement;
        saveButtonParent = saveButton.closest('.send') || saveButton.parentElement;
        console.log('[NAUKRI] Found save element by class/id pattern:', saveButton);
      }
    }
    
    if (saveButton) {
      // Wait a moment before clicking save
      await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 200));
      
      // Check if the button is disabled via a parent element
      if (saveButtonParent && saveButtonParent.classList.contains('disabled')) {
        console.log('[NAUKRI] Save button parent is disabled, removing disabled class');
        saveButtonParent.classList.remove('disabled');
        
        // Wait a bit for the change to register
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Make sure the button is visible
      if (saveButton.style.display === 'none') {
        saveButton.style.display = 'block';
      }
      
      // Make sure the container is visible too
      const btnContainer = document.querySelector('[id$="sendMsgbtn_container"]');
      if (btnContainer && (btnContainer as HTMLElement).style.display === 'none') {
        (btnContainer as HTMLElement).style.display = 'block';
      }
      
      // Click the save button
      saveButton.click();
      console.log('[NAUKRI] Clicked save button');
      
      // Wait for UI to update
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 500));
      
      return true;
    } else {
      console.warn('[NAUKRI] Could not find save button');
      return false;
    }
  } catch (error) {
    console.error('[NAUKRI] Error in Naukri chatbot input handler:', error);
    return false;
  }
}

/**
 * Check if there's a new question in the chatbot
 */
export function hasNewQuestion(container: Element): boolean {
  try {
    // Check if there are any radio buttons
    const radioCount = {
      radioButtons: container.querySelectorAll('input[type="radio"]').length,
      radioContainers: container.querySelectorAll('.ssrc__radio-btn-container, [class*="radio-btn-container"]').length
    };
    
    if (radioCount.radioButtons > 0 || radioCount.radioContainers > 0) {
      console.log('[QDET] Found radio buttons/containers:', radioCount);
      
      // Extract options from radio buttons/labels
      const options: string[] = [];
      
      // Try to get options from radio buttons
      container.querySelectorAll('input[type="radio"]').forEach(radio => {
        const id = radio.getAttribute('id');
        if (id) {
          const label = document.querySelector(`label[for="${id}"]`);
          if (label && label.textContent) {
            options.push(label.textContent.trim());
          }
        }
      });
      
      // If we couldn't get options from labels, try container text
      if (options.length === 0) {
        container.querySelectorAll('.ssrc__radio-btn-container, [class*="radio-btn-container"]').forEach(container => {
          const text = container.textContent?.trim();
          if (text) {
            options.push(text);
          }
        });
      }
      
      if (options.length > 0) {
      console.log('[QDET] Detected radio button question with options:', options);
        return true;
      }
    }
    
    // Check for text inputs
    const textInputs = container.querySelectorAll('input[type="text"], textarea, [contenteditable="true"]').length;
    if (textInputs > 0) {
      console.log('[QDET] Found text inputs:', textInputs);
      return true;
    }
    
    // Check for any bot messages that might contain questions
    const botMessages = container.querySelectorAll('.botMsg, .bot-msg, [class*="bot-message"]');
    if (botMessages.length > 0) {
      // Get the last bot message
      const lastMessage = botMessages[botMessages.length - 1];
      // Check if this message has appeared after our last answer
      if (lastMessage && lastMessage.textContent && lastMessage.textContent.trim().length > 0) {
        console.log('[QDET] Found new bot message:', lastMessage.textContent?.trim());
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('[QDET] Error checking for new question:', error);
    return false;
  }
}

/**
 * Extract more comprehensive resume data from the profile for better LLM context
 */
function extractComprehensiveResumeContext(profile: UserProfile): Record<string, any> {
  const resumeData: Record<string, any> = {};
  
  // Add raw text representation for better context
  resumeData.rawText = generateResumeText(profile);
  
  // Add structured data for specific fields - deepcopy everything to ensure complete data
  resumeData.education = JSON.parse(JSON.stringify(profile.education || []));
  resumeData.experience = JSON.parse(JSON.stringify(profile.experience || []));
  resumeData.skills = JSON.parse(JSON.stringify(profile.skills || []));
  
  // Extract key metrics
  resumeData.totalYearsOfExperience = calculateTotalExperience(profile);
  resumeData.currentCompany = getCurrentCompany(profile);
  resumeData.highestEducation = getHighestEducation(profile);
  resumeData.primarySkills = getPrimarySkills(profile);
  resumeData.technicalSkills = extractSkillKeywords(profile);
  
  // Add additional context fields
  if (profile.currentCtc) resumeData.currentCtc = profile.currentCtc;
  if (profile.expectedCtc) resumeData.expectedCtc = profile.expectedCtc;
  if (profile.noticePeriod) resumeData.noticePeriod = profile.noticePeriod;
  if (profile.summary) resumeData.summary = profile.summary;

  // Ensure we're sending all other potentially relevant fields
  Object.keys(profile).forEach(key => {
    const profileKey = key as keyof UserProfile;
    // Skip sensitive fields and already copied fields
    if (key === 'password') {
      return;
    }
    if (!resumeData[profileKey] && profile[profileKey] !== undefined && 
        typeof profile[profileKey] !== 'function') {
      resumeData[profileKey] = profile[profileKey];
    }
  });
  
  return resumeData;
}

/**
 * Answers chatbot questions using LLM backend for smart responses
 * This is used for newer Naukri chatbot interfaces
 */
export async function answerChatbotWithLLM(profile: UserProfile): Promise<boolean> {
  try {
    // Find the chatbot container element
    const container = findChatbotContainer();
    if (!container) {
      console.error('[LLM] Could not find chatbot container');
      return false;
    }
    
    console.log('[LLM] Detected chatbot container. Routing to answerChatbotWithLLM.');
    
    // Track which questions we've already answered to avoid loops
    const answeredQuestions = new Set<string>();
    let sameQuestionCount = 0;
    let lastQuestion = '';
    
    // Process questions until we're done or hit a maximum
    const MAX_STEPS = 30;
    let step = 1;
    
    while (step <= MAX_STEPS) {
      console.log(`[LLM] Processing step ${step}/${MAX_STEPS}`);
      
      // Find the current question
      const questionInfo = findCurrentQuestion();
      
      if (!questionInfo) {
        console.log('[LLM] No question found, checking for completion.');
        const isComplete = await checkForCompletionOrNoMoreQuestions();
        if (isComplete) {
          console.log('[LLM] Application form completed.');
          return true;
        }
        
        // No completion indicator found, wait a bit and try again
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      const { questionText, format, options } = questionInfo;
      
      // Check if we've already answered this question
      if (answeredQuestions.has(questionText)) {
        console.log(`[LLM] Already answered question: "${questionText}"`);
        // If we've seen the same question multiple times in a row, 
        // try an alternative approach or move on
        if (lastQuestion === questionText) {
          sameQuestionCount++;
          if (sameQuestionCount > 2) {
            console.log('[LLM] Stuck on same question, trying alternative approach');
            const altSuccess = await tryAlternativeAnswerApproach(questionInfo, profile);
            if (altSuccess) {
              sameQuestionCount = 0;
              lastQuestion = '';
              await new Promise(resolve => setTimeout(resolve, 2000));
              continue;
            } else {
              console.log('[LLM] Alternative approach failed, moving on...');
              break;
            }
          }
        } else {
          // Reset counter if it's different from the immediate last question
          sameQuestionCount = 1;
        }
        lastQuestion = questionText;
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        continue;
      }
      
      // Special handling for B.E/B.Tech with CSE/IT questions
      if (isBETechCSITQuestion(questionText)) {
        console.log('[LLM] Detected B.E/B.Tech with CSE/IT question, using specialized handler');
        const success = await handleTechEducationQuestion();
        if (success) {
          answeredQuestions.add(questionText);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      
      // Try to handle the question with direct input first (for simple cases)
      const directSuccess = await tryDirectInputApproach(questionInfo, profile);
      if (directSuccess) {
        console.log(`[LLM] Successfully answered question using direct approach: "${questionText}"`);
        answeredQuestions.add(questionText);
        lastQuestion = questionText;
        await new Promise(resolve => setTimeout(resolve, 2000));
        step++;
        continue;
      }
      
      // Special case handling for common patterns
      const specialCase = handleSpecialCaseQuestions(questionInfo, profile);
      if (specialCase) {
        console.log(`[LLM] Using special case handler for question: "${questionText}"`);
        
        let success = false;
        
        if (specialCase.format === QuestionFormat.RADIO_BUTTONS && specialCase.answerIndex !== undefined) {
          // Handle radio button selection
          success = await handleNaukriRadioSelection(specialCase.answerIndex);
        } else if (specialCase.format === QuestionFormat.TEXT_INPUT && specialCase.answerText) {
          // Handle text input
          success = await handleTextInputAnswer(questionInfo, specialCase.answerText);
        }
        
        if (success) {
          console.log(`[LLM] Successfully answered with special case handler: "${questionText}"`);
          answeredQuestions.add(questionText);
          lastQuestion = questionText;
          await new Promise(resolve => setTimeout(resolve, 2000));
          step++;
          continue;
        }
      }
      
      // Generate comprehensive resume context for the LLM
      const resumeContext = extractComprehensiveResumeContext(profile);
      
      // Prepare request for the LLM API
      try {
        console.log(`[LLM] Sending question to LLM API: "${questionText}"`);
        
        // Analyze the question for better context
        const questionCategories = {
          projectDescription: questionText.toLowerCase().includes('project') || questionText.toLowerCase().includes('accomplishment'),
          education: isEducationQuestion(questionText),
          experience: isExperienceQuestion(questionText),
          skills: isSkillQuestion(questionText) || isSkillsQuestion(questionText),
          relocation: isRelocationQuestion(questionText),
          salary: isSalaryQuestion(questionText),
          noticePeriod: isNoticePeriodQuestion(questionText),
          personalInfo: questionText.toLowerCase().includes('name') || questionText.toLowerCase().includes('address')
        };
        
        // Create metadata about the question format
        const questionMetadata = {
          format: QuestionFormat[format],
          hasOptions: options && options.length > 0,
          optionCount: options ? options.length : 0
        };
        
        // Send request to backend LLM API
        const response = await sendApiRequestViaBackground('api/llm-chatbot-action', 'POST', {
          question: questionText,
          options: options || [],
          profile: profile,
          resumeProfile: resumeContext,
          questionMetadata,
          questionCategories
        });
        
        if (!response || response.error) {
          console.error('[LLM] Error from LLM API:', response?.error || 'No response');
          // Fallback to direct approach if LLM fails
          const fallbackSuccess = await tryAlternativeAnswerApproach(questionInfo, profile);
          if (fallbackSuccess) {
            answeredQuestions.add(questionText);
            lastQuestion = questionText;
            await new Promise(resolve => setTimeout(resolve, 2000));
            step++;
          } else {
            console.error('[LLM] Fallback approach also failed for question:', questionText);
          }
          continue;
        }
        
        console.log('[LLM] Received response from LLM API:', response);
        
        // Process the LLM response
        let actionType = response.actionType || 'type';
        let answer = response.answer || '';
        
        // Apply the answer based on the action type
        let answerSuccess = false;
        
        if (actionType === 'select' && options && options.length > 0) {
          // Find the matching option index
          const bestMatch = findBestMatchingOption(answer, options);
          if (bestMatch) {
            const optionIndex = options.indexOf(bestMatch);
            console.log(`[LLM] Selecting option ${optionIndex}: "${bestMatch}"`);
            answerSuccess = await handleNaukriRadioSelection(optionIndex, null, options);
          } else {
            // If no match found, fall back to the first option
            console.log(`[LLM] No match found for "${answer}", using first option`);
            answerSuccess = await handleNaukriRadioSelection(0, null, options);
          }
        } else if (actionType === 'multiSelect') {
          // Handle multi-select questions
          const selectedOptions = Array.isArray(answer) ? answer : [answer];
          answerSuccess = await handleNaukriMultiSelect(questionInfo, selectedOptions);
        } else if (actionType === 'dropdown') {
          // Handle dropdown selection
          answerSuccess = await handleNaukriDropdownSelection(questionInfo, answer);
        } else if (actionType === 'click') {
          // Handle button clicks
          answerSuccess = await handleNaukriButtonClick(questionInfo, answer);
        } else {
          // Default to text input for anything else
          answerSuccess = await handleTextInputAnswer(questionInfo, answer);
        }
        
        if (answerSuccess) {
          console.log(`[LLM] Successfully applied answer: "${answer}" (${actionType})`);
          answeredQuestions.add(questionText);
          lastQuestion = questionText;
          step++;
        } else {
          console.error(`[LLM] Failed to apply answer: "${answer}" (${actionType})`);
          // If the LLM approach failed, try an alternative approach
          const altSuccess = await tryAlternativeAnswerApproach(questionInfo, profile);
          if (altSuccess) {
            answeredQuestions.add(questionText);
            lastQuestion = questionText;
            step++;
          }
        }
      } catch (error) {
        console.error('[LLM] Error in LLM flow:', error);
        // Try an alternative approach if the LLM approach fails
        const altSuccess = await tryAlternativeAnswerApproach(questionInfo, profile);
        if (altSuccess) {
          answeredQuestions.add(questionText);
          lastQuestion = questionText;
          step++;
        }
      }
      
      // Wait before processing the next question
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // After answering all questions (or hitting the max steps), check for a final save button
    const saved = await checkForFinalSaveButton();
    
    return saved || step > 1; // Return true if we've at least answered one question
  } catch (error) {
    console.error('[LLM] Error in answerChatbotWithLLM:', error);
    return false;
  }
}

/**
 * Detects if the question is asking about B.E/B.Tech with CSE/IT
 */
function isBETechCSITQuestion(question: string): boolean {
  const questionLower = question.toLowerCase();
  
  // Check for B.E/B.Tech and CSE/IT patterns
  const hasBETechPattern = (
    questionLower.includes('b.e') || 
    questionLower.includes('b.tech') ||
    questionLower.includes('m.e') ||
    questionLower.includes('m.tech')
  );
  
  const hasCSITPattern = (
    questionLower.includes('cse') ||
    questionLower.includes('it') ||
    questionLower.includes('computer science') ||
    questionLower.includes('information technology')
  );
  
  // Return true if both patterns are found
  return hasBETechPattern && hasCSITPattern;
}

/**
 * Try direct input when there seems to be a loop - more aggressive approach
 */
async function tryDirectInputApproach(questionInfo: QuestionInfo, profile: UserProfile): Promise<boolean> {
  try {
    console.log('[DIRECT] Attempting more aggressive input approach for:', questionInfo.questionText);
    
    // Generate a simple answer based on the question text
    let answer = '';
    const questionLower = questionInfo.questionText.toLowerCase();
    
    // For name-related questions, use name from profile
    if (questionLower.includes('name')) {
      if (questionLower.includes('first')) {
        // Extract first name
        answer = profile.name?.split(' ')[0] || 'John';
      } else if (questionLower.includes('last')) {
        // Extract last name
        const nameParts = profile.name?.split(' ') || [];
        answer = nameParts.length > 1 ? nameParts[nameParts.length - 1] : 'Doe';
      } else {
        // Full name
        answer = profile.name || 'John Doe';
      }
    } 
    // For email
    else if (questionLower.includes('email')) {
      answer = profile.email || 'example@example.com';
    }
    // For phone
    else if (questionLower.includes('phone') || 
             questionLower.includes('mobile') || 
             questionLower.includes('number')) {
      answer = profile.phone || '9999999999';
    }
    // Default generic answers
    else {
      // For text questions, use a simple appropriate response
      answer = getExtendedFallbackResponse(questionInfo, profile);
    }
    
    console.log('[DIRECT] Generated direct answer:', answer);
    
    // For Naukri's chatbot, try the specific structure first
    try {
      // Look for the exact input pattern from the Naukri chatbot
      const naukriInput = document.querySelector('[id^="userInput__"][id$="InputBox"]');
      if (naukriInput) {
        console.log('[DIRECT] Found Naukri-specific input element:', naukriInput);
        
        // Focus and clear
        (naukriInput as HTMLElement).focus();
        (naukriInput as HTMLElement).textContent = '';
        
        // Set the text
        (naukriInput as HTMLElement).textContent = answer;
        naukriInput.dispatchEvent(new Event('input', { bubbles: true }));
        naukriInput.dispatchEvent(new Event('change', { bubbles: true }));
        
        console.log('[DIRECT] Set text in Naukri input');
        
        // Find and enable Naukri's save button
        const saveContainer = document.querySelector('[id^="sendMsg_"]');
        const saveButton = document.querySelector('.sendMsg[tabindex="0"]');
        const saveParent = saveButton?.closest('.send');
        
        if (saveParent && saveParent.classList.contains('disabled')) {
          console.log('[DIRECT] Removing disabled class from save button parent');
          saveParent.classList.remove('disabled');
        }
        
        // Wait a bit before clicking
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (saveButton) {
          (saveButton as HTMLElement).click();
          console.log('[DIRECT] Clicked Naukri save button');
          return true;
        }
      }
    } catch (error) {
      console.error('[DIRECT] Error with Naukri-specific approach:', error);
    }
    
    // If the Naukri-specific approach failed, try a more generic approach
    // Try to find any input mechanism and aggressively enter the answer
    const inputs = document.querySelectorAll('input[type="text"], textarea, [contenteditable="true"]');
    if (inputs.length > 0) {
      const input = inputs[inputs.length - 1] as HTMLElement;
      
      // Clear and enter text aggressively
      if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
        (input as HTMLInputElement).value = answer;
        (input as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
        (input as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        input.textContent = answer;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      
      console.log('[DIRECT] Entered answer directly into input');
      
      // Wait a bit and click any save/continue button
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Find any button-like element with save/continue text
      const saveButtons = Array.from(document.querySelectorAll('button, [role="button"], .button, [class*="btn"], [tabindex="0"]'))
        .filter(el => {
          const text = el.textContent?.toLowerCase() || '';
          return text.includes('save') || text.includes('send') || text.includes('continue') || text.includes('next');
        }) as HTMLElement[];
      
      if (saveButtons.length > 0) {
        saveButtons[0].click();
        console.log('[DIRECT] Clicked save button directly');
        return true;
      }
      
      // If no save button found, try to force continue anyway
      return true;
    }
    
    // If we couldn't find input fields, try radio buttons if available
    if (questionInfo.format === QuestionFormat.RADIO_BUTTONS && questionInfo.options && questionInfo.options.length > 0) {
      // Try to select the first option as a fallback
      await handleNaukriRadioSelection(0, [], questionInfo.options);
      console.log('[DIRECT] Selected first radio option as direct fallback');
      return true;
    }
    
    // If this is a multiple choice question with checkboxes, try selecting the first option
    if (questionInfo.format === QuestionFormat.MULTIPLE_CHOICE && questionInfo.options && questionInfo.options.length > 0) {
      // Select the first checkbox option as fallback
      const firstOption = questionInfo.options[0];
      await handleNaukriMultiSelect(questionInfo, firstOption);
      console.log('[DIRECT] Selected first checkbox option as direct fallback');
      return true;
    }
    
    console.warn('[DIRECT] Could not find any input mechanism for direct approach');
    return false;
  } catch (error) {
    console.error('[DIRECT] Error in direct input approach:', error);
    return false;
  }
}

/**
 * Extract relevant resume data based on question type
 */
function extractResumeContextFromProfile(profile: UserProfile, questionInsights: any): Record<string, any> {
  const resumeData: Record<string, any> = {};
  
  // Add raw text representation for better context
  resumeData.rawText = generateResumeText(profile);
  
  return resumeData;
}

/**
 * Generate a text representation of the resume
 */
function generateResumeText(profile: UserProfile): string {
  let text = `NAME: ${profile.name || ''}\n`;
  text += `EMAIL: ${profile.email || ''}\n`;
  text += `PHONE: ${profile.phone || ''}\n\n`;
  
  if (profile.summary) {
    text += `SUMMARY:\n${profile.summary}\n\n`;
  }
  
  if (profile.skills && profile.skills.length) {
    text += `SKILLS:\n${profile.skills.join(', ')}\n\n`;
  }
  
  if (profile.experience && profile.experience.length) {
    text += `EXPERIENCE:\n`;
    profile.experience.forEach(exp => {
      const current = exp.isCurrent ? "(Current)" : "";
      text += `- ${exp.title || ''} at ${exp.company || ''} ${current}\n`;
      text += `  ${exp.startDate || ''} to ${exp.endDate || 'Present'}\n`;
      if (exp.description) {
        text += `  ${exp.description}\n`;
      }
      text += `\n`;
    });
  }
  
  if (profile.education && profile.education.length) {
    text += `EDUCATION:\n`;
    profile.education.forEach(edu => {
      text += `- ${edu.degree || ''} in ${edu.field || ''} from ${edu.institution || ''}\n`;
      text += `  ${edu.startDate || ''} to ${edu.endDate || ''}\n`;
      if (edu.description) {
        text += `  ${edu.description}\n`;
      }
      text += `\n`;
    });
  }
  
  return text;
}

/**
 * Get highest education from profile
 */
function getHighestEducation(profile: UserProfile): string | null {
  if (!profile.education || profile.education.length === 0) return null;
  
  const educationLevels: Record<string, number> = {
    'ph.d': 5,
    'doctorate': 5,
    'master': 4,
    'm.tech': 4,
    'm.e.': 4,
    'mba': 4,
    'bachelor': 3,
    'b.tech': 3,
    'b.e.': 3,
    'diploma': 2,
    'certificate': 1
  };
  
  let highestLevel = 0;
  let highestEducation = null;
  
  for (const edu of profile.education) {
    const degreeLower = edu.degree.toLowerCase();
    
    for (const [level, value] of Object.entries(educationLevels)) {
      if (degreeLower.includes(level) && value > highestLevel) {
        highestLevel = value;
        highestEducation = edu;
      }
    }
  }
  
  if (highestEducation) {
    return `${highestEducation.degree} in ${highestEducation.field} from ${highestEducation.institution}`;
  }
  
  return profile.education[0].degree;
}

/**
 * Calculate total experience from profile
 */
function calculateTotalExperience(profile: UserProfile): number {
  if (profile.totalYearsOfExperience) return profile.totalYearsOfExperience;
  if (!profile.experience || profile.experience.length === 0) return 0;
  
  let totalMonths = 0;
  
  for (const exp of profile.experience) {
    const startDate = new Date(exp.startDate);
    const endDate = exp.endDate ? new Date(exp.endDate) : new Date();
    
    // Skip invalid dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) continue;
    
    const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + 
                   (endDate.getMonth() - startDate.getMonth());
                   
    totalMonths += Math.max(0, months);
  }
  
  return parseFloat((totalMonths / 12).toFixed(1));
}

/**
 * Get current company from profile
 */
function getCurrentCompany(profile: UserProfile): string | null {
  if (profile.currentCompany) return profile.currentCompany;
  
  const currentJob = profile.experience?.find(exp => exp.isCurrent || !exp.endDate);
  return currentJob ? currentJob.company : null;
}

/**
 * Get primary skills from profile
 */
function getPrimarySkills(profile: UserProfile): string[] {
  if (!profile.skills || profile.skills.length === 0) return [];
  return profile.skills.slice(0, 5);
}

/**
 * Extract skill keywords from profile
 */
function extractSkillKeywords(profile: UserProfile): string[] {
  if (!profile.skills) return [];
  
  // Common technical skills for tech roles
  const techSkills = [
    'java', 'javascript', 'typescript', 'python', 'c++', 'c#', 'ruby',
    'react', 'angular', 'vue', 'node', 'express', 'django', 'flask',
    'spring', 'hibernate', 'sql', 'mysql', 'postgresql', 'mongodb',
    'nosql', 'redis', 'aws', 'azure', 'gcp', 'devops', 'docker',
    'kubernetes', 'jenkins', 'git', 'cicd', 'rest', 'graphql',
    'html', 'css', 'sass', 'tailwind', 'bootstrap', 'jquery',
    'testing', 'jest', 'selenium', 'cypress', 'agile', 'scrum'
  ];
  
  // Extract tech skills from profile's skills
  const profileSkillsLower = profile.skills.map(s => s.toLowerCase());
  return techSkills.filter(skill => 
    profileSkillsLower.some(s => s.includes(skill) || skill.includes(s))
  );
}

/**
 * Check if a question is about education
 */
function isEducationQuestion(question: string): boolean {
  const educationKeywords = [
    'education', 'degree', 'qualification', 'graduate', 'b.tech', 'b.e', 
    'college', 'university', 'institution', 'academic'
  ];
  const questionLower = question.toLowerCase();
  return educationKeywords.some(keyword => questionLower.includes(keyword));
}

/**
 * Check if a question is about experience
 */
function isExperienceQuestion(question: string): boolean {
  const experienceKeywords = [
    'experience', 'work', 'job', 'employment', 'career', 'professional', 
    'years of', 'worked', 'company'
  ];
  const questionLower = question.toLowerCase();
  return experienceKeywords.some(keyword => questionLower.includes(keyword));
}

/**
 * Check if a question is about skills
 */
function isSkillQuestion(question: string): boolean {
  const skillKeywords = [
    'skill', 'technology', 'proficiency', 'knowledge', 'expertise',
    'familiar with', 'work with', 'tech stack', 'programming', 'tools'
  ];
  const questionLower = question.toLowerCase();
  return skillKeywords.some(keyword => questionLower.includes(keyword));
}

/**
 * Check if a question is about notice period
 */
function isNoticePeriodQuestion(question: string): boolean {
  const noticeKeywords = [
    'notice', 'join', 'joining', 'available', 'availability', 'start',
    'when can you', 'how soon', 'start date'
  ];
  const questionLower = question.toLowerCase();
  return noticeKeywords.some(keyword => questionLower.includes(keyword));
}

/**
 * Check if a question is about salary
 */
function isSalaryQuestion(question: string): boolean {
  const salaryKeywords = [
    'salary', 'ctc', 'compensation', 'package', 'pay', 'earning',
    'remuneration', 'income', 'lpa', 'lakhs', 'lacs', 'expected',
    'current salary', 'current ctc', 'salary expectation', 'expected ctc',
    'compensation package', 'wage', 'stipend', 'expected salary'
  ];
  const questionLower = question.toLowerCase();
  // Enhanced detection with debugging
  const isSalary = salaryKeywords.some(keyword => questionLower.includes(keyword)) ||
                 (questionLower.includes('expected') && questionLower.includes('ctc'));
  if (isSalary) {
    console.log(`[SALARY-DETECT] Question "${question}" detected as salary-related`);
  }
  return isSalary;
}

/**
 * Check if a question is about relocation
 */
function isRelocationQuestion(question: string): boolean {
  const relocationKeywords = [
    'relocate', 'relocation', 'move', 'location', 'shift',
    'willing to', 'comfortable with', 'ready to', 'shift to', 
    'transfer to', 'move to', 'relocate to', 'willing to move',
    'relocating', 'available to relocate'
  ];
  const questionLower = question.toLowerCase();
  // Enhanced detection with debugging
  const isRelocation = relocationKeywords.some(keyword => questionLower.includes(keyword)) || 
                     (questionLower.includes('willing') && questionLower.includes('relocate'));
  if (isRelocation) {
    console.log(`[RELOCATION-DETECT] Question "${question}" detected as relocation-related`);
  }
  return isRelocation;
}

/**
 * Generate appropriate relocation response
 */
function generateRelocationResponse(profile: UserProfile): string {
  // Always positive response for relocation questions
  return "Yes, I am willing to relocate for this opportunity. I'm flexible about location and available to move according to company requirements.";
}

/**
 * Generate appropriate salary response
 */
function generateSalaryResponse(profile: UserProfile): string {
  // Customize based on profile if available
  const currentCtc = profile.currentCtc || "6 LPA";
  const expectedCtc = profile.expectedCtc || "10 LPA";
  
  return `My current compensation is around ${currentCtc}, and I'm looking for opportunities in the range of ${expectedCtc}, though I'm somewhat flexible depending on the overall role, benefits, and growth opportunities.`;
}

/**
 * Extract page context to provide more information to the LLM
 */
function extractPageContext(): {
  html: string;
  extracted: Record<string, any>;
} {
  const container = findChatbotContainer() || document.body;
  
  // Get a limited HTML snapshot of the relevant container
  const html = container.innerHTML.substring(0, 5000);
  
  // Extract structured data from the page
  const extracted: Record<string, any> = {
    title: document.title,
    url: window.location.href,
    questionText: findCurrentQuestion()?.questionText || '',
    options: findCurrentQuestion()?.options || []
  };
  
  // Look for job details on the page
  const jobTitleElement = document.querySelector('h1, .job-title, [class*="title"]');
  if (jobTitleElement) {
    extracted.jobTitle = jobTitleElement.textContent?.trim();
  }
  
  // Look for company information
  const companyElement = document.querySelector('.company-name, [class*="company"]');
  if (companyElement) {
    extracted.company = companyElement.textContent?.trim();
  }
  
  return {
    html,
    extracted
  };
}

/**
 * Handle special case questions that have reliable patterns
 */
function handleSpecialCaseQuestions(questionInfo: QuestionInfo, profile: UserProfile): {
  format: QuestionFormat;
  answerIndex?: number;
  answerText?: string;
} | null {
  const questionLower = questionInfo.questionText.toLowerCase();
  
  // Disability percentage questions
  if ((questionLower.includes('disability') || questionLower.includes('differently')) && 
      (questionLower.includes('percentage') || questionLower.includes('%'))) {
    return {
      format: QuestionFormat.TEXT_INPUT,
      answerText: '0%'
    };
  }
  
  // Disability yes/no questions
  if ((questionLower.includes('disability') || questionLower.includes('differently') || 
      questionLower.includes('disabled')) && questionInfo.options && questionInfo.options.length > 0) {
    const noIndex = questionInfo.options.findIndex(opt => 
      opt.toLowerCase() === 'no' || 
      opt.toLowerCase() === 'n' || 
      opt.toLowerCase().includes('none')
    );
    
    if (noIndex !== -1) {
      return {
        format: QuestionFormat.RADIO_BUTTONS,
        answerIndex: noIndex
      };
    }
  }
  
  // Default to null if no special case applies
  return null;
}

/**
 * Find the current question in the chatbot interface
 */
function findCurrentQuestion(): QuestionInfo | null {
  try {
    // Find bot messages
    const botMessages = document.querySelectorAll('.botMsg');
    if (!botMessages || botMessages.length === 0) {
      console.log('[QDET] No bot messages found');
      return null;
    }

    // Get all message texts
    const allMessages = Array.from(botMessages).map(msg => msg.textContent?.trim() || '');
    console.log('[QDET] All candidate bot message texts:', allMessages);

    // Get the last non-empty message as the current question
    const lastNonEmptyMessage = allMessages.filter(msg => msg.length > 0).pop();
    if (!lastNonEmptyMessage) {
      console.log('[QDET] No non-empty messages found');
      return null;
    }

    // Find the element containing this message
    const questionElement = Array.from(botMessages).find(
      msg => msg.textContent?.trim() === lastNonEmptyMessage
    );

    if (!questionElement) {
      console.log('[QDET] Could not find question element');
      return null;
    }

    console.log('[QDET] Selected question element:', questionElement);
    console.log('[QDET] Question text:', lastNonEmptyMessage);

    // Check for active and new form elements to determine if this is a question waiting for input
    // This fixes the loop issue where we keep detecting the same question over and over
    
    // First look for active input fields that have focus or are empty and expecting input
    const activeInputs = document.querySelectorAll('[contenteditable="true"]:focus, input:focus, textarea:focus');
    const emptyInputs = document.querySelectorAll('[contenteditable="true"]:empty, input[value=""], textarea:empty');
    
    // If we don't have any active or empty inputs ready for text entry, this question might have been answered already
    if (activeInputs.length === 0 && emptyInputs.length === 0) {
      // Check if there are user messages after this bot message (indicating it was already answered)
      const userMessages = document.querySelectorAll('.userMsg, .user-msg');
      
      if (userMessages.length > 0) {
        // Get the last user message timestamp or element position
        const lastUserMessageElement = userMessages[userMessages.length - 1];
        
        // If the last user message appears after the current bot message in the DOM, this question was likely answered
        if (questionElement.compareDocumentPosition(lastUserMessageElement) & Node.DOCUMENT_POSITION_FOLLOWING) {
          console.log('[QDET] This question appears to be already answered (user messages found after it)');
          return null;
        }
      }
    }

    // Check for radio buttons - Naukri specific
    const radioButtons = document.querySelectorAll('input[type="radio"]');
    const radioContainers = document.querySelectorAll('.ssrc__radio-btn-container, [class*="radio-btn-container"]');
    
    if (radioButtons.length > 0 || radioContainers.length > 0) {
      console.log('[QDET] Found radio buttons/containers:', { radioButtons: radioButtons.length, radioContainers: radioContainers.length });
      
      // Get radio button options
      const options = Array.from(radioButtons).map(radio => {
        const radioInput = radio as HTMLInputElement;
        const label = document.querySelector(`label[for="${radioInput.id}"]`)?.textContent?.trim();
        return label || radioInput.value;
      });
      
      // If we didn't find options but found containers, try to extract from them
      if (options.length === 0 && radioContainers.length > 0) {
        Array.from(radioContainers).forEach(container => {
          const label = container.querySelector('label')?.textContent?.trim();
          if (label) options.push(label);
        });
      }
      
      if (options.length > 0) {
        console.log('[QDET] Detected radio button question with options:', options);
        return {
          questionElement,
          questionText: lastNonEmptyMessage,
          format: QuestionFormat.RADIO_BUTTONS,
          options
        };
      }
    }

    // Check for text input
    const textInputs = document.querySelectorAll(naukri_selectors.textInput.join(', '));
    if (textInputs.length > 0) {
      // Check if the input is visible and available - to avoid re-answering already answered questions
      const inputVisible = Array.from(textInputs).some(input => {
        const inputElement = input as HTMLElement;
        const rect = inputElement.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(inputElement).display !== 'none';
      });
      
      if (!inputVisible) {
        console.log('[QDET] Input elements exist but are not visible - question likely answered');
        return null;
      }
      
      console.log('[QDET] Detected text input question');
      return {
        questionElement,
        questionText: lastNonEmptyMessage,
        format: QuestionFormat.TEXT_INPUT,
        options: []
      };
    }

    // Check for checkboxes (multiple choice)
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    if (checkboxes.length > 0) {
      const options = Array.from(checkboxes).map(checkbox => {
        const checkboxInput = checkbox as HTMLInputElement;
        const label = document.querySelector(`label[for="${checkboxInput.id}"]`)?.textContent?.trim();
        return label || checkboxInput.value;
      });
      
      console.log('[QDET] Detected checkbox question with options:', options);
      return {
        questionElement,
        questionText: lastNonEmptyMessage,
        format: QuestionFormat.MULTIPLE_CHOICE,
        options
      };
    }

    // Default to text input if we can't determine format but only if we can find an input field
    const possibleInputs = document.querySelectorAll('input[type="text"], textarea, [contenteditable="true"]');
    if (possibleInputs.length > 0) {
      return {
        questionElement,
        questionText: lastNonEmptyMessage,
        format: QuestionFormat.TEXT_INPUT,
        options: []
      };
    }
    
    console.log('[QDET] No input mechanisms found for the question');
    return null;
  } catch (error) {
    console.error('[QDET] Error finding current question:', error);
    return null;
  }
}

/**
 * Try alternative approaches when the standard approach fails
 */
async function tryAlternativeAnswerApproach(questionInfo: QuestionInfo, profile: UserProfile): Promise<boolean> {
  const questionLower = questionInfo.questionText.toLowerCase();
  
  // For Naukri chatbot, first try a specialized approach based on the HTML structure
  try {
    // Generate appropriate answer based on question type
    let answer = '';
    
    // Check for common field types
    if (questionLower.includes('first name')) {
      answer = profile.name?.split(' ')[0] || 'John';
    } else if (questionLower.includes('last name')) {
      const nameParts = profile.name?.split(' ') || [];
      answer = nameParts.length > 1 ? nameParts[nameParts.length - 1] : 'Doe';
    } else if (questionLower.includes('email')) {
      answer = profile.email || 'example@example.com';
    } else if (questionLower.includes('phone') || questionLower.includes('mobile')) {
      answer = profile.phone || '9999999999';
    } else {
      // For other questions, try to generate a smart answer
      answer = await generateSmartAnswer(questionInfo, profile);
    }
    
    console.log('[ALT] Generated answer for Naukri:', answer);
    
    // Find the exact Naukri chatbot input
    const naukriInput = document.querySelector('[id^="userInput__"][id$="InputBox"]');
    if (naukriInput) {
      console.log('[ALT] Found Naukri input:', naukriInput);
      
      // Clear and focus
      (naukriInput as HTMLElement).focus();
      (naukriInput as HTMLElement).textContent = '';
      
      // Enter text
      (naukriInput as HTMLElement).textContent = answer;
      naukriInput.dispatchEvent(new Event('input', { bubbles: true }));
      naukriInput.dispatchEvent(new Event('change', { bubbles: true }));
      
      console.log('[ALT] Successfully entered text in Naukri input element');
      
      // Wait for UI to stabilize
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Enable and click save button
      const saveContainer = document.querySelector('[id$="sendMsgbtn_container"]');
      const saveBtn = document.querySelector('.sendMsg[tabindex="0"]');
      const sendParent = saveBtn?.closest('.send');
      
      // Enable the button if disabled
      if (sendParent && sendParent.classList.contains('disabled')) {
        sendParent.classList.remove('disabled');
      }
      
      if (saveBtn) {
        console.log('[ALT] Found and clicking Naukri save button');
        (saveBtn as HTMLElement).click();
        return true;
      }
    }
  } catch (error) {
    console.error('[ALT] Error with Naukri-specific approach:', error);
  }
  
  // For radio buttons, try clicking directly on the label text
  if (questionInfo.format === QuestionFormat.RADIO_BUTTONS && questionInfo.options) {
    try {
      // Generate best answer
      const answer = await generateSmartAnswer(questionInfo, profile);
      const bestOption = findBestMatchingOption(answer, questionInfo.options);
      
      if (bestOption) {
        // Try to find labels with this text
        const labels = Array.from(document.querySelectorAll('label'))
          .filter(label => label.textContent?.trim() === bestOption);
        
        if (labels.length > 0) {
          console.log('[ALT] Found label with text:', bestOption);
          (labels[0] as HTMLElement).click();
          return true;
        }

        // Try to find any element with this option text
        const elements = Array.from(document.querySelectorAll('div, span, button'))
          .filter(el => el.textContent?.trim() === bestOption);
        
        if (elements.length > 0) {
          console.log('[ALT] Found element with text:', bestOption);
          (elements[0] as HTMLElement).click();
          return true;
        }
      }
    } catch (error) {
      console.error('[ALT] Error with alternative radio approach:', error);
    }
  }
  
  // For multiple choice checkboxes
  if (questionInfo.format === QuestionFormat.MULTIPLE_CHOICE && questionInfo.options) {
    try {
      // Try direct checkbox manipulation
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      if (checkboxes.length > 0) {
        // Select first checkbox as a fallback
        (checkboxes[0] as HTMLInputElement).click();
        console.log('[ALT] Clicked first checkbox as fallback');
        
        // Try to find and click the save button
        await findAndClickSaveButton();
        return true;
      }
      
      // Alternative: Try finding labels and clicking them
      const checkboxLabels = Array.from(document.querySelectorAll('label'))
        .filter(label => {
          const input = document.getElementById(label.htmlFor);
          return input && (input as HTMLInputElement).type === 'checkbox';
        });
        
      if (checkboxLabels.length > 0) {
        (checkboxLabels[0] as HTMLElement).click();
        console.log('[ALT] Clicked first checkbox label as fallback');
        return true;
      }
    } catch (error) {
      console.error('[ALT] Error with alternative checkbox approach:', error);
    }
  }
  
  // For text inputs, try finding any contenteditable div or input field
  if (questionInfo.format === QuestionFormat.TEXT_INPUT) {
    try {
      const answer = await generateSmartAnswer(questionInfo, profile);
      
      // Try all possible input elements
      const inputs = [
        ...Array.from(document.querySelectorAll('input[type="text"]')),
        ...Array.from(document.querySelectorAll('[contenteditable="true"]')),
        ...Array.from(document.querySelectorAll('textarea'))
      ];
      
      for (const input of inputs) {
        try {
          if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
            (input as HTMLInputElement).value = answer;
            (input as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
            (input as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[ALT] Successfully entered text in input element');
            return true;
          } else {
            // For contenteditable
            (input as HTMLElement).textContent = answer;
            (input as HTMLElement).dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[ALT] Successfully entered text in contenteditable element');
            return true;
          }
        } catch (e) {
          console.error('[ALT] Error interacting with input element:', e);
        }
      }
    } catch (error) {
      console.error('[ALT] Error with alternative text input approach:', error);
    }
  }
  
  return false;
}

/**
 * Get an extended fallback response when the LLM fails
 */
function getExtendedFallbackResponse(questionInfo: QuestionInfo, profile: UserProfile): string {
  const questionLower = questionInfo.questionText.toLowerCase();
  
  // Disability questions
  if (questionLower.includes('disability') || questionLower.includes('differently')) {
    if (questionLower.includes('percentage') || questionLower.includes('%')) {
      return '0%';
    }
    return 'No';
  }
  
  // Education questions
  if (isEducationQuestion(questionLower)) {
    if (questionLower.includes('degree') || questionLower.includes('qualification')) {
      return profile.education?.length > 0 
        ? `${profile.education[0].degree || 'Bachelor\'s'} in ${profile.education[0].field || 'Computer Science'}`
        : 'Bachelor\'s in Computer Science';
    }
    
    if (questionLower.includes('university') || questionLower.includes('college')) {
      return profile.education?.length > 0 
        ? (profile.education[0].institution || 'University of Technology')
        : 'University of Technology';
    }
    
    if (questionLower.includes('grade') || questionLower.includes('gpa') || questionLower.includes('percentage')) {
      return '80%';
    }
  }
  
  // Skills or experience
  if (isSkillsQuestion(questionLower) || isExperienceQuestion(questionLower)) {
    return profile.skills?.length > 0
      ? `I have experience with ${profile.skills.slice(0, 3).join(', ')} and other relevant technologies.`
      : 'I have experience with JavaScript, React, and Node.js and other relevant technologies.';
  }
  
  // Salary questions
  if (isSalaryQuestion(questionLower)) {
    return 'As per industry standards';
  }
  
  // Notice period
  if (isNoticePeriodQuestion(questionLower)) {
    return 'Immediate';
  }
  
  // Default generic response
  return 'Yes, I have the relevant qualifications and experience for this position.';
}

/**
 * Handle multiple selection questions in Naukri
 */
async function handleNaukriMultiSelect(questionInfo: QuestionInfo, selectedOptions: string | string[]): Promise<boolean> {
  try {
    const options = Array.isArray(selectedOptions) ? selectedOptions : [selectedOptions];
    
    // Find all checkboxes
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    if (checkboxes.length === 0) {
      console.error('[MULTI] No checkboxes found');
      return false;
    }
    
    let successCount = 0;
    
    // For each option we want to select
    for (const option of options) {
      // Find the checkbox with matching label
      for (const checkbox of Array.from(checkboxes)) {
        const label = document.querySelector(`label[for="${checkbox.id}"]`);
        if (label && label.textContent?.trim().toLowerCase() === option.toLowerCase()) {
          if (!(checkbox as HTMLInputElement).checked) {
            (checkbox as HTMLInputElement).click();
            console.log(`[MULTI] Selected checkbox for option: ${option}`);
            successCount++;
            
            // Add a small delay between selections
            await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 200));
          }
        }
      }
    }
    
    return successCount > 0;
  } catch (error) {
    console.error('[MULTI] Error handling multi-select:', error);
    return false;
  }
}

/**
 * Handle dropdown selection in Naukri
 */
async function handleNaukriDropdownSelection(questionInfo: QuestionInfo, answer: string): Promise<boolean> {
  try {
    // Find dropdown elements
    const dropdowns = document.querySelectorAll('select');
    if (dropdowns.length === 0) {
      console.error('[DROPDOWN] No dropdown elements found');
      return false;
    }
    
    // Try to match the answer to an option
    for (const dropdown of Array.from(dropdowns)) {
      const options = Array.from(dropdown.options);
      const bestMatch = options.find(opt => 
        opt.textContent?.trim().toLowerCase() === answer.toLowerCase() ||
        opt.textContent?.trim().toLowerCase().includes(answer.toLowerCase())
      );
      
      if (bestMatch) {
        // Select the option
        (dropdown as HTMLSelectElement).value = bestMatch.value;
        dropdown.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`[DROPDOWN] Selected option: ${bestMatch.textContent}`);
        return true;
      }
    }
    
    // If no exact match, try to select any non-default option
    for (const dropdown of Array.from(dropdowns)) {
      if (dropdown.options.length > 1) {
        // Select the second option (usually the first non-default)
        (dropdown as HTMLSelectElement).value = dropdown.options[1].value;
        dropdown.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`[DROPDOWN] Selected first non-default option: ${dropdown.options[1].textContent}`);
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('[DROPDOWN] Error handling dropdown selection:', error);
    return false;
  }
}

/**
 * Check if the application process is complete or there are no more questions
 */
async function checkForCompletionOrNoMoreQuestions(): Promise<boolean> {
  // Check for completion messages
  const completionIndicators = [
    'application submitted',
    'thank you for applying',
    'your application has been received',
    'successfully applied',
    'we will get back to you'
  ];
  
  const pageText = document.body.textContent?.toLowerCase() || '';
  
  for (const indicator of completionIndicators) {
    if (pageText.includes(indicator)) {
      console.log(`[COMPLETION] Found completion indicator: ${indicator}`);
      return true;
    }
  }
  
  // Check if there's a noticeable period with no new questions
  const noQuestionsTimeout = 5000; // 5 seconds
  
  // Wait to see if a new question appears
  await new Promise(resolve => setTimeout(resolve, noQuestionsTimeout));
  
  // Re-check for questions after waiting
  const botMessages = document.querySelectorAll('.botMsg');
  if (!botMessages || botMessages.length === 0) {
    console.log('[COMPLETION] No bot messages found after waiting');
    return true;
  }
  
  // Get the latest message
  const latestMessage = Array.from(botMessages)
    .map(msg => msg.textContent?.trim() || '')
    .filter(msg => msg.length > 0)
    .pop();
  
  // If the latest message contains a completion indicator, we're done
  if (latestMessage) {
    for (const indicator of completionIndicators) {
      if (latestMessage.toLowerCase().includes(indicator)) {
        console.log(`[COMPLETION] Latest message contains completion indicator: ${indicator}`);
        return true;
      }
    }
  }
  
  // If we're still not sure, check one more time for any button that might advance us
  const finalButtons = document.querySelectorAll('button, [role="button"]');
  for (const button of Array.from(finalButtons)) {
    const buttonText = button.textContent?.trim().toLowerCase() || '';
    
    if (['submit', 'finish', 'complete', 'apply', 'done'].some(keyword => buttonText.includes(keyword))) {
      console.log(`[COMPLETION] Found final button: ${buttonText}`);
      (button as HTMLElement).click();
      return true;
    }
  }
  
  return false;
}

// Naukri-specific selectors for various elements
const naukri_selectors = {
  radioButton: [
    '.ssrc__radio-btn-container',
    '.singleselect-radiobutton-container input[type="radio"]',
    '[class*="radio-btn"]',
    '.ssrc__radio'
  ],
  saveButton: [
    '.sendMsg[tabindex="0"]',
    '.send .sendMsg',
    '.sendMsgbtn_container .sendMsg'
  ],
  textInput: [
    '[id^="userInput_"][contenteditable="true"]',
    '.textArea[contenteditable="true"]',
    '.chatbot_InputContainer .textArea'
  ],
  dropdown: [
    '.select-dropdown',
    'select.form-control',
    '[class*="dropdown"]'
  ],
  multiSelect: [
    '.checkbox-container',
    'input[type="checkbox"]',
    '[class*="checkbox"]'
  ]
};

/**
 * Finds and clicks the save button to submit answers
 */
export async function findAndClickSaveButton(): Promise<boolean> {
  try {
    // Use the utility function to find the save button
    const saveButton = findSmartSaveButton();
    
    if (!saveButton) {
      console.warn('[SAVE] Could not find save button');
      return false;
    }
    
    console.log('[SAVE] Found save button:', saveButton, saveButton.outerHTML);
    
    // Add a small delay before clicking to simulate natural interaction
    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 500));
    
    // Click the save button
    saveButton.click();
    console.log('[SAVE] Clicked save button');
    
    // Add a small delay after clicking to wait for page to respond
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 500));
    
    return true;
  } catch (error) {
    console.error('[SAVE] Error clicking save button:', error);
    return false;
  }
}

/**
 * Handles button clicks for Naukri chatbot interface
 */
export async function handleNaukriButtonClick(questionInfo: QuestionInfo, buttonText: string): Promise<boolean> {
  try {
    // Find buttons that match the text
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"], [tabindex="0"]'))
      .filter(el => (el.textContent || '').trim().toLowerCase() === buttonText.toLowerCase()) as HTMLElement[];
    
    if (buttons.length === 0) {
      console.warn(`[BTNCLICK] Could not find button with text "${buttonText}"`);
      return false;
    }
    
    // Add a small delay before clicking to simulate natural interaction
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 300));
    
    // Click the first matching button
    buttons[0].click();
    console.log(`[BTNCLICK] Clicked button with text "${buttonText}"`);
    
    // Add a small delay after clicking
    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 400));
    
    return true;
  } catch (error) {
    console.error('[BTNCLICK] Error clicking button:', error);
    return false;
  }
}

/**
 * Generates a smart answer for a question using the LLM
 */
async function generateSmartAnswer(questionInfo: QuestionInfo, profile: UserProfile): Promise<string> {
  try {
    // Extract context from the page
    const pageContext = extractPageContext();
    
    // Send request to backend API
    const response = await sendApiRequestViaBackground(
      'api/llm-chatbot-action',
      'POST',
      {
        question: questionInfo.questionText,
        options: questionInfo.options,
        profile,
        questionFormat: QuestionFormat[questionInfo.format],
        pageHtml: pageContext.html,
        resumeProfile: profile,
        pageContext: pageContext.extracted
      }
    );
    
    // Return the answer from the response
    if (response && response.answer) {
      return response.answer;
    }
    
    // If no answer from backend, use fallback
    return getExtendedFallbackResponse(questionInfo, profile);
  } catch (error) {
    console.error('[LLM] Error generating smart answer:', error);
    return getExtendedFallbackResponse(questionInfo, profile);
  }
}

/**
 * Finds the best matching option based on answer and available options
 */
function findBestMatchingOption(answer: string, options: string[]): string | null {
  if (!options || options.length === 0) {
    return null;
  }
  
  // Direct match
  const directMatch = options.find(opt => 
    opt.toLowerCase() === answer.toLowerCase() || 
    answer.toLowerCase().includes(opt.toLowerCase())
  );
  
  if (directMatch) {
    return directMatch;
  }
  
  // Fuzzy match - simple implementation
  // Find option with most word overlaps
  const answerWords = answer.toLowerCase().split(/\s+/);
  
  let bestMatch = null;
  let maxOverlap = 0;
  
  for (const option of options) {
    const optionWords = option.toLowerCase().split(/\s+/);
    let overlap = 0;
    
    for (const word of answerWords) {
      if (optionWords.some(w => w.includes(word) || word.includes(w))) {
        overlap++;
      }
    }
    
    if (overlap > maxOverlap) {
      maxOverlap = overlap;
      bestMatch = option;
    }
  }
  
  return bestMatch;
}

/**
 * Checks if a question is related to skills
 */
function isSkillsQuestion(question: string): boolean {
  const skillsKeywords = ['skill', 'technology', 'technical knowledge', 'programming', 'proficient', 'expertise'];
  return skillsKeywords.some(keyword => question.toLowerCase().includes(keyword));
}

/**
 * Handles the entire flow for Naukri chatbot questions
 * This is the main entry point for answering chatbot questions on Naukri
 */
export async function handleNaukriChatbotFlow(profile: UserProfile): Promise<boolean> {
  try {
    console.log('[FLOW] Starting Naukri chatbot flow');

    // Try to answer questions using the LLM-based approach
    const success = await answerChatbotWithLLM(profile);
    
    if (success) {
      console.log('[FLOW] Successfully completed chatbot flow with LLM');
      return true;
    }
    
    // If LLM approach fails, check for completion
    const isComplete = await checkForCompletionOrNoMoreQuestions();
    if (isComplete) {
      console.log('[FLOW] Chatbot flow appears to be complete');
      return true;
    }
    
    console.warn('[FLOW] Chatbot flow failed or could not be completed');
    return false;
  } catch (error) {
    console.error('[FLOW] Error handling Naukri chatbot flow:', error);
    return false;
  }
}

/**
 * Handles the special case of tech education questions for Naukri
 * Specifically for B.E/B.Tech with CSE/IT questions that appear frequently
 */
export async function handleTechEducationQuestion(): Promise<boolean> {
  try {
    console.log('[TECH-EDU] Handling B.E/B.Tech with CSE/IT question');
    
    // Find the container with radio buttons
    const radioContainer = document.querySelector('.singleselect-radiobutton-container, [id*="SingleSelectRadioButton"], [id$="SingleSelectRadioButton"], .ssrc__radio-btn-container');
    
    if (!radioContainer) {
      console.error('[TECH-EDU] Could not find radio button container');
      return false;
    }
    
    console.log('[TECH-EDU] Found radio container:', radioContainer);
    
    // Get all radio buttons in the container
    const radioButtons = radioContainer.querySelectorAll('input[type="radio"]');
    const radioLabels = radioContainer.querySelectorAll('.ssrc__label, label');
    
    console.log('[TECH-EDU] Found radio buttons:', radioButtons.length);
    console.log('[TECH-EDU] Found radio labels:', radioLabels.length);
    
    // Get the option labels (usually Yes/No)
    const options = Array.from(radioLabels).map(label => label.textContent?.trim() || '');
    console.log('[TECH-EDU] Options found:', options);
    
    // Determine the question text
    const questionEl = document.querySelector('.chatbot-question, .question-text, .question, [id*="Question"]');
    let questionText = questionEl?.textContent?.trim() || 'Have you done B.E/B.Tech/M.E/M.Tech with stream CSE/IT?';
    console.log('[TECH-EDU] Question text:', questionText);
    
    // Get the user profile from background
    let profile;
    try {
      const profileResponse = await sendApiRequestViaBackground('getProfile', 'GET', {});
      if (!profileResponse || !profileResponse.data) {
        console.error('[TECH-EDU] Could not get user profile');
        throw new Error('Failed to retrieve user profile');
      }
      profile = profileResponse.data;
      console.log('[TECH-EDU] Got user profile');
    } catch (profileError) {
      console.error('[TECH-EDU] Error fetching profile:', profileError);
      // Fall back to basic logic without profile
      return handleEducationQuestionWithoutLLM(radioButtons, radioLabels, options);
    }
    
    // First try to use the LLM API
    try {
      // Check if API is available with a ping request
      const pingResponse = await sendApiRequestViaBackground('ping', 'GET', {});
      console.log('[TECH-EDU] API ping response:', pingResponse);
      
      // Call the LLM API to determine the correct answer for this education question
      const response = await sendApiRequestViaBackground('api/llm-chatbot-action', 'POST', {
        question: questionText,
        options: options,
        profile: profile,
        resumeProfile: extractComprehensiveResumeContext(profile),
        questionMetadata: {
          format: QuestionFormat.RADIO_BUTTONS,
          source: 'naukri',
          pageTitle: document.title,
          navigationPath: window.location.pathname
        }
      });
      
      console.log('[TECH-EDU] LLM API response:', response?.data);
      
      if (response && response.data && response.data.answer) {
        // Find the matching option from the LLM response
        const optionToSelectIndex = options.findIndex(opt => 
          opt.toLowerCase() === response.data.answer.toLowerCase()
        );
        
        console.log('[TECH-EDU] LLM suggested option:', response.data.answer);
        console.log('[TECH-EDU] Matched option index:', optionToSelectIndex);
        
        // If valid option found, select it
        if (optionToSelectIndex !== -1 && optionToSelectIndex < radioLabels.length) {
          return selectOption(radioButtons, radioLabels, optionToSelectIndex);
        }
        
        // Try to find a close match if exact match not found
        const bestMatch = findBestMatchingOption(response.data.answer, options);
        if (bestMatch) {
          const matchIndex = options.indexOf(bestMatch);
          if (matchIndex !== -1) {
            return selectOption(radioButtons, radioLabels, matchIndex);
          }
        }
      }
      
      // If we reached here, LLM couldn't provide a usable answer
      console.log('[TECH-EDU] LLM response unusable, falling back to basic logic');
      throw new Error('LLM response not usable');
      
    } catch (apiError) {
      console.error('[TECH-EDU] Error with LLM API:', apiError);
      console.log('[TECH-EDU] Falling back to basic option selection logic');
      
      // Fall back to basic logic without LLM
      return handleEducationQuestionWithoutLLM(radioButtons, radioLabels, options, profile);
    }
  } catch (error) {
    console.error('[TECH-EDU] Error handling tech education question:', error);
    return false;
  }
}

// Helper function to select an option and submit
async function selectOption(radioButtons: NodeListOf<Element>, radioLabels: NodeListOf<Element>, optionIndex: number): Promise<boolean> {
  try {
    console.log('[TECH-EDU] Selecting option at index:', optionIndex);
    
    // Click the label
    (radioLabels[optionIndex] as HTMLElement).click();
    
    // Also try to click the radio button directly
    if (radioButtons.length > optionIndex) {
      const radioInput = radioButtons[optionIndex] as HTMLInputElement;
      radioInput.checked = true;
      radioInput.click();
      radioInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    // Wait for any UI updates
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Find and click the save button
    await findAndClickSaveButton();
    
    return true;
  } catch (error) {
    console.error('[TECH-EDU] Error selecting option:', error);
    return false;
  }
}

// Fallback function when LLM API is not available
function handleEducationQuestionWithoutLLM(
  radioButtons: NodeListOf<Element>, 
  radioLabels: NodeListOf<Element>, 
  options: string[],
  profile?: any
): Promise<boolean> {
  // Check if we have a Yes/No question
  const yesIndex = options.findIndex(opt => 
    opt.toLowerCase() === 'yes' || opt.toLowerCase() === 'y'
  );
  
  const noIndex = options.findIndex(opt => 
    opt.toLowerCase() === 'no' || opt.toLowerCase() === 'n'
  );
  
  console.log('[TECH-EDU] Yes index:', yesIndex, 'No index:', noIndex);
  
  // Check if user has CS/IT degree in profile (if profile is available)
  let hasCSITDegree = false;
  
  if (profile && profile.education && Array.isArray(profile.education)) {
    hasCSITDegree = profile.education.some((edu: any) => {
      // Check degree type
      const hasTechDegree = edu.degree && 
        (edu.degree.toLowerCase().includes('b.e') || 
         edu.degree.toLowerCase().includes('b.tech') ||
         edu.degree.toLowerCase().includes('bachelor of engineering') ||
         edu.degree.toLowerCase().includes('bachelor of technology'));
      
      // Check field of study
      const hasCSITField = edu.field && 
        (edu.field.toLowerCase().includes('computer science') || 
         edu.field.toLowerCase().includes('cse') ||
         edu.field.toLowerCase().includes('information technology') ||
         edu.field.toLowerCase().includes('it'));
         
      return hasTechDegree && hasCSITField;
    });
  }
  
  console.log('[TECH-EDU] User has CS/IT degree:', hasCSITDegree);
  
  // Select Yes if user has CS/IT degree (or if profile not available), otherwise No
  const optionToSelectIndex = hasCSITDegree ? yesIndex : (noIndex !== -1 ? noIndex : yesIndex);
  
  return selectOption(radioButtons, radioLabels, optionToSelectIndex);
}

/**
 * Checks for and clicks the final save button to submit the entire chatbot conversation
 */
export async function checkForFinalSaveButton(): Promise<boolean> {
  try {
    console.log('[FINAL-SAVE] Checking for final save button');
    
    // Look for common submit/save button selectors that appear at the end of chatbot flows
    const finalButtonSelectors = [
      'button.submit-btn',
      'button.final-submit',
      'button.save-btn',
      'button[type="submit"]',
      'input[type="submit"]',
      '.form-submit-btn',
      '.finalSubmitBtn',
      '.submit',
      'button:contains("Submit")',
      'button:contains("Save")',
      'button:contains("Done")',
      'button:contains("Finish")',
      'button.resman-btn-primary',
      '.saveAndApplyBtn',
      '.saveAndApply',
      '[id*="saveAndApply"]',
      '[id*="save-and-apply"]',
      '[id*="submitBtn"]',
      '[id*="finalSubmit"]'
    ];
    
    // Try each selector
    for (const selector of finalButtonSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        
        // Filter for visible, non-disabled buttons
        const visibleButtons = Array.from(elements).filter(el => {
          const elem = el as HTMLElement;
          return elem.offsetParent !== null && // Element is visible
                 !elem.classList.contains('disabled') && // Not disabled by class
                 !elem.hasAttribute('disabled') && // Not disabled by attribute
                 window.getComputedStyle(elem).display !== 'none'; // Not hidden by CSS
        }) as HTMLElement[];
        
        if (visibleButtons.length > 0) {
          console.log(`[FINAL-SAVE] Found final save button with selector "${selector}":`, visibleButtons[0]);
          
          // Add a small delay before clicking
          await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 500));
          
          // Click the button
          visibleButtons[0].click();
          console.log('[FINAL-SAVE] Clicked final save button');
          
          // Add a delay after clicking
          await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 500));
          
          return true;
        }
      } catch (e) {
        console.warn(`[FINAL-SAVE] Error with selector "${selector}":`, e);
      }
    }
    
    // If no button found with selectors, try finding any button that looks like a submit button
    const allButtons = document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]');
    const saveButtons = Array.from(allButtons).filter(button => {
      const buttonEl = button as HTMLElement;
      const text = (buttonEl.textContent || '').toLowerCase();
      const value = (buttonEl as HTMLInputElement).value?.toLowerCase() || '';
      return (text.includes('save') || text.includes('submit') || text.includes('done') || text.includes('finish') ||
              value.includes('save') || value.includes('submit') || value.includes('done') || value.includes('finish')) &&
             buttonEl.offsetParent !== null && // Element is visible
             !buttonEl.classList.contains('disabled') && // Not disabled by class
             !buttonEl.hasAttribute('disabled') && // Not disabled by attribute
             window.getComputedStyle(buttonEl).display !== 'none'; // Not hidden by CSS
    }) as HTMLElement[];
    
    if (saveButtons.length > 0) {
      console.log('[FINAL-SAVE] Found likely save button by text content:', saveButtons[0]);
      
      // Add a small delay before clicking
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 500));
      
      // Click the button
      saveButtons[0].click();
      console.log('[FINAL-SAVE] Clicked likely save button');
      
      // Add a delay after clicking
      await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 500));
      
      return true;
    }
    
    console.log('[FINAL-SAVE] No final save button found');
    return false;
  } catch (error) {
    console.error('[FINAL-SAVE] Error checking for final save button:', error);
    return false;
  }
}