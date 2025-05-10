import { Job, ApplicationStatus } from '../../popup/types/job';
import { UserProfile } from '../../popup/types/profile';
import { config } from '../../config';

/**
 * Fetches matching jobs from the backend based on user profile
 */
export async function getMatchingJobs(profile: UserProfile): Promise<Job[]> {
  try {
    // Call backend API to get matching jobs
    const response = await fetch(`${config.apiUrl}/api/matching-jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ profile }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch matching jobs: ${response.statusText}`);
    }
    
    const data = await response.json();
    const jobs: Job[] = data.jobs;
    
    // Get existing saved jobs to preserve application status
    const storage = await chrome.storage.local.get('savedJobs');
    const savedJobs: Job[] = storage.savedJobs || [];
    
    // Merge new jobs with existing job statuses
    const mergedJobs = jobs.map(job => {
      const existingJob = savedJobs.find(j => j.id === job.id);
      return {
        ...job,
        applicationStatus: existingJob?.applicationStatus || ApplicationStatus.NOT_APPLIED
      };
    });
    
    // Update saved jobs
    await chrome.storage.local.set({ savedJobs: mergedJobs });
    
    return mergedJobs;
  } catch (error) {
    console.error('Error fetching matching jobs:', error);
    throw error;
  }
}