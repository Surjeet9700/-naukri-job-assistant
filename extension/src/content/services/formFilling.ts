/// <reference types="chrome" />

import { UserProfile } from '../../popup/types/profile';
import { isChatbotActive, findSmartSaveButton } from './uiUtils';

/**
 * API Response interface
 */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Experience formatting response interface
 */
interface ExperienceFormattingResponse {
  formattedText: string;
}

/**
 * Automatically fills form fields based on user profile data
 */
export async function fillApplicationForm(profile: UserProfile): Promise<void> {
  try {
    console.log('Starting form autofill process');
    
    // Find all relevant form fields
    const nameFields = findFormFields('name');
    const emailFields = findFormFields('email');
    const phoneFields = findFormFields('phone');
    const experienceFields = findFormFields('experience');
    const educationFields = findFormFields('education');
    const skillsFields = findFormFields('skills');
    
    // Log found fields for debugging
    console.log('Found form fields:', {
      name: nameFields.length,
      email: emailFields.length,
      phone: phoneFields.length,
      experience: experienceFields.length,
      education: educationFields.length,
      skills: skillsFields.length
    });
    
    // Fill basic information
    if (profile.name) {
      fillFields(nameFields, profile.name);
    }
    
    if (profile.email) {
      fillFields(emailFields, profile.email);
    }
    
    if (profile.phone) {
      fillFields(phoneFields, profile.phone);
    }
    
    // Handle radio buttons and checkboxes for common questions
    await handleCommonQuestions(profile);
    
    // Handle complex fields that may need API assistance
    try {
      if (experienceFields.length > 0 && profile.experience?.length > 0) {
        // Get AI-generated experience content
        const experienceContent = await sendApiRequestViaBackground<ExperienceFormattingResponse>(
          'api/format-experience', 
          'POST', 
          { experience: profile.experience }
        );
        
        if (experienceContent?.formattedText) {
          fillFields(experienceFields, experienceContent.formattedText);
        } else {
          // Fallback: Use basic formatting
          const expText = profile.experience
            .map(exp => `${exp.title} at ${exp.company} (${exp.startDate} - ${exp.endDate || 'Present'})`)
            .join('\n\n');
          fillFields(experienceFields, expText);
        }
      }
      
      if (skillsFields.length > 0 && profile.skills?.length > 0) {
        fillFields(skillsFields, profile.skills.join(', '));
      }
    } catch (error) {
      console.error('Error filling complex fields:', error);
      // Continue with basic fields if complex field filling fails
    }
    
    console.log('Form filling completed');
    return;
    
  } catch (error) {
    console.error('Error in form filling:', error);
    throw error;
  }
}

/**
 * Handles common job application questions including radio buttons and checkboxes
 */
async function handleCommonQuestions(profile: UserProfile): Promise<void> {
  console.log('Handling common questions (radio buttons, checkboxes, etc)');
  
  try {
    // Detect the current URL to apply site-specific handlers
    const currentUrl = window.location.href;
    
    if (currentUrl.includes('naukri.com')) {
      await handleNaukriSpecificQuestions(profile);
    } else {
      // Generic handling for other job sites
      await handleGenericQuestions(profile);
    }
  } catch (error) {
    console.error('Error handling common questions:', error);
    // Continue with other form filling if this fails
  }
}

/**
 * Handle Naukri.com specific questions
 */
