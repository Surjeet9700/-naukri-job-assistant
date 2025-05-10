import React from 'react';
import { UserProfile } from '../types/profile';

interface ProfileCardProps {
  profile: UserProfile;
}

const ProfileCard: React.FC<ProfileCardProps> = ({ profile }) => {
  return (
    <div className="bg-white rounded-lg shadow-md p-4 mb-4">
      <h2 className="text-lg font-semibold text-gray-800 mb-2">Profile Summary</h2>
      <div className="space-y-1 text-gray-700 text-sm">
        {profile.name && <div><strong>Name:</strong> {profile.name}</div>}
        {profile.email && <div><strong>Email:</strong> {profile.email}</div>}
        {profile.phone && <div><strong>Phone:</strong> {profile.phone}</div>}
        {profile.summary && <div><strong>Summary:</strong> {profile.summary}</div>}
        {profile.skills && profile.skills.length > 0 && (
          <div><strong>Skills:</strong> {profile.skills.join(', ')}</div>
        )}
        {profile.experience && profile.experience.length > 0 && (
          <div>
            <strong>Experience:</strong>
            <ul className="ml-4 list-disc">
              {profile.experience.map((exp, idx) => (
                <li key={idx}>{exp.title} at {exp.company} ({exp.startDate} - {exp.endDate || 'Present'})</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfileCard; 