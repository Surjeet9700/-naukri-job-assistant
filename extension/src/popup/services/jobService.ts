import { Job, ApplicationStatus } from '../types/job';
import { UserProfile } from '../types/profile';
import { sendMessageToBackground } from '../utils/messaging';

/**
 * Fetches matching jobs from the backend based on user profile
 */
export const fetchMatchingJobs = async (profile: UserProfile): Promise<Job[]> => {
  try {
    const response = await sendMessageToBackground({
      action: 'fetchMatchingJobs',
      data: { profile }
    });
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    return response.jobs;
  } catch (error) {
    console.error('Error fetching matching jobs:', error);
    throw error;
  }
};

/**
 * Initiates the application process for a job
 */
export const applyToJob = async (jobId: string): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await sendMessageToBackground({
      action: 'applyToJob',
      data: { jobId }
    });
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    return response;
  } catch (error) {
    console.error('Error applying to job:', error);
    throw error;
  }
};

/**
 * Updates the application status for a job
 */
export const updateJobStatus = async (
  jobId: string, 
  status: ApplicationStatus
): Promise<void> => {
  try {
    await sendMessageToBackground({
      action: 'updateJobStatus',
      data: { jobId, status }
    });
  } catch (error) {
    console.error('Error updating job status:', error);
    throw error;
  }
};

/**
 * Retrieves all saved jobs and their application status
 */
export const getSavedJobs = async (): Promise<Job[]> => {
  try {
    const response = await sendMessageToBackground({
      action: 'getSavedJobs'
    });
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    return response.jobs;
  } catch (error) {
    console.error('Error getting saved jobs:', error);
    throw error;
  }
};