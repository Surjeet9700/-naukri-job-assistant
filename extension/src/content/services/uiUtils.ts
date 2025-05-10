// Utility to check if chatbot interface is active
export function isChatbotActive(): boolean {
  const selectors = [
    '[id*="chatbot_Drawer"]',
    '[class*="chatbot_Drawer"]',
    '[class*="chatbot_MessageContainer"]',
    '.chatbot_DrawerContentWrapper',
    '[id$="ChatbotContainer"]',
    '.chatbot-container',
    '.chat-container',
    '.interview-bot',
    '[id*="chat"]',
    '[class*="chat"]',
    '[role="dialog"]',
    '.modal-content',
    '.conversation-container'
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && (el as HTMLElement).offsetParent !== null && window.getComputedStyle(el).display !== 'none') {
      return true;
    }
  }
  return false;
}

// Utility to check if an element is a close/cancel/exit icon
export function isCloseIcon(el: HTMLElement): boolean {
  const text = (el.textContent || '').trim().toLowerCase();
  const aria = (el.getAttribute('aria-label') || '').toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  const cls = (el.className || '').toLowerCase();
  // Exclude if text is X, close, cancel, exit, or aria-label/role/class contains those
  return (
    text === '×' || text === 'x' || text === 'close' || text === 'cancel' || text === 'exit' ||
    aria.includes('close') || aria.includes('cancel') || aria.includes('exit') ||
    role.includes('close') || role.includes('cancel') || role.includes('exit') ||
    cls.includes('close') || cls.includes('cancel') || cls.includes('exit')
  );
}

