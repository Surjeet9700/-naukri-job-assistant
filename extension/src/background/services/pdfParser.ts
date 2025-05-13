import * as pdfjs from 'pdfjs-dist';

// Set the PDF.js worker source using a more reliable approach for browser extensions
// This uses multiple fallback options to ensure the worker loads in various environments
const pdfJsVersion = '4.10.38'; 

// Try to load the worker from different sources
function setupPdfWorker() {
  try {
    // Option 1: Use CDN (most reliable for production)
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfJsVersion}/build/pdf.worker.min.js`;
    
    // Option 2: Set up an error handler to try alternative CDN if the first one fails
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      const url = args[0];
      if (typeof url === 'string' && url.includes('pdf.worker')) {
        return originalFetch.apply(this, args)
          .catch(err => {
            console.warn('Failed to load PDF.js worker from unpkg, trying cdnjs fallback', err);
            // If the original request fails and it's for the PDF worker, try the alternate CDN
            if (url.includes('unpkg.com')) {
              const cdnjsUrl = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfJsVersion}/pdf.worker.min.js`;
              return originalFetch(cdnjsUrl, args[1]);
            }
            throw err;
          });
      }
      return originalFetch.apply(this, args);
    };
  } catch (error) {
    console.error('Error setting up PDF.js worker:', error);
  }
}

// Initialize the worker
setupPdfWorker();

/**
 * Interface for parsed resume data
 */
export interface ParsedResume {
  text: string;
  sections: {
    [key: string]: string;
  };
  metadata?: any;
}

/**
 * Parse a PDF file to extract resume text
 * @param pdfData ArrayBuffer containing the PDF data
 * @returns Promise with the parsed text
 */
export async function parsePdfResume(pdfData: ArrayBuffer): Promise<ParsedResume> {
  try {
    console.log('[PDF] Starting PDF parsing');
    
    // Load the PDF document
    const loadingTask = pdfjs.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;
    
    console.log(`[PDF] PDF loaded with ${pdf.numPages} pages`);
    
    // Extract text from all pages
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n';
    }
    
    // Extract basic metadata
    const metadata = await pdf.getMetadata().catch(() => null);
    
    // Parse resume sections
    const sections = parseResumeStructure(fullText);
    
    console.log('[PDF] Successfully parsed resume');
    
    return {
      text: fullText,
      sections,
      metadata: metadata ? metadata.info : null
    };
  } catch (error) {
    console.error('[PDF] Error parsing PDF:', error);
    throw new Error('Failed to parse PDF resume: ' + (error as Error).message);
  }
}

/**
 * Attempt to extract structured sections from resume text
 * @param text Full resume text
 * @returns Object with resume sections
 */
function parseResumeStructure(text: string): { [key: string]: string } {
  const sections: { [key: string]: string } = {};
  
  // Common section headers in resumes
  const sectionPatterns = [
    { name: 'contact', regex: /contact\s+information|contact|contact\s+details/i },
    { name: 'summary', regex: /professional\s+summary|summary|profile|about\s+me/i },
    { name: 'experience', regex: /experience|work\s+experience|employment|work\s+history/i },
    { name: 'education', regex: /education|academic|qualifications|educational\s+background/i },
    { name: 'skills', regex: /skills|technical\s+skills|core\s+competencies|key\s+skills/i },
    { name: 'projects', regex: /projects|key\s+projects|project\s+experience/i },
    { name: 'certifications', regex: /certifications|certificates|professional\s+certifications/i },
    { name: 'languages', regex: /languages|language\s+proficiency/i }
  ];
  
  // Split text into lines
  const lines = text.split('\n').map(line => line.trim()).filter(line => line);
  
  // Find sections and their content
  let currentSection = 'header';
  sections[currentSection] = '';
  
  for (const line of lines) {
    // Check if this line is a section header
    let isSectionHeader = false;
    
    for (const { name, regex } of sectionPatterns) {
      if (regex.test(line) && line.length < 50) { // Assume section headers are not too long
        currentSection = name;
        sections[currentSection] = '';
        isSectionHeader = true;
        break;
      }
    }
    
    if (!isSectionHeader) {
      // Add this line to the current section
      sections[currentSection] += line + '\n';
    }
  }
  
  // Extract contact info from header or contact sections
  const contactRegex = {
    email: /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/i,
    phone: /(\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9})/i,
  };
  
  const contactText = sections.contact || sections.header;
  if (contactText) {
    const emailMatch = contactText.match(contactRegex.email);
    if (emailMatch) sections.email = emailMatch[0];
    
    const phoneMatch = contactText.match(contactRegex.phone);
    if (phoneMatch) sections.phone = phoneMatch[0];
  }
  
  return sections;
}

/**
 * Extract resume data from a PDF ArrayBuffer
 * @param fileData PDF file as ArrayBuffer
 * @returns Structured resume data
 */
export async function extractResumeDataFromPdf(fileData: ArrayBuffer): Promise<{
  text: string;
  basicInfo: {
    name?: string;
    email?: string;
    phone?: string;
  };
  sections: { [key: string]: string };
}> {
  try {
    const parsedResume = await parsePdfResume(fileData);
    
    // Try to extract name from header section
    let name = '';
    const headerLines = (parsedResume.sections.header || '').split('\n');
    if (headerLines.length > 0) {
      // Assume the first non-empty line that's not an email or phone might be the name
      const nameCandidate = headerLines.find(line => {
        const line_clean = line.trim();
        return line_clean && 
               line_clean.length > 2 && 
               !line_clean.includes('@') && 
               !/^\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}$/.test(line_clean);
      });
      
      if (nameCandidate) {
        name = nameCandidate.trim();
      }
    }
    
    return {
      text: parsedResume.text,
      basicInfo: {
        name,
        email: parsedResume.sections.email,
        phone: parsedResume.sections.phone
      },
      sections: parsedResume.sections
    };
  } catch (error) {
    console.error('[PDF] Error extracting resume data:', error);
    return {
      text: '',
      basicInfo: {},
      sections: {}
    };
  }
} 