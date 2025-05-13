# Naukri Job Assistant

A browser extension that automates the job application process on Naukri.com. This extension helps users efficiently apply to multiple jobs by automatically filling forms, answering common questions, and handling the application workflow.

## Features

- Automatically detects and fills form fields on Naukri.com
- Intelligently answers common job application questions
- Handles radio button selections and dropdown choices
- Smart detection of save buttons to navigate through multi-step forms
- Background API integration for personalized responses

## Project Structure

The project consists of three main components:

1. **Browser Extension** (`/extension`) - The Chrome/Firefox extension that interacts with Naukri.com's interface
2. **Backend API** (`/backend`) - Node.js server handling AI-powered responses and data storage
3. **Admin Dashboard** (`/src`) - React-based dashboard for monitoring application status

## Development

### Prerequisites

- Node.js (v16+)
- npm or yarn
- Chrome or Firefox browser

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/Surjeet9700/-naukri-job-assistant.git
   cd naukri-job-assistant
   ```

2. Install dependencies:
   ```
   npm install
   cd extension && npm install
   cd ../backend && npm install
   ```

3. Build the extension:
   ```
   cd extension && npm run build
   ```

4. Start the backend server:
   ```
   cd backend && npm start
   ```

### Loading the Extension

#### Chrome
1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `extension/dist` directory

#### Firefox
1. Go to `about:debugging`
2. Click "This Firefox"
3. Click "Load Temporary Add-on"
4. Select the `manifest.json` in the `extension/dist` directory

## License

MIT 