async function handleNaukriSpecificQuestions(profile: UserProfile): Promise<void> {
  console.log('Handling Naukri.com specific questions');
  
  // Wait for elements to be fully loaded
  await waitForElements('input[type="radio"]', 5000);
  
  // Location questions
  // "Are you currently located in [City]"
  const locationQuestions = Array.from(document.querySelectorAll('div, p, h3, h4, label, span'))
    .filter(el => {
      const text = el.textContent?.toLowerCase() || '';
      return text.includes('currently located') || 
             text.includes('are you located') || 
             text.includes('current location');
    });
  
  console.log('Found location questions:', locationQuestions.length);
  
  for (const questionEl of locationQuestions) {
    console.log('Processing location question:', questionEl.textContent);
    
    // Find closest radio button container
    const container = findClosestContainer(questionEl as HTMLElement);
    if (!container) continue;
    
    // Find all radio buttons in this container
    const radioButtons = Array.from(container.querySelectorAll('input[type="radio"]'));
    console.log(`Found ${radioButtons.length} radio buttons for question`);
    
    // If user's location matches the question location, select "Yes"
    if (radioButtons.length >= 2) {
      // Typically, the first radio button is "Yes" and the second is "No"
      const yesButton = radioButtons[0];
      
      // For Naukri specifically, always click the Yes radio button for location questions
      await selectRadioOption(yesButton);
      console.log('Selected "Yes" for location question');
    }
  }
  
  // Notice period questions
  const noticeQuestions = Array.from(document.querySelectorAll('div, p, h3, h4, label, span'))
    .filter(el => {
      const text = el.textContent?.toLowerCase() || '';
      return text.includes('notice period') || text.includes('join within');
    });
  
  for (const questionEl of noticeQuestions) {
    const container = findClosestContainer(questionEl as HTMLElement);
    if (!container) continue;
    
    // Find dropdown or radio options
    const selects = Array.from(container.querySelectorAll('select'));
    if (selects.length > 0) {
      // Choose shortest notice period option (typically first option)
      const options = Array.from(selects[0].options);
      if (options.length > 1) {
        // Select the first non-empty option (usually "Immediate" or shortest duration)
        for (const option of options) {
          if (option.value && option.value !== '') {
            selects[0].value = option.value;
            selects[0].dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`Selected notice period: ${option.text}`);
            break;
          }
        }
      }
    }
  }
  
  // Experience questions (years of experience)
  if (profile.experience && profile.experience.length > 0) {
    const expYears = calculateTotalExperienceYears(profile);
    const experienceQuestions = Array.from(document.querySelectorAll('div, p, h3, h4, label, span'))
      .filter(el => {
        const text = el.textContent?.toLowerCase() || '';
        return text.includes('years of experience') || text.includes('work experience');
      });
    
    for (const questionEl of experienceQuestions) {
      const container = findClosestContainer(questionEl as HTMLElement);
      if (!container) continue;
      
      // Find numeric input fields
      const inputs = Array.from(container.querySelectorAll('input[type="number"], input[type="text"]'));
      for (const input of inputs) {
        if (input instanceof HTMLInputElement) {
          input.value = expYears.toString();
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          console.log(`Filled experience years: ${expYears}`);
        }
      }
    }
  }
}

/**
 * Handle generic questions on job application forms
 */
async function handleGenericQuestions(profile: UserProfile): Promise<void> {
  console.log('Handling generic questions');
  
  // Wait for radio buttons to be available
  await waitForElements('input[type="radio"]', 2000);
  
  // Generic location questions
  const locationTexts = ['currently located', 'current location', 'are you located'];
  const questionContainers = findQuestionContainers(locationTexts);
  
  for (const container of questionContainers) {
    const radioButtons = Array.from(container.querySelectorAll('input[type="radio"]'));
    if (radioButtons.length >= 2) {
      // Usually first option is Yes/Affirmative
      await selectRadioOption(radioButtons[0]);
    }
  }
  
  // Willingness to relocate
  const relocateTexts = ['willing to relocate', 'can you relocate', 'relocate to'];
  const relocateContainers = findQuestionContainers(relocateTexts);
  
  for (const container of relocateContainers) {
    const radioButtons = Array.from(container.querySelectorAll('input[type="radio"]'));
    if (radioButtons.length >= 2) {
      // Usually first option is Yes/Affirmative
      await selectRadioOption(radioButtons[0]);
    }
  }
  
  // Work authorization
  const workAuthTexts = ['authorized to work', 'work authorization', 'legally authorized'];
  const workAuthContainers = findQuestionContainers(workAuthTexts);
  
  for (const container of workAuthContainers) {
    const radioButtons = Array.from(container.querySelectorAll('input[type="radio"]'));
    if (radioButtons.length >= 2) {
      // Usually first option is Yes/Affirmative
      await selectRadioOption(radioButtons[0]);
    }
  }
}

/**
 * Find containers that likely contain a question based on text content
 */
function findQuestionContainers(searchTexts: string[]): HTMLElement[] {
  const containers: HTMLElement[] = [];
  
  // Find elements containing the search texts
  for (const text of searchTexts) {
    const elements = Array.from(document.querySelectorAll('div, p, h3, h4, label, span'))
      .filter(el => (el.textContent?.toLowerCase() || '').includes(text));
    
    for (const el of elements) {
      const container = findClosestContainer(el as HTMLElement);
      if (container) {
        containers.push(container);
      }
    }
  }
  
  return containers;
}

