export enum ApplicationStatus {
  NOT_APPLIED = 'NOT_APPLIED',
  IN_PROGRESS = 'IN_PROGRESS',
  APPLIED = 'APPLIED',
  FAILED = 'FAILED'
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location?: string;
  description: string;
  url: string;
  experience?: string;
  salary?: string;
  skills: string[];
  applicationStatus: ApplicationStatus;
  naukriJobId?: string; // The ID used on Naukri.com
  postedDate?: string;
  jobType?: string;
  isInternal: boolean;
}