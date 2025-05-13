import React from 'react';
import { ExternalLink, CheckCircle, Clock, AlertCircle, RefreshCw, Percent } from 'lucide-react';
import { Job, ApplicationStatus } from '../types/job';

interface JobCardProps {
  job: Job;
  onApply: (jobId: string) => void;
  isApplying: boolean;
}

const JobCard: React.FC<JobCardProps> = ({ job, onApply, isApplying }) => {
  const getStatusBadge = () => {
    switch (job.applicationStatus) {
      case ApplicationStatus.APPLIED:
        return (
          <div className="flex items-center text-green-600 bg-green-50 px-2 py-1 rounded text-sm">
            <CheckCircle size={16} className="mr-1" />
            Applied
          </div>
        );
      case ApplicationStatus.IN_PROGRESS:
        return (
          <div className="flex items-center text-amber-600 bg-amber-50 px-2 py-1 rounded text-sm">
            <Clock size={16} className="mr-1" />
            In Progress
          </div>
        );
      case ApplicationStatus.FAILED:
        return (
          <div className="flex items-center text-red-600 bg-red-50 px-2 py-1 rounded text-sm">
            <AlertCircle size={16} className="mr-1" />
            Failed
          </div>
        );
      default:
        return null;
    }
  };

  const handleApplyClick = () => {
    onApply(job.id);
  };

  const getButtonContent = () => {
    if (isApplying) {
      return (
        <span className="flex items-center">
          <span className="animate-spin mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span>
          Applying...
        </span>
      );
    }

    switch (job.applicationStatus) {
      case ApplicationStatus.APPLIED:
        return 'Applied';
      case ApplicationStatus.IN_PROGRESS:
        return 'Applying'; 
      case ApplicationStatus.FAILED:
        return (
          <span className="flex items-center">
            <RefreshCw size={16} className="mr-1" />
            Retry
          </span>
        );
      default:
        return 'Apply Now';
    }
  };

  const getButtonStyles = () => {
    const baseStyles = 'px-4 py-2 rounded text-sm font-medium transition-all duration-200';
    
    if (isApplying) {
      return `${baseStyles} bg-blue-600 text-white cursor-wait`;
    }

    switch (job.applicationStatus) {
      case ApplicationStatus.APPLIED:
        return `${baseStyles} bg-green-100 text-green-800 cursor-default`;
      case ApplicationStatus.IN_PROGRESS:
        return `${baseStyles} bg-amber-100 text-amber-800 cursor-wait`;
      case ApplicationStatus.FAILED:
        return `${baseStyles} bg-red-100 text-red-800 hover:bg-red-200`;
      default:
        return `${baseStyles} bg-blue-600 text-white hover:bg-blue-700`;
    }
  };

  const isButtonDisabled = isApplying || 
    (job.applicationStatus === ApplicationStatus.IN_PROGRESS) || 
    (job.applicationStatus === ApplicationStatus.APPLIED);

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden mb-4 transition-all hover:shadow-md">
      <div className="p-4">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-lg font-semibold text-gray-800 line-clamp-2">{job.title}</h3>
          {getStatusBadge()}
        </div>
        
        <div className="mb-2 text-sm text-gray-600">{job.company}</div>
        
        <div className="flex items-center gap-3 mb-3 text-sm text-gray-500">
          {job.location && <div>{job.location}</div>}
          {job.experience && <div>• {job.experience}</div>}
          {job.salary && <div>• {job.salary}</div>}
          {typeof job.matchScore === 'number' && !isNaN(job.matchScore) && (
            <div className="flex items-center text-green-600 font-semibold bg-green-50 px-2 py-1 rounded">
              <Percent size={14} className="mx-1" />
              <span className="font-medium">{Math.round(job.matchScore)}% Match</span>
            </div>
          )}
        </div>
        
        <div className="mb-3">
          <p className="text-gray-600 text-sm line-clamp-3">{job.description}</p>
        </div>
        
        <div className="flex flex-wrap gap-2 mb-3">
          {job.skills.slice(0, 5).map((skill, index) => (
            <span 
              key={index} 
              className="bg-blue-50 text-blue-600 px-2 py-1 rounded text-xs"
            >
              {skill}
            </span>
          ))}
          {job.skills.length > 5 && (
            <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs">
              +{job.skills.length - 5} more
            </span>
          )}
        </div>
        
        <div className="flex justify-between items-center">
          <a 
            href={job.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-600 text-sm hover:underline flex items-center"
          >
            View Details <ExternalLink size={14} className="ml-1" />
          </a>
          
          <button
            onClick={handleApplyClick}
            disabled={isButtonDisabled}
            className={getButtonStyles()}
          >
            {getButtonContent()}
          </button>
        </div>
      </div>
    </div>
  );
};

export default JobCard;