/**
 * Find the closest container that might contain form controls
 */
function findClosestContainer(element: HTMLElement): HTMLElement | null {
  // Try to find a container that has form controls
  let current: HTMLElement | null = element;
  let depth = 0;
  const maxDepth = 5; // Prevent infinite loops and too broad searching
  
  while (current && depth < maxDepth) {
    // Check if current element contains form controls
    if (current.querySelectorAll('input, select, textarea').length > 0) {
      return current;
    }
    
    // Move up to parent
    const parent = current.parentElement;
    if (!parent) break;
    current = parent;
    depth++;
  }
  
  // If we couldn't find a container with form controls,
  // return the parent that's at most 2 levels up
  current = element;
  depth = 0;
  while (current && depth < 2) {
    const parent = current.parentElement;
    if (!parent) break;
    current = parent;
    depth++;
  }
  
  return current;
}

/**
 * Utility: Deep log the state of an element for debugging
 */
function logElementState(element: Element | null, label: string) {
  if (!element) {
    console.log(`[LOG] ${label}: Element not found`);
    return;
  }
  const el = element as HTMLElement;
  console.log(`[LOG] ${label}:`, {
    tag: el.tagName,
    id: el.id,
    class: el.className,
    disabled: (el as HTMLInputElement).disabled,
    value: (el as HTMLInputElement).value,
    checked: (el as HTMLInputElement).checked,
    ariaDisabled: el.getAttribute('aria-disabled'),
    tabIndex: el.tabIndex,
    offsetParent: el.offsetParent !== null,
    innerText: el.innerText,
    outerHTML: el.outerHTML?.slice(0, 200) + '...'
  });
}

/**
 * Select a radio button option and ensure it's clicked properly (React/Angular/Vue safe)
 */
export async function selectRadioOption(radioElement: Element): Promise<void> {
  console.log('[LOG] Entered selectRadioOption');
  if (!(radioElement instanceof HTMLInputElement)) {
    console.error('Element is not a radio input', radioElement);
    return;
  }
  logElementState(radioElement, 'Radio (before)');
  let label: HTMLElement | null = null;
  if (radioElement.id) {
    const found = document.querySelector(`label[for="${radioElement.id}"]`);
    if (found instanceof HTMLElement) label = found;
  }
  if (!label) {
    const found = radioElement.closest('label');
    if (found instanceof HTMLElement) label = found;
  }

  // Helper to add a random delay
  function randomDelay(min = 100, max = 300) {
    return new Promise(res => setTimeout(res, Math.floor(Math.random() * (max - min + 1)) + min));
  }

  // Helper to fire all human-like events
  async function fireHumanEvents(el: HTMLElement) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await randomDelay();
    el.focus();
    await randomDelay();
    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await randomDelay();
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await randomDelay();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await randomDelay();
    if (el instanceof HTMLInputElement && el.type === 'radio') {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, true);
      } else {
        el.checked = true;
      }
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await randomDelay();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await randomDelay();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await randomDelay();
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  }

  if (label) {
    logElementState(label, 'Radio Label (before)');
    await fireHumanEvents(label);
    logElementState(label, 'Radio Label (after)');
  } else {
    await fireHumanEvents(radioElement);
  }
  await randomDelay(200, 400); // Wait a bit after selection
  logElementState(radioElement, 'Radio (after)');
  // Use smart Save button logic
  const saveBtn = findSmartSaveButton();
  logElementState(saveBtn, 'Save Button (before)');
  if (saveBtn) {
    // Human-like Save button click
    await fireHumanEvents(saveBtn);
    logElementState(saveBtn, 'Save Button (after)');
    if (saveBtn.classList.contains('disabled') || saveBtn.hasAttribute('disabled')) {
      console.warn('[WARN] Save button is still disabled after all events!', {
        outerHTML: saveBtn.outerHTML,
        classList: saveBtn.className,
        disabled: saveBtn.hasAttribute('disabled'),
        ariaDisabled: saveBtn.getAttribute('aria-disabled'),
        tabIndex: saveBtn.tabIndex
      });
    }
  } else {
    console.warn('[LOG] Save button not found or not an HTMLElement (smart selector)');
  }
}

/**
 * Calculate total years of experience from profile
 */
