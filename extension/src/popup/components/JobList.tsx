import React from 'react';
import { Search, Filter, Loader, AlertCircle, RefreshCw } from 'lucide-react';
import JobCard from './JobCard';
import { Job } from '../types/job';

interface JobListProps {
  jobs: Job[];
  loading: boolean;
  error: string | null;
  onApply: (jobId: string) => void;
  applyingJobId: string | null;
  onResetProcessingJobs: () => void;
}

const JobList: React.FC<JobListProps> = ({ 
  jobs, 
  loading, 
  error, 
  onApply, 
  applyingJobId,
  onResetProcessingJobs
}) => {
  const [searchTerm, setSearchTerm] = React.useState('');
  const [filteredJobs, setFilteredJobs] = React.useState<Job[]>(jobs);

  React.useEffect(() => {
    // Sort jobs by matchScore first (highest score first), then filter by search term
    const sortedJobs = [...jobs].sort((a, b) => {
      // If both have matchScore, sort by score (highest first)
      if (a.matchScore && b.matchScore) {
        return b.matchScore - a.matchScore;
      }
      // If only one has matchScore, prioritize the one with matchScore
      if (a.matchScore) return -1;
      if (b.matchScore) return 1;
      // Default sorting by job title if no matchScore
      return a.title.localeCompare(b.title);
    });

    if (searchTerm.trim() === '') {
      setFilteredJobs(sortedJobs);
    } else {
      const lowercasedSearch = searchTerm.toLowerCase();
      setFilteredJobs(
        sortedJobs.filter(job => 
          job.title.toLowerCase().includes(lowercasedSearch) ||
          job.company.toLowerCase().includes(lowercasedSearch) ||
          job.skills.some(skill => skill.toLowerCase().includes(lowercasedSearch))
        )
      );
    }
  }, [searchTerm, jobs]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <Loader size={32} className="text-blue-600 animate-spin mb-4" />
        <p className="text-gray-600">Finding matching jobs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
        <AlertCircle size={24} className="text-red-500 mx-auto mb-2" />
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
        <p className="text-blue-600 mb-2">No matching jobs found</p>
        <p className="text-gray-600 text-sm">Try updating your profile with more skills or experience.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 sticky top-0 bg-white z-10 pb-2">
        <div className="flex items-center px-3 py-2 bg-gray-100 rounded-lg">
          <Search size={18} className="text-gray-500 mr-2" />
          <input
            type="text"
            placeholder="Search jobs, skills, companies..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-transparent border-none outline-none flex-1 text-gray-700"
          />
          <Filter size={18} className="text-gray-500 ml-2" />
        </div>
        <div className="mt-2 text-sm text-gray-600 flex items-center">
          <span>Found {filteredJobs.length} matching jobs</span>
          <button 
            onClick={onResetProcessingJobs} 
            className="ml-2 flex items-center text-blue-600 hover:text-blue-800"
          >
            <RefreshCw size={16} className="mr-1" />
            Reset
          </button>
        </div>
      </div>
      
      <div className="space-y-4">
        {filteredJobs.map(job => (
          <JobCard 
            key={job.id} 
            job={job} 
            onApply={onApply} 
            isApplying={applyingJobId === job.id} 
          />
        ))}
      </div>
    </div>
  );
};

export default JobList;