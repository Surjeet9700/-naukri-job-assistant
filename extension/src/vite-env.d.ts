/// <reference types="vite/client" />

interface ImportMeta {
  readonly env: {
    readonly VITE_API_ENDPOINT: string | undefined;
    readonly VITE_GEMINI_API_KEY: string | undefined;
    readonly [key: string]: string | undefined;
  };
} 