function calculateTotalExperienceYears(profile: UserProfile): number {
  if (!profile.experience || profile.experience.length === 0) {
    return 0;
  }
  
  let totalMonths = 0;
  
  for (const exp of profile.experience) {
    const startDate = new Date(exp.startDate);
    const endDate = exp.endDate ? new Date(exp.endDate) : new Date(); // Use current date if still employed
    
    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
      const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + 
                    (endDate.getMonth() - startDate.getMonth());
      totalMonths += Math.max(0, months);
    }
  }
  
  return Math.round(totalMonths / 12);
}

/**
 * Wait for elements matching a selector to be available in the DOM
 */
async function waitForElements(selector: string, timeout: number = 5000): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      console.log(`Found ${elements.length} elements matching selector: ${selector}`);
      return true;
    }
    
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  console.warn(`Timed out waiting for elements: ${selector}`);
  return false;
}

/**
 * Send API requests through the background script to avoid CORS issues
 */
async function sendApiRequestViaBackground<T>(
  endpoint: string,
  method: string = 'GET',
  data: Record<string, unknown> = {} 
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'API_REQUEST',
        endpoint,
        method,
        data
      },
      (response: ApiResponse<T>) => {
        if (chrome.runtime.lastError) {
          console.error('Error sending message:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
          return;
        }
        
        if (response.success) {
          // Fix for undefined data issue
          resolve(response.data as T); // Type assertion to handle possible undefined
        } else {
          reject(new Error(response.error || 'Unknown error'));
        }
      }
    );
  });
}

/**
 * Find form fields based on field type
 */
function findFormFields(fieldType: string): HTMLElement[] {
  const selectors: Record<string, string[]> = {
    name: ['input[name*="name" i]', '[placeholder*="name" i]', 'input[id*="name" i]'],
    email: ['input[type="email"]', 'input[name*="email" i]', '[placeholder*="email" i]'],
    phone: ['input[type="tel"]', 'input[name*="phone" i]', 'input[name*="mobile" i]', '[placeholder*="phone" i]'],
    experience: ['textarea[name*="experience" i]', 'textarea[name*="work" i]', '[placeholder*="experience" i]', 'div[contenteditable="true"]'],
    education: ['textarea[name*="education" i]', 'textarea[name*="degree" i]', '[placeholder*="education" i]'],
    skills: ['textarea[name*="skill" i]', '[placeholder*="skill" i]', 'input[name*="skill" i]'],
  };
  
  const elements: HTMLElement[] = [];
  const fieldSelectors = selectors[fieldType] || [];
  
  for (const selector of fieldSelectors) {
    const found = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
    elements.push(...found.filter(el => el.offsetParent !== null)); // Only visible elements
  }
  
  return elements;
}

/**
 * Fill form fields with the provided value
 */
function fillFields(elements: HTMLElement[], value: string): void {
  for (const element of elements) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (element.isContentEditable) {
      element.textContent = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    
    console.log(`Filled field:`, element);
  }
}

/**
 * Human-like typing into a field (input, textarea, contenteditable)
 */
export async function humanType(element: HTMLElement, value: string) {
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.focus();
  let currentValue = '';
  for (const char of value) {
    currentValue += char;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.value = currentValue;
    } else if (element.hasAttribute('contenteditable')) {
      element.textContent = currentValue;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }));
    await new Promise(r => setTimeout(r, 60 + Math.random() * 120));
  }
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.blur();
  await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
}

/**
 * Fill a text, textarea, or contenteditable field and dispatch all relevant events (human-like)
 */
export async function fillTextField(selectorOrElement: string | Element, value: string) {
  let el: HTMLElement | null = null;
  if (typeof selectorOrElement === 'string') {
    el = document.querySelector(selectorOrElement) as HTMLElement;
  } else {
    el = selectorOrElement as HTMLElement;
  }
  if (!el) {
    console.warn('[AUTOMATION] Text field not found:', selectorOrElement);
    return false;
  }
  console.log('[AUTOMATION] Human-typing into text field:', el, 'with value:', value);
  await humanType(el, value);
  return true;
}

// Add this utility function for future use if needed
function safeClickApplyOrSearchButton(selector: string) {
  if (isChatbotActive()) {
    console.warn('[GUARD] Chatbot is active, skipping Apply/Search click:', selector);
    return;
  }
  const btn = document.querySelector(selector) as HTMLElement;
  if (btn && btn.offsetParent !== null && !btn.hasAttribute('disabled')) {
    btn.click();
  }
}