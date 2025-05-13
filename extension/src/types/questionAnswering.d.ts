import { UserProfile } from '../popup/types/profile';

declare module '../content/services/questionAnswering' {
  export function answerApplicationQuestions(profile: UserProfile): Promise<boolean>;
  export function handleNaukriNoticePeriod(): Promise<boolean>;
  export function checkForFinalSaveButton(): Promise<boolean>;
  export function handleTechEducationQuestion(): Promise<boolean>;
} 