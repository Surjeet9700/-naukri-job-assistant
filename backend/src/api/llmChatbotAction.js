const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini/OpenAI with your API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const ALLOWED_ACTION_TYPES = [
  'select', 'type', 'multiSelect', 'dropdown', 'upload', 'click', 'none'
];

function truncate(str, max = 2000) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '... [truncated]' : str;
}

/**
 * POST /api/llm-chatbot-action
 * Smart LLM-driven chatbot action generator
 */
router.post('/llm-chatbot-action', async (req, res) => {
  try {
    let { question, options, profile, jobDetails, pageHtml, resumeProfile } = req.body;
    if (!question || !profile) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields',
        answer: null 
      });
    }

    // Special handling for project description questions
    const isProjectQuestion = question.toLowerCase().includes('project') &&
                            (question.toLowerCase().includes('explain') ||
                             question.toLowerCase().includes('describe') ||
                             question.toLowerCase().includes('about'));
    
    if (isProjectQuestion) {
      // Return a well-structured project description
      return res.json({
        success: true,
        answer: "I have worked on several impactful projects utilizing modern technologies. My most recent project involved developing a scalable web application using React.js and Node.js, implementing RESTful APIs, and integrating with MongoDB for data persistence. The application featured real-time updates, responsive design, and followed best practices for security and performance. I also implemented automated testing using Jest and maintained CI/CD pipelines using GitHub Actions.",
        actionType: 'type'
      });
    }

    // Merge resumeProfile into profile if provided (resumeProfile takes precedence for missing fields)
    if (resumeProfile) {
      // If education is empty in profile but present in resumeProfile, use resumeProfile.education
      if ((!profile.education || profile.education.length === 0) && resumeProfile.education && resumeProfile.education.length > 0) {
        profile.education = resumeProfile.education;
        console.log('[LLM] Merged education from resumeProfile:', profile.education);
      }
      profile = {
        ...resumeProfile,
        ...profile,
        // Merge arrays (skills, experience, education)
        skills: Array.from(new Set([...(resumeProfile.skills || []), ...(profile.skills || [])])),
        experience: Array.isArray(profile.experience) && profile.experience.length > 0 ? profile.experience : (resumeProfile.experience || []),
        education: Array.isArray(profile.education) && profile.education.length > 0 ? profile.education : (resumeProfile.education || []),
      };
    }

    // Heuristic: If the question is about relocation, always answer 'Yes' for now
    const relocationKeywords = ['relocat', 'move to', 'shift to', 'willing to move', 'comfortable relocating'];
    const questionLower = question.toLowerCase();
    if (relocationKeywords.some(k => questionLower.includes(k))) {
      console.log('[LLM] Relocation question detected, using heuristic answer: Yes');
      return res.json({ 
        success: true,
        answer: 'Yes',
        actionType: 'select'
      });
    }

    // Heuristic: If the question is a radio question (options provided and question contains 'radio' or 'select one'), always select the first option
    if (options && options.length > 0 && (questionLower.includes('radio') || questionLower.includes('select one'))) {
      console.log('[LLM] Radio question detected, using heuristic answer: ' + options[0]);
      return res.json({ actionType: 'select', actionValue: options[0] });
    }

    // Heuristic: If the question is 'Save' or 'Apply', click the Save button
    if (questionLower === 'save' || questionLower === 'apply') {
      console.log('[LLM] Save/Apply question detected, using heuristic answer: click');
      return res.json({ actionType: 'click', actionValue: null });
    }

    // Warn if options are missing for select/multiSelect/dropdown
    if ((!options || options.length === 0) && /select|dropdown/i.test(question)) {
      console.warn('Warning: No options provided for a select/multiSelect/dropdown question:', question);
    }

    // Truncate large fields for prompt safety
    const safeProfile = truncate(JSON.stringify(profile), 2000);
    const safeJob = jobDetails ? truncate(JSON.stringify(jobDetails), 2000) : 'N/A';
    const safeHtml = truncate(pageHtml, 2000);
    const safeResume = resumeProfile ? truncate(JSON.stringify(resumeProfile), 2000) : 'N/A';

    // Enhanced prompt for text/textarea/contenteditable
    const prompt = `You are an automation agent for job application chatbots. Given the following context, return a JSON object with the best action to take on the UI. Supported actionType values: select, type, textarea, multiSelect, dropdown, upload, click, none.

You must reason and answer like a real human candidate, not a bot. Avoid robotic or copy-paste answers. If unsure, hedge politely or use 'not applicable' or 'prefer not to say'. Personalize answers using the profile, resume, and job context. If the question is open-ended, use experience, education, or skills from the profile/resume to craft a short, conversational answer. If the question is ambiguous, make a reasonable guess or skip.

Examples:
1. For a radio question: {"question": "Have you done B.E/B.Tech?", "options": ["Yes", "No"], ...} => {"actionType": "select", "actionValue": "Yes"}
2. For a text input: {"question": "Full name", ...} => {"actionType": "type", "actionValue": profile.name}
3. For a textarea: {"question": "Why do you want this job?", ...} => {"actionType": "textarea", "actionValue": "I'm excited about this opportunity because it matches my skills in ..."}
4. For a contenteditable: {"question": "Type your answer", ...} => {"actionType": "type", "actionValue": "I enjoy solving problems and working in teams."}
5. For an email question: {"question": "What is your email?", ...} => {"actionType": "type", "actionValue": profile.email}
6. For experience: {"question": "How many years of experience do you have?", ...} => {"actionType": "type", "actionValue": profile.experience (in years) }
7. For skills: {"question": "List your skills", ...} => {"actionType": "type", "actionValue": profile.skills (comma separated) }
8. For dropdown: {"question": "Select your highest qualification", "options": ["B.Tech", "M.Tech", "Other"], ...} => {"actionType": "dropdown", "actionValue": "B.Tech"}
9. For multi-select: {"question": "Which technologies do you know?", "options": ["React", "Angular", "Vue"], ...} => {"actionType": "multiSelect", "actionValue": ["React", "Vue"]}
10. For ambiguous: {"question": "Tell us something unique about you", ...} => {"actionType": "textarea", "actionValue": "I love learning new technologies and have built several side projects."}
11. For skip: {"question": "Is there anything else you'd like to add?", ...} => {"actionType": "none", "actionValue": null}
12. For not applicable: {"question": "Do you have a driving license?", ...} => {"actionType": "type", "actionValue": "Not applicable"}
13. For prefer not to say: {"question": "What is your current salary?", ...} => {"actionType": "type", "actionValue": "Prefer not to say"}

Always use the provided profile, resume, job details, and question context to infer the best answer. If the question is about the user's name, use the profile name. If about email, use the profile email. If about experience, use the profile or resume experience. If about education, use the profile or resume education. If about skills, use the profile or resume skills. If the question is open-ended, use profile or resume experience, education, or skills to answer. If uncertain, return {"actionType": "none", "actionValue": null} or a polite, human-like response.

Context:
Question: ${question}
Options: ${JSON.stringify(options)}
Profile: ${truncate(JSON.stringify(profile), 1000)}
JobDetails: ${truncate(JSON.stringify(jobDetails), 1000)}
PageHtml: ${truncate(pageHtml, 1000)}
ResumeData: ${truncate(JSON.stringify(resumeProfile), 1000)}

Return only a JSON object as described above.

If the question is a Yes/No or multiple-choice, always return actionType: "select" and actionValue as the option text.`;

    console.log('LLM prompt:', prompt);

    // Call Gemini/OpenAI with a timeout (20s)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    let result, responseText;
    try {
      result = await Promise.race([
        model.generateContent(prompt),
        new Promise((_, reject) => setTimeout(() => reject(new Error('LLM timeout')), 20000))
      ]);
      responseText = await result.response.text();
    } catch (err) {
      console.error('LLM API error or timeout:', err);
      // Return a fallback response for common questions
      const fallbackResponse = getFallbackResponse(question);
      if (fallbackResponse) {
        return res.json({
          success: true,
          ...fallbackResponse
        });
      }
      return res.status(500).json({ 
        success: false,
        error: 'LLM API error or timeout',
        details: err.message,
        answer: null
      });
    }

    // Extract JSON from the response (robust)
    let action = null;
    try {
      const matches = responseText.match(/\{[\s\S]*?\}/g);
      if (!matches || matches.length === 0) throw new Error('No JSON object found');
      action = JSON.parse(matches[0]);
      
      // Ensure consistent response format
      return res.json({
        success: true,
        answer: action.actionValue,
        actionType: action.actionType
      });
    } catch (e) {
      console.error('Failed to parse LLM response:', responseText);
      // Try fallback response
      const fallbackResponse = getFallbackResponse(question);
      if (fallbackResponse) {
        return res.json({
          success: true,
          ...fallbackResponse
        });
      }
      return res.status(500).json({ 
        success: false,
        error: 'LLM did not return valid JSON',
        raw: responseText,
        answer: null
      });
    }
  } catch (error) {
    console.error('Error in /api/llm-chatbot-action:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message,
      answer: null
    });
  }
});

// Helper function for fallback responses
function getFallbackResponse(question) {
  const questionLower = question.toLowerCase();
  
  // Common fallback responses
  const fallbacks = {
    project: {
      answer: "I have worked on several impactful projects utilizing modern technologies. My most recent project involved developing a scalable web application using React.js and Node.js, implementing RESTful APIs, and integrating with MongoDB for data persistence. The application featured real-time updates, responsive design, and followed best practices for security and performance.",
      actionType: 'type'
    },
    notice: {
      answer: "15 days",
      actionType: 'type'
    },
    salary: {
      answer: "As per market standards",
      actionType: 'type'
    },
    relocation: {
      answer: "Yes",
      actionType: 'select'
    },
    education: {
      answer: "B.Tech in Computer Science",
      actionType: 'type'
    }
  };

  // Find matching fallback
  for (const [key, response] of Object.entries(fallbacks)) {
    if (questionLower.includes(key)) {
      return response;
    }
  }

  return null;
}

module.exports = router; 