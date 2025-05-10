import { analyzePage } from '../../background/services/geminiService';
import { isChatbotActive } from './uiUtils';

interface ElementSearchResult {
  element: Element | null;
  confidence: number;
  strategy: string;
}

interface PageAnalysisResult {
  url: string;
  title: string;
  pageState: PageState;
  fields: FormField[];
  visibleText: string;
  hasNoticeForm: boolean;
  timestamp: number;
}

type PageState = 'unknown' | 'notice_period_question' | 'chat_interface' | 'application_form' | 'job_listing' | 'application_success';

interface FormField {
  name: string;
  value: string;
}

/**
 * Service to dynamically analyze and find elements on the page
 */
export class PageAnalyzer {
  private async getRelevantHTML(element?: Element): Promise<string> {
    // Get a simplified version of the relevant HTML
    const root = element || document.body;
    const cloned = root.cloneNode(true) as HTMLElement;
    
    // Remove scripts and unnecessary attributes
    const scripts = cloned.getElementsByTagName('script');
    for (let i = scripts.length - 1; i >= 0; i--) {
      scripts[i].remove();
    }
    
    // Clean up the HTML to focus on structure
    return cloned.innerHTML
      .replace(/(\r\n|\n|\r|\s{2,})/gm, ' ') // Remove extra whitespace
      .replace(/style="[^"]*"/g, '') // Remove inline styles
      .replace(/data-[^= ]*="[^"]*"/g, ''); // Remove data attributes
  }

  /**
   * Find an element using AI-guided analysis
   */
  async findElement(taskType: 'findChatbot' | 'findQuestionInput' | 'findAnswerSubmit', context?: string): Promise<ElementSearchResult> {
    try {
      const html = await this.getRelevantHTML();
      const analysis = await analyzePage({
        html,
        taskType,
        currentState: context
      });

      // Try each suggested selector
      for (const selector of (analysis.selectors || [])) {
        try {
          const element = document.querySelector(selector || '');
          if (element) {
            return {
              element,
              confidence: analysis.confidence,
              strategy: analysis.strategy || ''
            };
          }
        } catch (e) {
          console.log(`Selector ${selector} failed:`, e);
        }
      }

      // If no selectors worked, return null with the confidence
      return {
        element: null,
        confidence: analysis.confidence,
        strategy: analysis.strategy || ''
      };
    } catch (error) {
      console.error('Error in findElement:', error);
      return {
        element: null,
        confidence: 0,
        strategy: 'failed'
      };
    }
  }

  /**
   * Find multiple elements matching a pattern
   */
  async findElements(taskType: 'findChatbot' | 'findQuestionInput' | 'findAnswerSubmit', context?: string): Promise<ElementSearchResult[]> {
    try {
      const html = await this.getRelevantHTML();
      const analysis = await analyzePage({
        html,
        taskType,
        currentState: context
      });

      const results: ElementSearchResult[] = [];

      // Try each suggested selector
      for (const selector of (analysis.selectors || [])) {
        try {
          const elements = document.querySelectorAll(selector || '');
          if (elements.length > 0) {
            Array.from(elements).forEach(element => {
              results.push({
                element,
                confidence: analysis.confidence,
                strategy: analysis.strategy || ''
              });
            });
          }
        } catch (e) {
          console.log(`Selector ${selector} failed:`, e);
        }
      }

      return results;
    } catch (error) {
      console.error('Error in findElements:', error);
      return [];
    }
  }

  /**
   * Analyze an element's purpose and get interaction strategy
   */
  async analyzeElement(element: Element, context?: string): Promise<{strategy: string; confidence: number}> {
    try {
      const html = await this.getRelevantHTML(element);
      const analysis = await analyzePage({
        html,
        taskType: 'findQuestionInput',
        currentState: context
      });

      return {
        strategy: analysis.strategy || '',
        confidence: analysis.confidence
      };
    } catch (error) {
      console.error('Error analyzing element:', error);
      return {
        strategy: 'unknown',
        confidence: 0
      };
    }
  }
}

/**
 * Analyzes the current page content
 */
export async function analyzePageContent(): Promise<PageAnalysisResult> {
  try {
    // Check for specific application types
    const isNaukriPage = window.location.href.includes('naukri.com');
    const isNaukriNoticePeriod = isNaukriPage && 
      Boolean(document.querySelector('[id*="chatbot_Drawer"]')) &&
      (document.body.textContent?.toLowerCase().includes('notice period') || false);
    
    // Collect all form fields
    const fields = detectFormFields();
    
    // Detect the current state of the page
    let pageState: PageState = 'unknown';
    
    if (isChatbotActive()) {
      pageState = 'chat_interface';
    } else if (isNaukriNoticePeriod) {
      pageState = 'notice_period_question';
      console.log('Page analysis detected Naukri notice period dialog');
    } else if (Boolean(document.querySelector('[id*="ChatbotContainer"], .chatbot-container'))) {
      pageState = 'chat_interface';
    } else if (fields.length > 3) { // Basic heuristic for form detection
      pageState = 'application_form';
    } else if (Boolean(document.querySelector('[class*="apply"], [id*="apply"], button:contains("Apply")'))) {
      pageState = 'job_listing';
    } else if ((document.body.textContent?.toLowerCase().includes('successfully') || false) && 
               (document.body.textContent?.toLowerCase().includes('applied') || false)) {
      pageState = 'application_success';
    }
    
    // Enhanced detection for notice period dialog
    if (isNaukriPage) {
      const dialogContainer = document.querySelector('[id*="chatbot_Drawer"], [class*="chatbot_Drawer"]');
      if (dialogContainer) {
        const dialogText = (dialogContainer.textContent || '').toLowerCase();
        if (dialogText.includes('notice period') && Boolean(document.querySelector('.src_radio-btn-container'))) {
          pageState = 'notice_period_question';
          console.log('Enhanced detection found Naukri notice period dialog');
        }
      }
    }
    
    // Get visible text content for analysis
    const visibleText = getVisibleTextContent();
    
    // Return analysis result
    return {
      url: window.location.href,
      title: document.title,
      pageState,
      fields,
      visibleText: visibleText.slice(0, 5000), // Limit text to avoid large payloads
      hasNoticeForm: Boolean(isNaukriNoticePeriod), // Flag specifically for notice period detection
      timestamp: Date.now()
    };
  } catch (error) {
    console.error('Error analyzing page content:', error);
    throw error;
  }
}

// Fallback for detectFormFields
function detectFormFields(): FormField[] {
  // Dummy implementation, replace with actual if available
  return [];
}

// Fallback for getVisibleTextContent
function getVisibleTextContent(): string {
  // Dummy implementation, replace with actual if available
  return document.body.innerText || '';
}