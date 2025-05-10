/// <reference types="chrome" />

/**
 * Utility functions for messaging between different parts of the extension
 */

/**
 * Base interface for all messages in the extension
 */
export interface Message {
  type: string;
  [key: string]: unknown;
}

/**
 * API Request message interface
 */
export interface ApiRequestMessage extends Message {
  type: 'API_REQUEST';
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: Record<string, unknown>;
}

/**
 * API Response interface
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Send a message to the background script
 * @param message The message to send
 * @returns Promise that resolves with the response from the background script
 */
export const sendMessageToBackground = <T>(message: Message): Promise<T> => {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response: ApiResponse<T>) => {
        const error = chrome.runtime.lastError;
        if (error) {
          console.error('Error sending message to background:', error);
          reject(error);
        } else {
          if (response && response.success === false && response.error) {
            reject(new Error(response.error));
          } else {
            // Return the full response, not just response.data
            resolve(response as unknown as T);
          }
        }
      });
    } catch (error) {
      console.error('Error in sendMessageToBackground:', error);
      reject(error);
    }
  });
};

/**
 * Sends a message to the active tab's content script
 * @param message The message to send
 * @returns Promise that resolves with the response from the content script
 */
export const sendMessageToContentScript = <T>(message: Message): Promise<T> => {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        reject(new Error('No active tab found'));
        return;
      }
      
      chrome.tabs.sendMessage(tabs[0].id, message, (response: ApiResponse<T>) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(error);
        } else {
          resolve(response as T);
        }
      });
    });
  });
};

/**
 * Send an API request through the background script
 * @param endpoint The API endpoint path (will be appended to the base URL)
 * @param method HTTP method (GET, POST, PUT, DELETE)
 * @param data Request data (for POST, PUT, etc.)
 * @returns Promise that resolves with the API response
 */
export const sendApiRequest = async <T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  data?: Record<string, unknown>
): Promise<T> => {
  try {
    const message: ApiRequestMessage = {
      type: 'API_REQUEST',
      endpoint,
      method,
      data
    };
    
    const response = await sendMessageToBackground<ApiResponse<T>>(message);
    
    if (response && response.success === false) {
      throw new Error(response.error || 'API request failed');
    }
    
    return response.data as T;
  } catch (error) {
    console.error(`API request to ${endpoint} failed:`, error);
    throw error;
  }
};