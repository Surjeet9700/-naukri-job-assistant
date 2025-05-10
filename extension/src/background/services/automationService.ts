import { Job } from '../../popup/types/job';
import { UserProfile } from '../../popup/types/profile';

/**
 * Starts the automation process by opening Naukri.com in a new tab
 * and injecting the content script
 */
export async function startAutomation(job: Job, profile: UserProfile): Promise<number> {
  try {
    // Create a new tab with the job URL
    const tab = await chrome.tabs.create({ url: job.url });
    
    if (!tab.id) {
      throw new Error('Failed to create tab');
    }
    
    // Store job and profile info in local storage for content script access
    await chrome.storage.local.set({
      currentAutomation: {
        jobId: job.id,
        profile: profile,
        timestamp: Date.now()
      }
    });
    
    // We will return the tab ID to track the automation
    return tab.id;
  } catch (error) {
    console.error('Error starting automation:', error);
    throw error;
  }
}

/**
 * Checks the status of a job application
 */
export async function checkApplicationStatus(naukriTabId: number): Promise<string> {
  try {
    // Send a message to the content script to check status
    const response = await chrome.tabs.sendMessage(naukriTabId, {
      action: 'checkStatus'
    });
    
    return response.status;
  } catch (error) {
    console.error('Error checking application status:', error);
    throw error;
  }
}