/**
 * Jest test setup file
 * 
 * This sets up the testing environment with any global mocks or configurations needed.
 */

// Mock the chrome API
global.chrome = {
  runtime: {
    sendMessage: jest.fn((message, callback) => {
      if (callback) {
        callback({});
      }
      return true;
    }),
    onMessage: {
      addListener: jest.fn()
    }
  },
  storage: {
    local: {
      get: jest.fn().mockImplementation((keys, callback) => {
        callback({});
      }),
      set: jest.fn().mockImplementation((items, callback) => {
        if (callback) callback();
      })
    },
    sync: {
      get: jest.fn().mockImplementation((keys, callback) => {
        callback({});
      }),
      set: jest.fn().mockImplementation((items, callback) => {
        if (callback) callback();
      })
    }
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  }
};

// Mock console methods
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
};

// Setup for handling contentEditable in JSDOM
Object.defineProperty(HTMLElement.prototype, 'textContent', {
  set(text) {
    this.innerHTML = text;
  },
  get() {
    return this.innerHTML;
  }
}); 