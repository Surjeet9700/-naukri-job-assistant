export interface Experience {
  company: string;
  title: string;
  startDate: string;
  endDate?: string;
  description: string;
  isCurrent?: boolean;
}

export interface Education {
  institution: string;
  degree: string;
  field: string;
  startDate: string;
  endDate?: string;
  description?: string;
}

export interface UserProfile {
  name: string;
  email: string;
  phone: string;
  skills: string[];
  experience: Experience[];
  education: Education[];
  summary: string;
  resumeUrl?: string;
  noticePeriod?: string;
  expectedCtc?: string;
  currentCtc?: string;
  totalYearsOfExperience?: number;
  immediateJoiner?: boolean;
  currentCompany?: string;
  technicalSkills?: string[];
  projects?: {
    name: string;
    description?: string;
    technologies?: string[];
    responsibilities?: string[];
    outcome?: string;
  }[];
}