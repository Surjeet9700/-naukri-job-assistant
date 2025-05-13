import { describe, it, expect, jest } from '@jest/globals';
import { extractResumeDataFromPdf } from '../background/services/pdfParser';

// Mock PDF.js
jest.mock('pdfjs-dist', () => ({
  getDocument: jest.fn().mockImplementation(() => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: jest.fn().mockImplementation(() => ({
        getTextContent: jest.fn().mockResolvedValue({
          items: [
            { str: 'John Doe' },
            { str: 'johndoe@example.com' },
            { str: '+1 555-123-4567' },
            { str: 'Experience' },
            { str: 'Software Engineer at TechCorp' },
            { str: 'Skills' },
            { str: 'JavaScript, TypeScript, React' }
          ]
        })
      })),
      getMetadata: jest.fn().mockResolvedValue({
        info: {
          Title: 'John Doe Resume',
          Author: 'John Doe'
        }
      })
    })
  })),
  GlobalWorkerOptions: {
    workerSrc: ''
  }
}));

describe('PDF Parser', () => {
  it('extracts resume data from PDF', async () => {
    // Create mock ArrayBuffer
    const mockPdfData = new ArrayBuffer(10);
    
    // Test the function
    const result = await extractResumeDataFromPdf(mockPdfData);
    
    // Assertions
    expect(result).toBeDefined();
    expect(result.text).toContain('John Doe');
    expect(result.text).toContain('johndoe@example.com');
    expect(result.text).toContain('Experience');
    expect(result.text).toContain('Skills');
    
    // Check if sections are extracted correctly
    expect(result.sections).toBeDefined();
    expect(Object.keys(result.sections).length).toBeGreaterThan(0);
  });
}); 