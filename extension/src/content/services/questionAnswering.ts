import { UserProfile } from '../../popup/types/profile';
import { findSmartSaveButton } from './uiUtils';

/**
 * Send a request to the backend API via the background script
 */
export async function sendApiRequestViaBackground(endpoint: string, method: string, data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        {
          type: 'api_request',
          endpoint,
          method,
          data
        },
        response => {
          if (chrome.runtime.lastError) {
            console.error('Error from sendMessage:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        }
      );
    } catch (error) {
      console.error('Error sending message to background:', error);
      reject(error);
    }
  });
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
    '[id*="chatbot_Drawer"]',
    '.chatbot_Drawer',
    '.chatbot_DrawerContentWrapper',
    '[id$="ChatbotContainer"]',
    '.chatbot-container',
    '[id*="chat"]',
    '[class*="chat"]',
    '[role="dialog"]',
    '.modal-content',
    '.conversation-container'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && (element as HTMLElement).offsetParent !== null) {
      return element;
    }
  }

  return null;
}

/**
 * Analyze the question format and extract the relevant information
 */
export function analyzeQuestionFormat(container: Element): QuestionInfo | null {
  try {
    // Look for bot messages
    const botMessages = container.querySelectorAll('.botMsg, .bot-msg, [class*="bot-message"]');
    let questionText = '';
    let questionElement: Element | null = null;

    // Try to extract the question text from the last bot message
    if (botMessages.length > 0) {
      questionElement = botMessages[botMessages.length - 1];
      questionText = questionElement.textContent?.trim() || '';
      console.log('[QDET] All candidate .botMsg.msg span texts:', Array.from(questionElement.querySelectorAll('span')).map(el => el.textContent));
    }

    // If no bot messages found, try other common question containers
    if (!questionText) {
      const questionContainers = container.querySelectorAll('p, h3, h4, span, div:not(:has(*))');
      
      for (const el of questionContainers) {
        const text = el.textContent?.trim() || '';
        if (text.length > 10 && text.length < 500 && (text.endsWith('?') || text.includes('?'))) {
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

    console.log('[QDET] Selected question span:', questionElement);

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
    const textInputs = container.querySelectorAll('input[type="text"], textarea, [contenteditable="true"]');
    if (textInputs.length > 0) {
      return {
        questionElement,
        questionText,
        format: QuestionFormat.TEXT_INPUT,
        options: []
      };
    }
    
    // Default to text input if we found a question but couldn't determine the format
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
 * Handle Naukri's specific radio button UI structure with multiple reliable click strategies
 */
export async function handleNaukriRadioSelection(optionIndexOrIndices: number | number[], radioSelectors: string[], options?: string[]): Promise<void> {
  // Handle single index or array of indices
  const indices = Array.isArray(optionIndexOrIndices) ? optionIndexOrIndices : [optionIndexOrIndices];
  
  if (indices.length === 0 || !options || options.length === 0) {
    console.warn('[RADIO] No valid options provided for radio selection');
    return;
  }

  console.log(`[RADIO] Attempting to select option(s): ${indices.join(', ')} from options:`, options);
  
  for (const index of indices) {
    if (index < 0 || index >= options.length) {
      console.warn(`[RADIO] Invalid option index: ${index}, skipping`);
      continue;
    }

    try {
      const optionText = options[index];
      console.log(`[RADIO] Selecting option "${optionText}" at index ${index}`);
      
      // DIRECT DOM STRATEGY - Get the radio buttons directly from the page
      // This is more reliable than using selectors which can change
      const allRadioInputs = Array.from(document.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
      console.log(`[RADIO] Found ${allRadioInputs.length} radio inputs on the page`);
      
      if (allRadioInputs.length === 0) {
        console.warn('[RADIO] No radio inputs found on the page');
        return;
      }
      
      // If we have exactly the right number of radio inputs, we can select by index
      if (allRadioInputs.length === options.length) {
        const radio = allRadioInputs[index];
        console.log(`[RADIO] Selecting radio at index ${index} by direct DOM access:`, radio);
        
        // Try multiple techniques to ensure the radio gets clicked
        
        // 1. Set checked property directly
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        radio.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        
        // 2. Use native click
        radio.click();
        
        // 3. If the radio has an ID, try to click its label
        if (radio.id) {
          const label = document.querySelector(`label[for="${radio.id}"]`);
          if (label) {
            console.log(`[RADIO] Also clicking label for radio:`, label);
            (label as HTMLElement).click();
          }
        }
        
        // 4. Try clicking parent container
        const container = radio.closest('.ssrc__radio-btn-container, [class*="radio-btn-container"]');
        if (container) {
          console.log(`[RADIO] Also clicking container for radio:`, container);
          (container as HTMLElement).click();
        }
        
        // Wait a bit between click attempts
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Verify if the radio is checked
        if (radio.checked) {
          console.log(`[RADIO] Successfully selected radio at index ${index}`);
        } else {
          console.warn(`[RADIO] Failed to select radio at index ${index}`);
        }
        
        continue;
      }
      
      // Try finding by option text
      console.log(`[RADIO] Trying to select by option text "${optionText}"`);
      
      // Find radio input by matching the option text to labels
      const labels = Array.from(document.querySelectorAll('label'));
      const matchingLabel = labels.find(label => 
        label.textContent?.trim() === optionText || 
        label.textContent?.trim().toLowerCase() === optionText.toLowerCase()
      );
      
      if (matchingLabel) {
        console.log(`[RADIO] Found matching label with text "${optionText}":`, matchingLabel);
        
        // If the label has a 'for' attribute, find the corresponding radio input
        const forAttr = matchingLabel.getAttribute('for');
        if (forAttr) {
          const radioInput = document.getElementById(forAttr) as HTMLInputElement;
          if (radioInput && radioInput.type === 'radio') {
            console.log(`[RADIO] Found radio input for label:`, radioInput);
            radioInput.checked = true;
            radioInput.dispatchEvent(new Event('change', { bubbles: true }));
            radioInput.click();
            
            // Also click the label for good measure
            (matchingLabel as HTMLElement).click();
            
            await new Promise(resolve => setTimeout(resolve, 300));
            continue;
          }
        }
        
        // If we couldn't find a radio input via 'for' attribute, just click the label
        console.log(`[RADIO] Clicking label directly:`, matchingLabel);
        (matchingLabel as HTMLElement).click();
        await new Promise(resolve => setTimeout(resolve, 300));
        continue;
      }
      
      // Try finding the radio button based on its value attribute
      const radioWithValue = allRadioInputs.find(input => 
        input.value === optionText || 
        input.value.toLowerCase() === optionText.toLowerCase()
      );
      
      if (radioWithValue) {
        console.log(`[RADIO] Found radio with value="${optionText}":`, radioWithValue);
        radioWithValue.checked = true;
        radioWithValue.dispatchEvent(new Event('change', { bubbles: true }));
        radioWithValue.click();
        await new Promise(resolve => setTimeout(resolve, 300));
        continue;
      }
      
      // CONTAINER STRATEGY - Look for radio containers with specific class patterns
      // This handles Naukri's custom UI for radio buttons
      const radioContainers = Array.from(
        document.querySelectorAll('.ssrc__radio-btn-container, [class*="radio-btn-container"]')
      );
      
      if (radioContainers.length === options.length) {
        console.log(`[RADIO] Using container strategy with ${radioContainers.length} containers`);
        const container = radioContainers[index] as HTMLElement;
        console.log(`[RADIO] Clicking container at index ${index}:`, container);
        
        // First click the container
        container.click();
        
        // Then find and click any radio input inside the container
        const radioInsideContainer = container.querySelector('input[type="radio"]') as HTMLInputElement;
        if (radioInsideContainer) {
          console.log(`[RADIO] Also clicking radio inside container:`, radioInsideContainer);
          radioInsideContainer.checked = true;
          radioInsideContainer.dispatchEvent(new Event('change', { bubbles: true }));
          radioInsideContainer.click();
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
        continue;
      }
      
      // FALLBACK - If all else fails, try clicking by index
      if (index < allRadioInputs.length) {
        console.log(`[RADIO] Fallback: Using radio at index ${index} from ${allRadioInputs.length} radios`);
        const fallbackRadio = allRadioInputs[index];
        fallbackRadio.checked = true;
        fallbackRadio.dispatchEvent(new Event('change', { bubbles: true }));
        fallbackRadio.click();
        await new Promise(resolve => setTimeout(resolve, 300));
      } else {
        console.error(`[RADIO] Cannot find any radio input to select for option "${optionText}"`);
      }
    } catch (error) {
      console.error(`[RADIO] Error selecting radio option at index ${index}:`, error);
    }
  }
  
  // After selecting, look for the Save button and click it
  console.log('[RADIO] Selection complete, finding Save button...');
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Find the save button using specific selectors (most reliable first)
  const saveButtonSelectors = [
    '.sendMsg[tabindex="0"]',
    '.sendMsgbtn_container .sendMsg',
    '.send:not(.disabled) .sendMsg',
    'div.sendMsg',
    'div[tabindex="0"]',
    'button:not([disabled])'
  ];
  
  let saveButton: HTMLElement | null = null;
  
  for (const selector of saveButtonSelectors) {
    const button = document.querySelector(selector) as HTMLElement;
    if (button && 
        button.offsetParent !== null && 
        !button.classList.contains('disabled') && 
        window.getComputedStyle(button).display !== 'none') {
      saveButton = button;
      console.log(`[RADIO] Found Save button with selector "${selector}":`, saveButton);
      break;
    }
  }
  
  if (saveButton) {
    console.log('[RADIO] Clicking Save button directly:', saveButton);
    saveButton.click();
    
    // Remove any disabled state to ensure click works
    saveButton.classList.remove('disabled');
    saveButton.removeAttribute('disabled');
    
    // Retry click after a short delay to ensure it registers
    await new Promise(resolve => setTimeout(resolve, 200));
    saveButton.click();
  } else {
    console.warn('[RADIO] Could not find Save button after radio selection');
  }
}

/**
 * Handle text input response by typing into the appropriate field
 */
export async function handleTextInputAnswer(questionInfo: QuestionInfo, answer: string): Promise<void> {
  try {
    // Find potential text input elements in the chatbot container
    const container = questionInfo.questionElement.closest('[id*="chatbot_Drawer"], .chatbot_Drawer, .chatbot_DrawerContentWrapper') || document;
    
    // Look for various forms of input elements
    const inputSelectors = [
      'textarea',
      'input[type="text"]',
      '[contenteditable="true"]',
      '[class*="textArea"]',
      '.chatbot_InputContainer [contenteditable]'
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
      console.warn('[TEXT] Could not find input element for text response');
      return;
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
    
    console.log('[TEXT] Successfully entered text answer:', answer);
  } catch (error) {
    console.error('[TEXT] Error handling text input:', error);
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
 * Answers chatbot questions using LLM backend for smart responses
 * This is used for newer Naukri chatbot interfaces
 */
export async function answerChatbotWithLLM(profile: UserProfile): Promise<boolean> {
  console.log('[LLM] Detected chatbot container. Routing to answerChatbotWithLLM.');
  
  // Keep track of steps for debugging purposes
  let stepNumber = 1;
  let maxSteps = 10; // Safety limit to prevent infinite loops

  // Continue handling steps until we reach the end or hit max steps
  while (stepNumber <= maxSteps) {
    console.log(`[LLM] Chatbot step #${stepNumber}`);
    console.log(`[LLM] Chatbot Step #${stepNumber}`);
    
    try {
      // 1. Evaluate state first - try to find the container
      console.log('[QDET] Looking for chatbot container...');
      const chatbotContainer = findChatbotContainer();
      if (!chatbotContainer) {
        console.warn('[QDET] No chatbot container found!');
        console.groupEnd();
        return false;
      }
      console.log('[QDET] Chatbot container found:', chatbotContainer);

      // 2. Parse question
      const questionInfo = analyzeQuestionFormat(chatbotContainer);
      if (!questionInfo) {
        console.warn('[QDET] No question found in chatbot!');
        console.groupEnd();
        return false;
      }
      console.log('[QDET] Parsed question:', questionInfo);

      // Special case: B.E/B.Tech with CSE/IT stream question
      // Critical education validation - this takes precedence over the backend response
      if (questionInfo.questionText.toLowerCase().includes('b.e/b.tech') && 
          (questionInfo.questionText.toLowerCase().includes('cse/it') || 
           questionInfo.questionText.toLowerCase().includes('computer science')) &&
          questionInfo.options && 
          questionInfo.options.length > 0) {
        
        // This is an education validation question - we always want to select "Yes"
        const yesIndex = questionInfo.options.findIndex(opt => 
          opt.toLowerCase() === 'yes' || opt.toLowerCase() === 'y'
        );
        
        if (yesIndex !== -1) {
          console.log('[LLM] Special case: CSE/IT verification detected, selecting "Yes"');
          
          // Use our enhanced radio selection function for more reliable clicking
          await handleNaukriRadioSelection(yesIndex, [], questionInfo.options);
          
          // Increment step and continue to next question
          stepNumber++;
          continue;
        }
      }

      // 3. Get answer from backend LLM
      console.log('[LLM] Getting answer from backend for question:', questionInfo.questionText);
      let response;
      try {
        response = await sendApiRequestViaBackground(
          'api/llm-chatbot-action',
          'POST',
          {
            question: questionInfo.questionText,
            options: questionInfo.options,
            profile,
            questionFormat: QuestionFormat[questionInfo.format]
          }
        );

        // Use a fallback response if backend returns null/error
        if (!response || !response.answer || response.answer === null) {
          console.warn('[LLM] Backend returned null answer, using fallback logic');
          
          // Handle Yes/No questions intelligently
          if (questionInfo.options && 
              questionInfo.options.length === 2 && 
              questionInfo.options[0].toLowerCase() === 'yes' && 
              questionInfo.options[1].toLowerCase() === 'no') {
            // For yes/no questions about experience/skills, default to "Yes"
            console.log('[LLM] Fallback: Yes/No question, selecting "Yes"');
            response = { 
              success: true,
              answer: questionInfo.options[0], // "Yes"
              actionType: 'select' 
            };
          } else if (questionInfo.format === QuestionFormat.TEXT_INPUT) {
            // For text input, use a generic intro response
            console.log('[LLM] Fallback: Text input question, using general response');
            response = { 
              success: true,
              answer: "I'm a dedicated software professional with experience in developing robust solutions. I'm enthusiastic about this opportunity and confident in my ability to contribute through collaborative teamwork, continuous learning, and delivering high-quality results.",
              actionType: 'type' 
            };
          } else if (questionInfo.format === QuestionFormat.RADIO_BUTTONS && questionInfo.options && questionInfo.options.length > 0) {
            // For radio buttons, select the first option as a default
            console.log('[LLM] Fallback: Radio button question, selecting first option');
            response = { 
              success: true,
              answer: questionInfo.options[0],
              actionType: 'select' 
            };
          } else {
            // Generic fallback
            console.log('[LLM] Using generic fallback response');
            response = { 
              success: true,
              answer: 'Yes',
              actionType: 'select' 
            };
          }
        }
      } catch (error) {
        console.error('[LLM] Error getting answer from backend:', error);
        // Fallback to default response on error
        response = { 
          success: false,
          answer: 'Yes',
          actionType: 'select' 
        };
      }

      console.log(`[LLM][Step #${stepNumber}] Backend answer:`, response);

      // 4. Execute the answer based on question format
      if (questionInfo.format === QuestionFormat.TEXT_INPUT) {
        await handleTextInputAnswer(questionInfo, response.answer);
      } else if (questionInfo.format === QuestionFormat.RADIO_BUTTONS) {
        // Find the index of the option that matches the answer text
        let optionIndex = -1;
        if (questionInfo.options && questionInfo.options.length > 0) {
          // Case-insensitive comparison
          optionIndex = questionInfo.options.findIndex(
            option => option.toLowerCase() === response.answer.toLowerCase()
          );
        }
        
        if (optionIndex !== -1) {
          await handleNaukriRadioSelection(optionIndex, [], questionInfo.options);
        } else {
          console.warn(`[LLM] Could not match answer "${response.answer}" to any option:`, questionInfo.options);
          // Fallback to first option if no match found
          await handleNaukriRadioSelection(0, [], questionInfo.options);
        }
      } else {
        console.warn(`[LLM] Unknown question format: ${questionInfo.format}, no action taken`);
      }

      // 5. Look for the Save/Next button and click it
      console.log('[DEBUG] Waiting for Save button to become enabled...');
      const saveButton = findSmartSaveButton(chatbotContainer);
      if (saveButton) {
        console.log('[DEBUG] Save button found:', {
          text: saveButton.textContent?.trim(),
          outerHTML: saveButton.outerHTML,
          class: saveButton.className,
          rect: saveButton.getBoundingClientRect()
        });
        
        // Click the save button
        saveButton.click();
        console.log('[LLM-AUTOMATION] Clicked Save after filling answer.');
        
        // Wait for next question to load
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Direct retry of save button click
        if (questionInfo.format === QuestionFormat.RADIO_BUTTONS) {
          try {
            // Double-check if button is still there and click again for radio buttons
            if (saveButton && document.body.contains(saveButton)) {
              console.log('[LLM] Retrying Save button click for radio button question');
              saveButton.click();
            }
          } catch (error) {
            console.warn('[LLM] Error during retry save click:', error);
          }
        }
        
        // Wait for animation/transition to complete
        console.log('[LLM] Waiting for next question or Save...');
        await new Promise(resolve => setTimeout(resolve, 1500));
      } else {
        console.warn('[LLM] Could not find Save button after answer!');
        // Try to find any bottom button as a fallback
        const anyBottomButton = document.querySelector('[id*="Footer"] button, [id*="Footer"] [role="button"], [id*="Footer"] [tabindex="0"]');
        if (anyBottomButton) {
          console.log('[LLM] Found fallback bottom button, clicking it:', anyBottomButton);
          (anyBottomButton as HTMLElement).click();
        }
        
        // Wait longer since we're using a fallback approach
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // 6. Check if we should continue to next question
      // We detect if there's a new question available
      if (!hasNewQuestion(chatbotContainer)) {
        console.log(`[LLM] No new question found after step #${stepNumber}, finishing...`);
        return true;
      }

      // Move to next step
      stepNumber++;
      
    } catch (error) {
      console.error(`[LLM] Error in chatbot step #${stepNumber}:`, error);
      stepNumber++;
    }
  }

  console.log(`[LLM] Reached maximum steps (${maxSteps}), finishing chatbot automation.`);
  return true;
}

/**
 * Legacy API for backward compatibility - do not use directly
 * @deprecated Use answerChatbotWithLLM for chatbot flows
 */
export async function answerApplicationQuestions(profile: UserProfile): Promise<boolean> {
  console.warn('[DEPRECATED] answerApplicationQuestions is deprecated for chatbot flows. Use answerChatbotWithLLM for LLM-driven automation.');
  
  // Check if this is a chatbot flow
  const chatbotContainer = findChatbotContainer();
  if (chatbotContainer) {
    console.log('[LLM] Detected chatbot container. Routing to answerChatbotWithLLM.');
    return answerChatbotWithLLM(profile);
  }
  
  // TODO: Implement for non-chatbot forms
  return false;
}

/**
 * Handle Naukri notice period question selection
 * This is a special case that requires dedicated handling
 */
export async function handleNaukriNoticePeriod(): Promise<boolean> {
  try {
    console.log('[NOTICE] Handling Naukri notice period question');
    
    // Look for radio buttons
    const radioContainers = document.querySelectorAll('.ssrc__radio-btn-container, [class*="radio-btn-container"]');
    if (radioContainers.length === 0) {
      console.warn('[NOTICE] No radio containers found');
      return false;
    }
    
    // Find the options by text
    const options: string[] = [];
    radioContainers.forEach(container => {
      const text = container.textContent?.trim();
      if (text) {
        options.push(text);
      }
    });
    
    console.log('[NOTICE] Found options:', options);
    
    // Look for the option with shortest notice period (0-15, immediate joining)
    let selectedIndex = -1;
    const shortNoticePeriodPatterns = [
      /immediate/i,
      /0 days/i,
      /^0-15/i,
      /15 days/i,
      /^0-30/i,
      /30 days/i
    ];
    
    // Try each pattern in order of preference
    for (const pattern of shortNoticePeriodPatterns) {
      selectedIndex = options.findIndex(option => pattern.test(option));
      if (selectedIndex !== -1) {
        console.log(`[NOTICE] Found matching option: "${options[selectedIndex]}" at index ${selectedIndex}`);
        break;
      }
    }
    
    // If no short notice option found, select the first option as fallback
    if (selectedIndex === -1 && options.length > 0) {
      selectedIndex = 0;
      console.log(`[NOTICE] No ideal option found, selecting first option: "${options[0]}"`);
    }
    
    if (selectedIndex >= 0) {
      // Use the radio selection helper to select the option
      await handleNaukriRadioSelection(selectedIndex, [], options);
      return true;
    }
    
    console.warn('[NOTICE] Could not select any notice period option');
    return false;
  } catch (error) {
    console.error('[NOTICE] Error handling notice period selection:', error);
    return false;
  }
}

/**
 * Check for and click a final Save button when there are no more questions
 */
export async function checkForFinalSaveButton(): Promise<boolean> {
  try {
    console.log('[FINAL] Checking for final Save button');
    
    // Check if there are any visible questions or inputs
    const hasActiveInputs = Boolean(
      document.querySelector('input[type="text"]:not([disabled])') ||
      document.querySelector('textarea:not([disabled])') ||
      document.querySelector('input[type="radio"]:not([disabled])') ||
      document.querySelector('select:not([disabled])') ||
      document.querySelector('[contenteditable="true"]')
    );
    
    // If there are still active inputs, we're not at the final save
    if (hasActiveInputs) {
      console.log('[FINAL] Active input fields still present, not at final save yet');
      return false;
    }
    
    // Look for Save/Submit/Continue buttons - focus on the visible ones at the bottom of the screen
    const saveButtonSelectors = [
      '.sendMsg[tabindex="0"]',
      '.sendMsgbtn_container .sendMsg',
      'button:contains("Save")',
      'button:contains("Submit")',
      'button:contains("Continue")',
      '[class*="save-btn"]',
      '[class*="submit-btn"]',
      '.btn-primary',
      '.primary-btn'
    ];
    
    // Filter buttons to those that are visible, enabled and near the bottom of the viewport
    const visibleButtons: HTMLElement[] = [];
    
    for (const selector of saveButtonSelectors) {
      try {
        const buttons = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
        for (const button of buttons) {
          const rect = button.getBoundingClientRect();
          const isVisible = rect.width > 0 && 
                           rect.height > 0 && 
                           button.offsetParent !== null &&
                           !button.classList.contains('disabled') &&
                           !button.hasAttribute('disabled') &&
                           window.getComputedStyle(button).display !== 'none' &&
                           window.getComputedStyle(button).visibility !== 'hidden';
          
          if (isVisible) {
            visibleButtons.push(button);
          }
        }
      } catch (e) {
        // Some selectors might throw errors, just continue
      }
    }
    
    // Sort by Y position (prefer lower buttons which are likely "Save/Submit")
    visibleButtons.sort((a, b) => {
      return b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom;
    });
    
    if (visibleButtons.length > 0) {
      const finalButton = visibleButtons[0];
      console.log('[FINAL] Found final button to click:', finalButton, finalButton.outerHTML);
      
      // Click it
      finalButton.click();
      
      // Wait a moment and click again to make sure it registers
      await new Promise(resolve => setTimeout(resolve, 300));
      finalButton.click();
      
      return true;
    }
    
    // If we couldn't find a dedicated save button, try using the smart save finder
    const smartSaveButton = findSmartSaveButton();
    if (smartSaveButton) {
      console.log('[FINAL] Using smart save button detection:', smartSaveButton);
      
      // Click it
      smartSaveButton.click();
      
      // Wait a moment and click again to make sure it registers
      await new Promise(resolve => setTimeout(resolve, 300));
      smartSaveButton.click();
      
      return true;
    }
    
    console.log('[FINAL] No final Save button found');
    return false;
  } catch (error) {
    console.error('[FINAL] Error checking for final save button:', error);
    return false;
  }
}

/**
 * Handle the B.E/B.Tech with CSE/IT stream education question
 * This is a special case question that needs specific handling
 */
export async function handleTechEducationQuestion(): Promise<boolean> {
  try {
    console.log('[EDUCATION] Handling B.E/B.Tech education question');
    
    // Check if this is indeed the education validation question
    const chatbotContainer = findChatbotContainer();
    if (!chatbotContainer) {
      console.warn('[EDUCATION] No chatbot container found');
      return false;
    }
    
    // Extract the question text
    const questionElement = chatbotContainer.querySelector('.botMsg, .bot-msg, [class*="bot-message"]');
    if (!questionElement) {
      console.warn('[EDUCATION] No question text found');
      return false;
    }
    
    const questionText = questionElement.textContent?.trim() || '';
    const isEducationQuestion = (
      questionText.toLowerCase().includes('b.e/b.tech') && 
      (questionText.toLowerCase().includes('cse/it') || 
       questionText.toLowerCase().includes('computer science'))
    );
    
    if (!isEducationQuestion) {
      console.warn('[EDUCATION] Not an education question:', questionText);
      return false;
    }
    
    // Find the radio options
    const radioContainers = chatbotContainer.querySelectorAll('.ssrc__radio-btn-container, [class*="radio-btn-container"]');
    if (radioContainers.length === 0) {
      console.warn('[EDUCATION] No radio options found');
      return false;
    }
    
    // Collect the options
    const options: string[] = [];
    radioContainers.forEach(container => {
      const text = container.textContent?.trim();
      if (text) {
        options.push(text);
      }
    });
    
    console.log('[EDUCATION] Found options:', options);
    
    // Look for "Yes" option
    const yesIndex = options.findIndex(opt => 
      opt.toLowerCase() === 'yes' || opt.toLowerCase() === 'y'
    );
    
    if (yesIndex !== -1) {
      console.log('[EDUCATION] Found "Yes" option at index', yesIndex);
      
      // Always select "Yes" for education validation questions
      await handleNaukriRadioSelection(yesIndex, [], options);
      return true;
    }
    
    console.warn('[EDUCATION] Could not find "Yes" option');
    return false;
  } catch (error) {
    console.error('[EDUCATION] Error handling education question:', error);
    return false;
  }
} 