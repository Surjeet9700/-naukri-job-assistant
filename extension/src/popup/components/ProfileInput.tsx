import React, { useState } from 'react';
import { Upload, UserCircle, FileText, Loader } from 'lucide-react';
import { parseResume } from '../services/resumeParser';
import { UserProfile } from '../types/profile';

interface ProfileInputProps {
  onProfileSubmit: (profile: UserProfile) => void;
  loading: boolean;
}

const ProfileInput: React.FC<ProfileInputProps> = ({ onProfileSubmit, loading }) => {
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [parsingStatus, setParsingStatus] = useState<'idle' | 'parsing' | 'done' | 'error'>('idle');
  const [profile, setProfile] = useState<UserProfile>({
    name: '',
    email: '',
    phone: '',
    skills: [],
    experience: [],
    education: [],
    summary: '',
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setResumeFile(e.target.files[0]);
      setParsingStatus('idle');
    }
  };

  const handleParseResume = async () => {
    if (!resumeFile) return;
    
    setParsingStatus('parsing');
    try {
      const parsedProfile = await parseResume(resumeFile);
      setProfile(parsedProfile);
      setParsingStatus('done');
    } catch (error) {
      console.error('Error parsing resume:', error);
      setParsingStatus('error');
    }
  };

  const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setProfile(prev => ({ ...prev, [name]: value }));
  };

  const handleSkillsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const skills = e.target.value.split(',').map(skill => skill.trim());
    setProfile(prev => ({ ...prev, skills }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onProfileSubmit(profile);
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-4 max-w-md mx-auto">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Your Professional Profile</h2>
      
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <FileText size={20} className="text-blue-600" />
          <h3 className="text-md font-medium">Resume Upload</h3>
        </div>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
          <input
            type="file"
            id="resume"
            accept=".pdf,.doc,.docx"
            onChange={handleFileChange}
            className="hidden"
          />
          <label 
            htmlFor="resume" 
            className="cursor-pointer flex flex-col items-center justify-center"
          >
            <Upload size={24} className="text-blue-500 mb-2" />
            <span className="text-sm text-gray-600">
              {resumeFile ? resumeFile.name : 'Upload your resume (PDF, DOC, DOCX)'}
            </span>
          </label>
          
          {resumeFile && (
            <button
              onClick={handleParseResume}
              disabled={parsingStatus === 'parsing'}
              className="mt-2 px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors flex items-center justify-center mx-auto"
            >
              {parsingStatus === 'parsing' ? (
                <>
                  <Loader size={16} className="mr-2 animate-spin" />
                  Parsing...
                </>
              ) : (
                'Parse Resume'
              )}
            </button>
          )}
          
          {parsingStatus === 'done' && (
            <div className="mt-2 text-sm text-green-600">Resume parsed successfully!</div>
          )}
          
          {parsingStatus === 'error' && (
            <div className="mt-2 text-sm text-red-600">Error parsing resume. Please try again.</div>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Full Name
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={profile.name}
            onChange={handleProfileChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <div className="mb-3">
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email
          </label>
          <input
            type="email"
            id="email"
            name="email"
            value={profile.email}
            onChange={handleProfileChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <div className="mb-3">
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
            Phone
          </label>
          <input
            type="tel"
            id="phone"
            name="phone"
            value={profile.phone}
            onChange={handleProfileChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <div className="mb-3">
          <label htmlFor="skills" className="block text-sm font-medium text-gray-700 mb-1">
            Skills (comma separated)
          </label>
          <input
            type="text"
            id="skills"
            name="skills"
            value={profile.skills.join(', ')}
            onChange={handleSkillsChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <div className="mb-3">
          <label htmlFor="summary" className="block text-sm font-medium text-gray-700 mb-1">
            Professional Summary
          </label>
          <textarea
            id="summary"
            name="summary"
            value={profile.summary}
            onChange={handleProfileChange}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-2 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center"
        >
          {loading ? (
            <>
              <Loader size={18} className="mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <UserCircle size={18} className="mr-2" />
              Save Profile & Find Matching Jobs
            </>
          )}
        </button>
      </form>
    </div>
  );
};

export default ProfileInput;