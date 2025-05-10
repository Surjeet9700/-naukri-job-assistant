// Environment variables that will be replaced at build time
export const config = {
  GEMINI_API_KEY: import.meta.env.VITE_GEMINI_API_KEY || '',
  API_ENDPOINT: import.meta.env.VITE_API_ENDPOINT || 'http://localhost:3000',
  apiUrl: import.meta.env.VITE_API_ENDPOINT || 'http://localhost:3000',
} as const;