// Utility to find the correct Save button (div or button) inside chatbot if active
export function findSmartSaveButton(container?: Element): HTMLElement | null {
  let root: Element | Document = document;
  if (isChatbotActive()) {
    const chatbotSelectors = [
      '[id*="chatbot_Drawer"]',
      '[class*="chatbot_Drawer"]',
      '[class*="chatbot_MessageContainer"]',
      '.chatbot_DrawerContentWrapper',
      '[id$="ChatbotContainer"]',
      '.chatbot-container',
      '.chat-container',
      '.interview-bot',
      '[id*="chat"]',
      '[class*="chat"]',
      '[role="dialog"]',
      '.modal-content',
      '.conversation-container'
    ];
    for (const selector of chatbotSelectors) {
      const el = document.querySelector(selector);
      if (el && (el as HTMLElement).offsetParent !== null && window.getComputedStyle(el).display !== 'none') {
        root = el;
        break;
      }
    }
  } else if (container) {
    root = container;
  }

  // PROTECTION - Ensure we're not mistakenly targeting search buttons
  // These are known selectors for search buttons we should avoid
  function isSearchElement(el: HTMLElement): boolean {
    // Check for search-related attributes
    const cls = (el.className || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const text = (el.textContent || '').trim().toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    
    // Search button indicators
    return (
      cls.includes('search') || 
      id.includes('search') || 
      text === 'search' || 
      aria.includes('search') ||
      // Common search UI elements
      el.querySelector('.ni-gnb-icn-search') !== null ||
      el.closest('.nI-gNb-sb__icon-wrapper') !== null ||
      el.closest('[class*="search"]') !== null
    );
  }

  // STEP 1: Direct Naukri chatbot selectors - highest priority
  // Try very specific selector for the Naukri save button first
  const naukriSpecificSelectors = [
    '.sendMsg[tabindex="0"]',  // Direct match for the Save button
    '#sendMsg__\\w+ .sendMsg',  // ID pattern for sendMsg container with .sendMsg inside
    '.sendMsgbtn_container .sendMsg', // Correct container with sendMsg class
    '.send:not(.disabled) .sendMsg', // Non-disabled send container with sendMsg inside
    '[id^="sendMsg_"] .sendMsg', // ID starts with sendMsg_ and contains sendMsg
    '.sendMsg' // Direct class match
  ];

  for (const selector of naukriSpecificSelectors) {
    try {
      const saveBtn = document.querySelector(selector) as HTMLElement;
      if (saveBtn && 
          saveBtn.offsetParent !== null && 
          !saveBtn.classList.contains('disabled') && 
          !saveBtn.hasAttribute('disabled') &&
          window.getComputedStyle(saveBtn).display !== 'none' &&
          !isSearchElement(saveBtn)) {
        console.log(`[SMART-SAVE] Found Naukri Save button with selector "${selector}":`, saveBtn, saveBtn.outerHTML);
        return saveBtn;
      }
    } catch (e) {
      // Some complex selectors might throw, ignore and continue
      console.warn(`[SMART-SAVE] Error with selector "${selector}":`, e);
    }
  }

  // STEP 2: Focus on buttons with "Save" text content
  const exactSaveButtons = Array.from(document.querySelectorAll('button, div[tabindex="0"], span[tabindex="0"]')).filter(el => {
    const element = el as HTMLElement;
    const text = element.textContent?.trim().toLowerCase() || '';
    return text === 'save' &&
      element.offsetParent !== null &&
      !element.classList.contains('disabled') &&
      !element.hasAttribute('disabled') &&
      window.getComputedStyle(element).display !== 'none' &&
      !isSearchElement(element);
  }) as HTMLElement[];

  if (exactSaveButtons.length > 0) {
    console.log('[SMART-SAVE] Found button with exact "Save" text:', exactSaveButtons[0], exactSaveButtons[0].outerHTML);
    return exactSaveButtons[0];
  }

  // STEP 3: Class-based filter (sendMsg, sendMsgBtn, send)
  const candidates = Array.from((root as Element).querySelectorAll('button, div, span, [tabindex]')) as HTMLElement[];
  let filtered = candidates.filter(el => {
    const cls = (el.className || '').toLowerCase();
    const isButtonLike = el.tagName === 'BUTTON' || 
                        el.getAttribute('role') === 'button' || 
                        el.hasAttribute('tabindex') ||
                        el.tagName === 'A';
    return (cls.includes('sendmsg') || cls.includes('sendmsgbtn') || cls === 'send' || cls.split(' ').includes('send')) &&
      (el as HTMLElement).offsetParent !== null &&
      !el.classList.contains('disabled') &&
      !el.hasAttribute('disabled') &&
      window.getComputedStyle(el).display !== 'none' &&
      !isCloseIcon(el) &&
      !isSearchElement(el) &&
      isButtonLike;
  });
  
  if (filtered.length > 0) {
    // Sort by specificity - prefer elements with smaller DOM trees
    filtered.sort((a, b) => {
      return a.querySelectorAll('*').length - b.querySelectorAll('*').length;
    });
    
    console.log('[SMART-SAVE] Candidates (class match):', filtered.map(el => ({
      text: (el.textContent || '').trim(),
      class: el.className,
      id: el.id,
      tag: el.tagName,
      nested: el.querySelectorAll('*').length,
    })));
    console.log('[SMART-SAVE] Chosen Save button (class match):', filtered[0], filtered[0]?.outerHTML);
    return filtered[0];
  }
  
  // STEP 4: Fallback - try to find the save button by traversing from known containers
  const sendMsgContainer = document.querySelector('[id*="sendMsgbtn_container"]');
  if (sendMsgContainer) {
    const saveInContainer = sendMsgContainer.querySelector('.sendMsg, .send .sendMsg, div[tabindex="0"]') as HTMLElement;
    if (saveInContainer && 
        saveInContainer.offsetParent !== null && 
        !saveInContainer.classList.contains('disabled') && 
        !saveInContainer.hasAttribute('disabled') &&
        window.getComputedStyle(saveInContainer).display !== 'none' &&
        !isSearchElement(saveInContainer)) {
      console.log('[SMART-SAVE] Found Save button inside sendMsgbtn_container:', saveInContainer, saveInContainer.outerHTML);
      return saveInContainer;
    }
  }
  
  // STEP 5: Look for elements within the chatbot container ONLY
  const chatbotContainer = document.querySelector('[id*="chatbot_Drawer"], .chatbot_Drawer, .chatbot_DrawerContentWrapper');
  if (chatbotContainer) {
    // Target only buttons inside the chatbot container
    const chatbotButtons = Array.from(chatbotContainer.querySelectorAll('button, [role="button"], [tabindex="0"]'))
      .filter(el => {
        const element = el as HTMLElement;
        return element.offsetParent !== null &&
               !element.classList.contains('disabled') &&
               !element.hasAttribute('disabled') &&
               window.getComputedStyle(element).display !== 'none' &&
               !isCloseIcon(element) &&
               !isSearchElement(element);
      }) as HTMLElement[];
      
    if (chatbotButtons.length > 0) {
      // Find the bottommost button in the chatbot container
      let bottomMost = chatbotButtons[0];
      let maxBottom = bottomMost.getBoundingClientRect().bottom;
      
      for (const button of chatbotButtons) {
        const rect = button.getBoundingClientRect();
        if (rect.bottom > maxBottom) {
          maxBottom = rect.bottom;
          bottomMost = button;
        }
      }
      
      console.log('[SMART-SAVE] Found bottom-most chatbot button:', bottomMost, bottomMost.outerHTML);
      return bottomMost;
    }
  }
  
  // STEP 6: Last resort fallback but with stronger search protection
  const actionButtons = Array.from(document.querySelectorAll('button, [role="button"], [tabindex="0"]')).filter(el => {
    const element = el as HTMLElement;
    const rect = element.getBoundingClientRect();
    const isSmallElement = rect.width < 200 && rect.height < 100;
    return element.offsetParent !== null &&
           !element.classList.contains('disabled') &&
           !element.hasAttribute('disabled') &&
           window.getComputedStyle(element).display !== 'none' &&
           isSmallElement &&
           !isCloseIcon(element) &&
           !isSearchElement(element) &&
           // Only consider elements in the visible viewport
           rect.bottom > 0 && 
           rect.top < window.innerHeight;
  }) as HTMLElement[];
  
  if (actionButtons.length > 0) {
    // Choose the bottom-most small button element
    let bottomMost = actionButtons[0];
    let maxBottom = bottomMost.getBoundingClientRect().bottom;
    
    for (const el of actionButtons) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > maxBottom) {
        maxBottom = rect.bottom;
        bottomMost = el;
      }
    }
    
    console.log('[SMART-SAVE] Last resort fallback - bottom-most action button:', bottomMost, bottomMost.outerHTML);
    return bottomMost;
  }

  // Fallback: log all candidates for debugging
  console.warn('[SMART-SAVE] No Save button found. Candidates were:', candidates.map(el => ({
    text: (el.textContent || '').trim(),
    class: el.className,
    id: el.id,
    tag: el.tagName,
    aria: el.getAttribute('aria-label'),
    role: el.getAttribute('role'),
    rect: el.getBoundingClientRect(),
    search: isSearchElement(el)
  })));
  
  return null;
} 