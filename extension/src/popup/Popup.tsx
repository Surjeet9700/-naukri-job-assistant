import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/Tabs';
import ProfileInput from './components/ProfileInput';
import JobList from './components/JobList';
import { UserCircle, BriefcaseIcon, Settings } from 'lucide-react';
import { UserProfile } from './types/profile';
import { Job, ApplicationStatus } from './types/job';
import { fetchMatchingJobs, applyToJob, getSavedJobs } from './services/jobService';
import './Popup.css';
import ProfileCard from './components/ProfileCard';

const Popup: React.FC = () => {
  const [activeTab, setActiveTab] = useState('jobs');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyingJobId, setApplyingJobId] = useState<string | null>(null);
  const [hasProfile, setHasProfile] = useState(false);

  // Check if profile exists on load
  useEffect(() => {
    const checkProfileExists = async () => {
      try {
        const savedProfile = await chrome.storage.local.get('userProfile');
        if (savedProfile.userProfile) {
          setProfile(savedProfile.userProfile);
          setHasProfile(true);
          
          // Also load jobs if profile exists
          loadSavedJobs();
        }
      } catch (err) {
        console.error('Error loading profile:', err);
      }
    };
    
    checkProfileExists();
  }, []);

  // Poll for job status updates
  useEffect(() => {
    // Don't poll if we have no jobs or we're not on the jobs tab
    if (jobs.length === 0 || activeTab !== 'jobs') return;

    // Poll for updates every 5 seconds
    const pollingInterval = setInterval(async () => {
      try {
        const storage = await chrome.storage.local.get('savedJobs');
        const savedJobs = storage.savedJobs || [];
        
        // Check if any job status has changed
        const hasChanges = jobs.some(job => {
          const savedJob = savedJobs.find((j: Job) => j.id === job.id);
          return savedJob && savedJob.applicationStatus !== job.applicationStatus;
        });
        
        // If changes detected, update our job list
        if (hasChanges) {
          console.log('Job status changes detected, updating UI');
          setJobs(savedJobs);
          
          // If a job was in progress and now failed, clear the applying state
          if (applyingJobId) {
            const appliedJob = savedJobs.find((j: Job) => j.id === applyingJobId);
            if (appliedJob && appliedJob.applicationStatus === ApplicationStatus.FAILED) {
              setApplyingJobId(null);
            }
          }
        }
      } catch (err) {
        console.error('Error polling for job status:', err);
      }
    }, 5000); // Check every 5 seconds
    
    return () => clearInterval(pollingInterval);
  }, [jobs, activeTab, applyingJobId]);

  const loadSavedJobs = async () => {
    try {
      setLoading(true);
      const savedJobs = await getSavedJobs();
      setJobs(savedJobs);
    } catch (err) {
      setError('Failed to load saved jobs');
    } finally {
      setLoading(false);
    }
  };

  const handleProfileSubmit = async (profileData: UserProfile) => {
    setLoading(true);
    setError(null);
    
    try {
      // Save profile to storage
      await chrome.storage.local.set({ userProfile: profileData });
      setProfile(profileData);
      setHasProfile(true);
      
      // Fetch matching jobs
      const matchingJobs = await fetchMatchingJobs(profileData);
      setJobs(matchingJobs);
      
      // Switch to jobs tab
      setActiveTab('jobs');
    } catch (err) {
      setError('Failed to process profile or fetch jobs');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (jobId: string) => {
    setApplyingJobId(jobId);
    
    try {
      // Update job status to in progress
      setJobs(prev => 
        prev.map(job => 
          job.id === jobId 
            ? { ...job, applicationStatus: ApplicationStatus.IN_PROGRESS } 
            : job
        )
      );
      
      // Initiate application process
      const result = await applyToJob(jobId);
      
      if (result.success) {
        // Update job status to applied if successful
        setJobs(prev => 
          prev.map(job => 
            job.id === jobId 
              ? { ...job, applicationStatus: ApplicationStatus.APPLIED } 
              : job
          )
        );
      } else {
        // Mark as failed if error
        setJobs(prev => 
          prev.map(job => 
            job.id === jobId 
              ? { ...job, applicationStatus: ApplicationStatus.FAILED } 
              : job
          )
        );
        setError(result.message);
      }
    } catch (err) {
      setError('Failed to apply to job');
      
      // Mark as failed
      setJobs(prev => 
        prev.map(job => 
          job.id === jobId 
            ? { ...job, applicationStatus: ApplicationStatus.FAILED } 
            : job
        )
      );
    } finally {
      setApplyingJobId(null);
    }
  };

  // Handler to reset all jobs that are "in progress" back to "not applied"
  const resetProcessingJobs = async () => {
    try {
      // Get current jobs from storage
      const storage = await chrome.storage.local.get('savedJobs');
      const savedJobs: Job[] = storage.savedJobs || [];

      // Reset any IN_PROGRESS jobs to NOT_APPLIED
      const updatedJobs = savedJobs.map(job => {
        if (job.applicationStatus === ApplicationStatus.IN_PROGRESS) {
          return { ...job, applicationStatus: ApplicationStatus.NOT_APPLIED };
        }
        return job;
      });

      // Update storage with the modified jobs
      await chrome.storage.local.set({ savedJobs: updatedJobs });

      // Update the local state
      setJobs(updatedJobs);
      
      // Clear the applying job ID if any
      setApplyingJobId(null);

      // Optional: Show a temporary success message
      const originalError = error;
      setError('All in-progress applications have been reset');
      setTimeout(() => setError(originalError), 2000);
    } catch (err) {
      console.error('Error resetting job statuses:', err);
      setError('Failed to reset job statuses');
    }
  };

  // Compute current status for StatusBar
  let status = 'Idle';
  if (loading) status = 'Loading';
  else if (applyingJobId) status = 'Applying';
  else if (jobs.some(j => j.applicationStatus === ApplicationStatus.IN_PROGRESS)) status = 'Waiting for Question';
  else if (jobs.some(j => j.applicationStatus === ApplicationStatus.APPLIED)) status = 'Completed';
  else if (error) status = 'Error';

  return (
    <div className="popup-root">
      {/* Status and error at the top */}
      <div className="w-[400px] min-h-[500px] p-4 bg-gray-50">
        <header className="flex justify-between items-center mb-4">
          <div className="flex items-center">
            <BriefcaseIcon size={24} className="text-blue-600 mr-2" />
            <h1 className="text-xl font-bold text-gray-800">Naukri Apply Assist</h1>
          </div>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full mb-4">
            <TabsTrigger value="jobs" className="flex-1">
              <BriefcaseIcon size={16} className="mr-2" />
              Jobs
            </TabsTrigger>
            <TabsTrigger value="profile" className="flex-1">
              <UserCircle size={16} className="mr-2" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex-1">
              <Settings size={16} className="mr-2" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="jobs">
            {!hasProfile ? (
              <div className="text-center py-8">
                <UserCircle size={48} className="mx-auto text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-700 mb-2">No Profile Found</h3>
                <p className="text-gray-600 mb-4">Please create your profile to find matching jobs.</p>
                <button 
                  onClick={() => setActiveTab('profile')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  Create Profile
                </button>
              </div>
            ) : (
              <JobList 
                jobs={jobs}
                loading={loading}
                error={error}
                onApply={handleApply}
                applyingJobId={applyingJobId}
                onResetProcessingJobs={resetProcessingJobs}
              />
            )}
          </TabsContent>

          <TabsContent value="profile">
            {profile && <ProfileCard profile={profile} />}
            <ProfileInput onProfileSubmit={handleProfileSubmit} loading={loading} />
          </TabsContent>

          <TabsContent value="settings">
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Settings</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" className="rounded text-blue-600" defaultChecked />
                    <span className="text-gray-700">Enable automatic filling</span>
                  </label>
                  <p className="text-sm text-gray-500 ml-6 mt-1">
                    Automatically fill application forms on Naukri
                  </p>
                </div>
                
                <div>
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" className="rounded text-blue-600" defaultChecked />
                    <span className="text-gray-700">Answer questions automatically</span>
                  </label>
                  <p className="text-sm text-gray-500 ml-6 mt-1">
                    Use AI to answer application questions
                  </p>
                </div>
                
                <div>
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" className="rounded text-blue-600" defaultChecked />
                    <span className="text-gray-700">Show notifications</span>
                  </label>
                  <p className="text-sm text-gray-500 ml-6 mt-1">
                    Get notified about application status
                  </p>
                </div>
                
                <div className="pt-4 border-t">
                  <button 
                    onClick={() => {
                      if (confirm('Are you sure you want to clear all data?')) {
                        chrome.storage.local.clear();
                        setProfile(null);
                        setJobs([]);
                        setHasProfile(false);
                        setActiveTab('profile');
                      }
                    }}
                    className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                  >
                    Clear All Data
                  </button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Popup;