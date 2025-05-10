import { FieldType } from '../types/field';

interface FieldInfo {
  element: HTMLElement;
  type: FieldType;
  label?: string;
  placeholder?: string;
  options?: string[];
}

/**
 * Enhanced field detection with shadow DOM support and improved selectors
 */
export class FieldDetector {
  private static readonly FIELD_SELECTORS = {
    text: [
      'input[type="text"]',
      'input:not([type])',
      'textarea',
      '[contenteditable="true"]',
      '[role="textbox"]'
    ],
    radio: [
      'input[type="radio"]',
      '[role="radio"]',
      '.radio-button',
      '.radio-option'
    ],
    checkbox: [
      'input[type="checkbox"]',
      '[role="checkbox"]',
      '.checkbox-option'
    ],
    select: [
      'select',
      '[role="combobox"]',
      '.dropdown',
      '.select-box'
    ],
    file: [
      'input[type="file"]',
      '[role="button"][aria-label*="upload"]',
      '.file-upload'
    ]
  };

  /**
   * Find all form fields in the document, including those in shadow DOM
   */
  public static findAllFields(): FieldInfo[] {
    const fields: FieldInfo[] = [];
    
    // Search in main document
    this.searchInDocument(document, fields);
    
    // Search in shadow DOM
    this.searchShadowDOM(document.body, fields);
    
    return fields;
  }

  /**
   * Find a specific field by label text or placeholder
   */
  public static findFieldByLabel(labelText: string): FieldInfo | null {
    const normalizedLabel = labelText.toLowerCase().trim();
    
    // Search in main document
    const field = this.searchFieldInDocument(document, normalizedLabel);
    if (field) return field;
    
    // Search in shadow DOM
    return this.searchFieldInShadowDOM(document.body, normalizedLabel);
  }

  private static searchInDocument(doc: Document, fields: FieldInfo[]): void {
    for (const [type, selectors] of Object.entries(this.FIELD_SELECTORS)) {
      const elements = doc.querySelectorAll(selectors.join(','));
      elements.forEach(element => {
        if (element instanceof HTMLElement) {
          const fieldInfo = this.getFieldInfo(element, type as FieldType);
          if (fieldInfo) fields.push(fieldInfo);
        }
      });
    }
  }

  private static searchShadowDOM(root: Element, fields: FieldInfo[]): void {
    // Get all elements that might have shadow roots
    const elements = root.querySelectorAll('*');
    
    elements.forEach(element => {
      // Check if element has a shadow root
      if (element.shadowRoot) {
        this.searchInDocument(element.shadowRoot, fields);
        this.searchShadowDOM(element.shadowRoot, fields);
      }
    });
  }

  private static searchFieldInDocument(doc: Document, labelText: string): FieldInfo | null {
    for (const [type, selectors] of Object.entries(this.FIELD_SELECTORS)) {
      const elements = doc.querySelectorAll(selectors.join(','));
      
      for (const element of elements) {
        if (element instanceof HTMLElement) {
          const fieldInfo = this.getFieldInfo(element, type as FieldType);
          if (fieldInfo && this.matchesLabel(fieldInfo, labelText)) {
            return fieldInfo;
          }
        }
      }
    }
    return null;
  }

  private static searchFieldInShadowDOM(root: Element, labelText: string): FieldInfo | null {
    const elements = root.querySelectorAll('*');
    
    for (const element of elements) {
      if (element.shadowRoot) {
        const field = this.searchFieldInDocument(element.shadowRoot, labelText);
        if (field) return field;
        
        const shadowField = this.searchFieldInShadowDOM(element.shadowRoot, labelText);
        if (shadowField) return shadowField;
      }
    }
    
    return null;
  }

  private static getFieldInfo(element: HTMLElement, type: FieldType): FieldInfo | null {
    const label = this.findLabel(element);
    const placeholder = element.getAttribute('placeholder') || '';
    
    let options: string[] = [];
    if (type === 'select' || type === 'radio') {
      options = this.getOptions(element);
    }
    
    return {
      element,
      type,
      label,
      placeholder,
      options: options.length > 0 ? options : undefined
    };
  }

  private static findLabel(element: HTMLElement): string | undefined {
    // Try to find label by id
    const id = element.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) return label.textContent?.trim();
    }
    
    // Try to find label by aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
    
    // Try to find label by parent label element
    const parentLabel = element.closest('label');
    if (parentLabel) return parentLabel.textContent?.trim();
    
    // Try to find label by proximity
    const nearbyText = this.findNearbyText(element);
    if (nearbyText) return nearbyText;
    
    return undefined;
  }

  private static findNearbyText(element: HTMLElement): string | undefined {
    // Look for text in previous siblings
    let current = element.previousElementSibling;
    while (current) {
      if (current.textContent?.trim()) {
        return current.textContent.trim();
      }
      current = current.previousElementSibling;
    }
    
    // Look for text in parent's previous siblings
    const parent = element.parentElement;
    if (parent) {
      current = parent.previousElementSibling;
      while (current) {
        if (current.textContent?.trim()) {
          return current.textContent.trim();
        }
        current = current.previousElementSibling;
      }
    }
    
    return undefined;
  }

  private static getOptions(element: HTMLElement): string[] {
    if (element instanceof HTMLSelectElement) {
      return Array.from(element.options).map(option => option.text);
    }
    
    // For radio buttons, find all related options
    if (element instanceof HTMLInputElement && element.type === 'radio') {
      const name = element.name;
      if (name) {
        return Array.from(document.querySelectorAll(`input[type="radio"][name="${name}"]`))
          .map(input => (input as HTMLInputElement).value);
      }
    }
    
    return [];
  }

  private static matchesLabel(fieldInfo: FieldInfo, labelText: string): boolean {
    const fieldLabel = fieldInfo.label?.toLowerCase() || '';
    const fieldPlaceholder = fieldInfo.placeholder?.toLowerCase() || '';
    
    return fieldLabel.includes(labelText) || 
           fieldPlaceholder.includes(labelText) ||
           fieldInfo.options?.some(opt => opt.toLowerCase().includes(labelText)) ||
           false;
  }
} 