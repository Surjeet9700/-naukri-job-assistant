import { UserProfile } from '../types/profile';
import { sendMessageToBackground } from '../utils/messaging';

// Define types for API responses
interface ResumeParserResponse {
  success: boolean;
  data?: UserProfile;
  profile?: UserProfile;
  error?: string;
}

/**
 * Parses a resume file using Gemini AI and extracts structured information
 */
export const parseResume = async (file: File): Promise<UserProfile> => {
  try {
    console.log(`Starting resume parsing process for ${file.name} (${file.type})`);
    
    // Convert file to base64 for transfer
    const base64 = await fileToBase64(file);
    console.log('File converted to base64, sending to background script');
    
    // Send to background script to process with Gemini AI
    const response = await sendMessageToBackground<ResumeParserResponse>({
      type: 'PARSE_RESUME',
      action: 'parseResume',
      data: {
        file: base64,
        fileType: file.type,
        fileName: file.name
      }
    });
    
    console.log('Received response from background script:', response);
    
    if (!response || response.error) {
      throw new Error(response?.error || 'Failed to parse resume');
    }
    
    // Extract the profile data from the response
    const profileData = response.data || response.profile;
    
    if (!profileData) {
      throw new Error('No profile data returned from parser');
    }
    
    // Validate and normalize the profile data
    const validatedProfile = validateProfileData(profileData);
    console.log('Validated profile data:', validatedProfile);
    
    return validatedProfile;
  } catch (error) {
    console.error('Error parsing resume:', error);
    throw error;
  }
};

// Create an interface for the extended profile that includes resumeText
interface ExtendedUserProfile extends UserProfile {
  resumeText?: string;
  rawText?: string;
}

/**
 * Validate and normalize the profile data
 */
const validateProfileData = (profileData: any): UserProfile => {
  // Create a base profile with defaults for required fields
  const baseProfile: ExtendedUserProfile = {
    name: profileData.name || '',
    email: profileData.email || '',
    phone: profileData.phone || '',
    skills: Array.isArray(profileData.skills) ? profileData.skills : [],
    experience: [],
    education: [],
    summary: profileData.summary || ''
  };
  
  // Add optional fields if they exist
  if (profileData.totalYearsOfExperience) {
    baseProfile.totalYearsOfExperience = profileData.totalYearsOfExperience;
  }
  
  if (profileData.currentCompany) {
    baseProfile.currentCompany = profileData.currentCompany;
  }
  
  if (profileData.noticePeriod) {
    baseProfile.noticePeriod = profileData.noticePeriod;
  }
  
  if (profileData.currentCtc) {
    baseProfile.currentCtc = profileData.currentCtc;
  }
  
  if (profileData.expectedCtc) {
    baseProfile.expectedCtc = profileData.expectedCtc;
  }
  
  if (profileData.immediateJoiner) {
    baseProfile.immediateJoiner = profileData.immediateJoiner;
  }
  
  // Handle experience array
  if (Array.isArray(profileData.experience)) {
    baseProfile.experience = profileData.experience.map((exp: any) => ({
      company: exp.company || 'Unknown Company',
      title: exp.title || 'Unknown Position',
      startDate: exp.startDate || '',
      endDate: exp.endDate || 'Present',
      description: exp.description || '',
      isCurrent: exp.isCurrent || (exp.endDate === 'Present' || !exp.endDate)
    }));
  }
  
  // Handle education array
  if (Array.isArray(profileData.education)) {
    baseProfile.education = profileData.education.map((edu: any) => ({
      institution: edu.institution || 'Unknown Institution',
      degree: edu.degree || '',
      field: edu.field || '',
      startDate: edu.startDate || '',
      endDate: edu.endDate || '',
      description: edu.description || ''
    }));
  }
  
  // If the profile has raw resume text, include it
  if (profileData.rawText) {
    baseProfile.resumeText = profileData.rawText;
  }
  
  return baseProfile;
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