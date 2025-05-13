import React from 'react';
import { UserProfile } from '../types/profile';

interface ProfileCardProps {
  profile: UserProfile;
}

const ProfileCard: React.FC<ProfileCardProps> = ({ profile }) => {
  return (
    <div className="bg-white rounded-lg shadow-md p-4 mb-4">
      <h2 className="text-lg font-semibold text-gray-800 mb-2">Profile Summary</h2>
      <div className="space-y-2 text-gray-700 text-sm">
        {/* Personal Information */}
        <div className="border-b pb-2">
          <h3 className="font-medium text-gray-800">Personal Information</h3>
          {profile.name && <div><strong>Name:</strong> {profile.name}</div>}
          {profile.email && <div><strong>Email:</strong> {profile.email}</div>}
          {profile.phone && <div><strong>Phone:</strong> {profile.phone}</div>}
        </div>
        
        {/* Summary Section */}
        {profile.summary && (
          <div className="border-b pb-2">
            <h3 className="font-medium text-gray-800">Professional Summary</h3>
            <p className="text-sm mt-1">{profile.summary}</p>
          </div>
        )}
        
        {/* Experience Section */}
        {profile.experience && profile.experience.length > 0 && (
          <div className="border-b pb-2">
            <h3 className="font-medium text-gray-800">Experience</h3>
            <ul className="ml-1 mt-1 space-y-2">
              {profile.experience.map((exp, idx) => (
                <li key={idx} className="pb-1">
                  <div className="font-medium">{exp.title} at {exp.company}</div>
                  <div className="text-gray-600 text-xs">{exp.startDate} - {exp.endDate || 'Present'}</div>
                  {exp.description && <p className="text-xs mt-1">{exp.description}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        
        {/* Education Section */}
        {profile.education && profile.education.length > 0 && (
          <div className="border-b pb-2">
            <h3 className="font-medium text-gray-800">Education</h3>
            <ul className="ml-1 mt-1 space-y-2">
              {profile.education.map((edu, idx) => (
                <li key={idx} className="pb-1">
                  <div className="font-medium">{edu.degree} in {edu.field}</div>
                  <div className="text-xs">{edu.institution}</div>
                  {edu.startDate && edu.endDate && (
                    <div className="text-gray-600 text-xs">{edu.startDate} - {edu.endDate}</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        
        {/* Skills Section */}
        {profile.skills && profile.skills.length > 0 && (
          <div>
            <h3 className="font-medium text-gray-800">Skills</h3>
            <div className="mt-1 flex flex-wrap gap-1">
              {profile.skills.map((skill, idx) => (
                <span 
                  key={idx} 
                  className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}
        
        {/* Additional Information */}
        <div className="mt-2">
          {profile.totalYearsOfExperience && (
            <div><strong>Total Experience:</strong> {profile.totalYearsOfExperience} years</div>
          )}
          {profile.currentCompany && (
            <div><strong>Current Company:</strong> {profile.currentCompany}</div>
          )}
          {profile.noticePeriod && (
            <div><strong>Notice Period:</strong> {profile.noticePeriod}</div>
          )}
          {profile.currentCtc && (
            <div><strong>Current CTC:</strong> {profile.currentCtc}</div>
          )}
          {profile.expectedCtc && (
            <div><strong>Expected CTC:</strong> {profile.expectedCtc}</div>
          )}
          {profile.immediateJoiner && (
            <div><strong>Availability:</strong> Immediate Joiner</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfileCard; 