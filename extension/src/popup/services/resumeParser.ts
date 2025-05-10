import { UserProfile } from '../types/profile';
import { sendMessageToBackground } from '../utils/messaging';

/**
 * Parses a resume file using Gemini AI and extracts structured information
 */
export const parseResume = async (file: File): Promise<UserProfile> => {
  try {
    // Convert file to base64 for transfer
    const base64 = await fileToBase64(file);
    
    // Send to background script to process with Gemini AI
    const response = await sendMessageToBackground({
      action: 'parseResume',
      data: {
        fileName: file.name,
        fileType: file.type,
        content: base64
      }
    });
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    return response.profile;
  } catch (error) {
    console.error('Error parsing resume:', error);
    throw error;
  }
};

/**
 * Convert a file to base64 encoding
 */
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to convert file to base64'));
      }
    };
    reader.onerror = (error) => reject(error);
  });
};