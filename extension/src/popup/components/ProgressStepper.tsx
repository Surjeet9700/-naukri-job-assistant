import React from 'react';
import { ApplicationStatus } from '../types/job';

interface Step {
  id: ApplicationStatus;
  label: string;
  description: string;
}

const steps: Step[] = [
  {
    id: ApplicationStatus.NOT_APPLIED,
    label: 'Not Started',
    description: 'Application process not initiated'
  },
  {
    id: ApplicationStatus.IN_PROGRESS,
    label: 'In Progress',
    description: 'Filling out application details'
  },
  {
    id: ApplicationStatus.APPLIED,
    label: 'Applied',
    description: 'Application submitted successfully'
  },
  {
    id: ApplicationStatus.FAILED,
    label: 'Failed',
    description: 'Application process encountered an error'
  },
  {
    id: ApplicationStatus.UNKNOWN,
    label: 'Unknown',
    description: 'Application status unclear, please check manually'
  }
];

interface ProgressStepperProps {
  currentStatus: ApplicationStatus;
}

export const ProgressStepper: React.FC<ProgressStepperProps> = ({ currentStatus }) => {
  const currentIndex = steps.findIndex(step => step.id === currentStatus);
  
  return (
    <div className="py-4">
      <div className="relative">
        {/* Progress bar */}
        <div className="absolute top-4 left-0 w-full h-0.5 bg-gray-200">
          <div 
            className="absolute top-0 left-0 h-full bg-blue-600 transition-all duration-500"
            style={{ 
              width: `${(currentIndex / (steps.length - 1)) * 100}%` 
            }}
          />
        </div>
        
        {/* Steps */}
        <div className="relative flex justify-between">
          {steps.map((step, index) => {
            const isCompleted = index <= currentIndex;
            const isCurrent = index === currentIndex;
            
            return (
              <div key={step.id} className="flex flex-col items-center">
                <div 
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-200 ${
                    isCompleted 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {isCompleted ? '✓' : index + 1}
                </div>
                <div className="mt-2 text-center">
                  <div className={`text-sm font-medium ${
                    isCurrent ? 'text-blue-600' : 'text-gray-600'
                  }`}>
                    {step.label}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {step.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}; 