/**
 * LLM-Driven Job Application Chatbot API
 * 
 * This API leverages a Large Language Model (LLM) to intelligently handle all types of
 * job application questions. The core philosophy is to rely primarily on the LLM's capabilities
 * rather than hardcoded logic, with only minimal fallbacks for critical cases.
 * 
 * Key principles:
 * 1. Use a comprehensive prompt to guide the LLM to handle all question types
 * 2. Minimal hardcoded logic - only required to fix critical issues or LLM failures
 * 3. Special handling for disability percentage questions to consistently return "0%"
 * 4. Robust error handling with graceful fallbacks
 */

const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const LOGS_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const ALLOWED_ACTION_TYPES = [
  'select', 'type', 'multiSelect', 'dropdown', 'upload', 'click', 'none'
];

function truncate(str, max = 2000) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '... [truncated]' : str;
}

function logLLMInteraction(data) {
  try {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const logFile = path.join(LOGS_DIR, `llm-interaction-${timestamp}.json`);
    fs.writeFileSync(logFile, JSON.stringify(data, null, 2));
    console.log(`[LLM] Logged interaction to ${logFile}`);
    return logFile;
  } catch (error) {
    console.error('[LLM] Failed to log interaction:', error);
    return null;
  }
}

/**
 * RESUME PARSING AND CONTEXT EXTRACTION 
 * Consolidated functions for handling resume data throughout the application
 */

/**
 * Comprehensive resume data extractor
 * This function centralizes resume parsing from multiple sources
 * to ensure the LLM has the richest possible context
 */
function extractComprehensiveResumeData(profile, resumeProfile) {
  const comprehensiveData = { ...profile };
  
  if (resumeProfile) {
    comprehensiveData.education = comprehensiveData.education || resumeProfile.education || [];
    comprehensiveData.experience = comprehensiveData.experience || resumeProfile.experience || [];
    comprehensiveData.skills = comprehensiveData.skills || resumeProfile.skills || [];
    
    if (profile.skills && resumeProfile.skills) {
      comprehensiveData.skills = Array.from(new Set([...profile.skills, ...resumeProfile.skills]));
    }
    
    if (!comprehensiveData.totalYearsOfExperience && resumeProfile.totalYearsOfExperience) {
      comprehensiveData.totalYearsOfExperience = resumeProfile.totalYearsOfExperience;
    }
    
    if (!comprehensiveData.currentCompany && resumeProfile.currentCompany) {
      comprehensiveData.currentCompany = resumeProfile.currentCompany;
    }
    
    if (!comprehensiveData.technicalSkills && resumeProfile.technicalSkills) {
      comprehensiveData.technicalSkills = resumeProfile.technicalSkills;
    }
    
    if (!comprehensiveData.primarySkills && resumeProfile.primarySkills) {
      comprehensiveData.primarySkills = resumeProfile.primarySkills;
    }
    
    if (!comprehensiveData.highestEducation && resumeProfile.highestEducation) {
      comprehensiveData.highestEducation = resumeProfile.highestEducation;
    }
    
    if (resumeProfile.rawText) {
      comprehensiveData.rawText = resumeProfile.rawText;
    }

    if (resumeProfile.extractedInfo || resumeProfile.extractedData) {
      const extractedData = resumeProfile.extractedInfo || resumeProfile.extractedData || {};
      comprehensiveData.extractedData = { ...extractedData };
    }
  }
  
  if (comprehensiveData.rawText || (resumeProfile && resumeProfile.rawText)) {
    const rawText = comprehensiveData.rawText || (resumeProfile && resumeProfile.rawText);
    const extractedInfo = extractResumeData(rawText);
    
    comprehensiveData.extractedData = {
      ...(comprehensiveData.extractedData || {}),
      ...extractedInfo
    };
  }
  
  if (!comprehensiveData.totalYearsOfExperience && comprehensiveData.experience && comprehensiveData.experience.length > 0) {
    comprehensiveData.totalYearsOfExperience = calculateExperienceYears(comprehensiveData);
  }
  
  return comprehensiveData;
}

/**
 * POST /api/llm-chatbot-action
 * Smart LLM-driven chatbot action generator
 */
router.post('/llm-chatbot-action', async (req, res) => {
  try {
    let { question, options, profile, jobDetails, resumeProfile, questionMetadata, messageHistory } = req.body;
    if (!question || !profile) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields',
        answer: null 
      });
    }

    const interactionData = {
      timestamp: new Date().toISOString(),
      question,
      options,
      profile: { ...profile, experience: profile.experience?.length || 0 },
      resumeProfile: resumeProfile ? { ...resumeProfile, experience: resumeProfile.experience?.length || 0 } : null,
      jobDetails: jobDetails ? { ...jobDetails } : null,
      questionMetadata: questionMetadata || {},
      messageHistory: messageHistory || {}
    };

    profile = extractComprehensiveResumeData(profile, resumeProfile);
    
    const questionLower = question.toLowerCase();
    const questionCategories = {
      projectDescription: questionLower.includes('project') && 
                          (questionLower.includes('explain') || 
                          questionLower.includes('describe') || 
                          questionLower.includes('about')),
      education: questionLower.includes('education') || 
                questionLower.includes('degree') || 
                questionLower.includes('qualification') ||
                questionLower.includes('b.e') || 
                questionLower.includes('b.tech') ||
                questionLower.includes('graduate'),
      experience: questionLower.includes('experience') || 
                 questionLower.includes('work') || 
                 questionLower.includes('job') ||
                 (questionLower.includes('years') && questionLower.includes('of')),
      skills: questionLower.includes('skill') || 
             questionLower.includes('technology') || 
             questionLower.includes('proficiency') ||
             questionLower.includes('knowledge'),
      relocation: relocationKeywords.some(k => questionLower.includes(k)),
      salary: questionLower.includes('salary') || 
             questionLower.includes('ctc') || 
             questionLower.includes('compensation') ||
             questionLower.includes('package'),
      noticePeriod: questionLower.includes('notice') || 
                   questionLower.includes('join') ||
                   questionLower.includes('available'),
      personalInfo: questionLower.includes('disability') || 
                   questionLower.includes('veteran') || 
                   questionLower.includes('gender') || 
                   questionLower.includes('diversity') ||
                   questionLower.includes('percentage') ||
                   questionLower.includes('marital') ||
                   questionLower.includes('race') ||
                   questionLower.includes('ethnicity')
    };
    
    interactionData.questionCategories = questionCategories;
    
    const prompt = buildEnhancedPrompt(
      question, 
      options, 
      profile, 
      jobDetails, 
      questionCategories, 
      questionMetadata, 
      messageHistory
    );

    console.log('[LLM] Using enhanced prompt for question type');
    
    interactionData.llmRequest = {
      model: 'gemini-2.0-flash',
      promptLength: prompt.length,
      questionCategories
    };

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    let result, responseText;
    try {
      result = await Promise.race([
        model.generateContent(prompt),
        new Promise((_, reject) => setTimeout(() => reject(new Error('LLM timeout')), 20000))
      ]);
      responseText = await result.response.text();
      
      interactionData.llmResponse = {
        raw: responseText,
        status: 'success'
      };
    } catch (err) {
      console.error('LLM API error or timeout:', err);
      interactionData.llmResponse = {
        error: err.message,
        status: 'error'
      };
      
      const fallbackResponse = getFallbackResponse(question, profile);
      if (fallbackResponse) {
        interactionData.response = {
          type: 'fallback',
          category: 'api-error',
          answer: fallbackResponse.answer
        };
        logLLMInteraction(interactionData);
        return res.json({
          success: true,
          ...fallbackResponse
        });
      }
      logLLMInteraction(interactionData);
      return res.status(500).json({ 
        success: false,
        error: 'LLM API error or timeout',
        details: err.message,
        answer: null
      });
    }

    let action = null;
    try {
      const matches = responseText.match(/\{[\s\S]*?\}/g);
      if (!matches || matches.length === 0) throw new Error('No JSON object found');
      action = JSON.parse(matches[0]);
      
      const validatedAction = validateAndFixLLMResponse(action, question, options, profile);
      
      interactionData.response = {
        type: 'llm',
        processed: validatedAction,
        actionType: validatedAction.actionType,
        actionValue: validatedAction.actionValue
      };
      
      logLLMInteraction(interactionData);
      
      return res.json({
        success: true,
        answer: validatedAction.actionValue,
        actionType: validatedAction.actionType
      });
    } catch (e) {
      console.error('Failed to parse LLM response:', responseText);
      interactionData.parseError = e.message;
      
      const fallbackResponse = getFallbackResponse(question, profile);
      if (fallbackResponse) {
        interactionData.response = {
          type: 'fallback',
          category: 'parse-error',
          answer: fallbackResponse.answer
        };
        logLLMInteraction(interactionData);
        return res.json({
          success: true,
          ...fallbackResponse
        });
      }
      
      logLLMInteraction(interactionData);
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

function extractResumeData(rawText) {
  if (!rawText) return {};
  
  const extractedData = {};
  
  const noticePeriodMatch = rawText.match(/notice\s*period[:\s]*(\d+\s*(?:days|months|weeks))/i);
  if (noticePeriodMatch) {
    extractedData.noticePeriod = noticePeriodMatch[1];
  }
  
  const ctcMatch = rawText.match(/(?:current|present)\s*ctc[:\s]*(?:Rs\.?|INR)?\s*([\d,\.]+)\s*(?:lpa|lakhs|lacs|L)/i);
  if (ctcMatch) {
    extractedData.currentCtc = ctcMatch[1];
  }
  
  const expectCtcMatch = rawText.match(/expected\s*ctc[:\s]*(?:Rs\.?|INR)?\s*([\d,\.]+)\s*(?:lpa|lakhs|lacs|L)/i);
  if (expectCtcMatch) {
    extractedData.expectedCtc = expectCtcMatch[1];
  }
  
  const expYearsMatch = rawText.match(/(\d+(?:\.\d+)?)\+?\s*years?\s*(?:of)?\s*experience/i);
  if (expYearsMatch) {
    extractedData.totalYearsOfExperience = parseFloat(expYearsMatch[1]);
  }
  
  if (rawText.match(/immediate\s*(?:joiner|joining|available|availability)/i)) {
    extractedData.immediateJoiner = true;
  }
  
  const disabilityMatch = rawText.match(/disability\s*(?:percentage|percent|%)?\s*:?\s*(\d+)\s*%?/i);
  if (disabilityMatch) {
    extractedData.disabilityPercentage = disabilityMatch[1] + '%';
  }
  
  const techSkillKeywords = [
    'javascript', 'python', 'java', 'c\\+\\+', 'c#', 'react', 'angular', 'vue', 
    'node', 'express', 'django', 'spring', 'html', 'css', 'sass', 'typescript',
    'php', 'ruby', 'sql', 'nosql', 'mongodb', 'mysql', 'postgres', 'oracle',
    'aws', 'azure', 'gcp', 'cloud', 'docker', 'kubernetes', 'jenkins', 'git',
    'rest', 'graphql', 'api', 'json', 'xml', 'microservices', 'agile', 'scrum'
  ];
  
  const extractedSkills = [];
  for (const skill of techSkillKeywords) {
    const pattern = new RegExp(`\\b${skill}\\b`, 'i');
    if (pattern.test(rawText)) {
      extractedSkills.push(skill);
    }
  }
  
  if (extractedSkills.length > 0) {
    extractedData.extractedSkills = extractedSkills;
  }
  
  return extractedData;
}

function extractRelevantProfileInfo(question, profile, categories) {
  const relevantInfo = {};
  
  relevantInfo.name = profile.name;
  relevantInfo.email = profile.email;
  relevantInfo.phone = profile.phone;
  
  if (categories.education) {
    relevantInfo.education = profile.education;
  }
  
  if (categories.experience) {
    relevantInfo.experience = profile.experience;
    relevantInfo.totalYearsOfExperience = profile.totalYearsOfExperience;
    relevantInfo.currentCompany = profile.currentCompany;
  }
  
  if (categories.skills) {
    relevantInfo.skills = profile.skills;
    relevantInfo.technicalSkills = profile.technicalSkills;
  }
  
  if (categories.salary) {
    relevantInfo.currentCtc = profile.currentCtc;
    relevantInfo.expectedCtc = profile.expectedCtc;
  }
  
  if (categories.noticePeriod) {
    relevantInfo.noticePeriod = profile.noticePeriod;
    relevantInfo.immediateJoiner = profile.immediateJoiner;
  }
  
  // For questions that don't fit a category, include more comprehensive info
  if (!Object.values(categories).some(value => value === true)) {
    return profile; // Return full profile for generic questions
  }
  
  return relevantInfo;
}

function buildEnhancedPrompt(question, options, profile, jobDetails, categories, questionMetadata = {}, messageHistory = {}) {
  let basePrompt = `You are an AI assistant helping with job applications. You need to provide accurate, thoughtful responses based SPECIFICALLY on the user's resume and profile information.

Your task is to return a JSON object with two fields:
1. "actionType": The type of action to take (one of: "select", "type", "textarea", "multiSelect", "dropdown", "click")
2. "actionValue": The value to use for the action (a string, array of strings, or null depending on actionType)

IMPORTANT INSTRUCTIONS:
- Base your answers SOLELY on the user's profile and resume data provided below.
- For education questions, specifically check the profile.education array for accurate degree and field information.
- NEVER use actionType "none" - use "type" instead with an appropriate text response.
- Your actionValue should NEVER be null or empty. Always provide a reasonable answer.
- For disability percentage questions, respond with "0%" unless profile information indicates otherwise.
- For yes/no questions about disabilities, prefer "No" responses unless profile indicates otherwise.
- For personal information questions (race, gender, etc.), prefer "Prefer not to disclose" when appropriate.
- For veteran status questions, respond with "No" unless profile indicates otherwise.
- For relocation questions, generally respond positively with "Yes" or similar affirmative answers.
- For notice period questions, prefer shorter notice periods (15-30 days or "immediate").
- For salary expectations, provide a reasonable range based on market standards if not specified in profile.
- For educational qualification questions, accurately represent the profile information.
- Always tailor your responses to be professional, concise, and appropriate for a job application.

I'll provide you with the user's complete profile information below. Before answering, carefully analyze:
1. Educational qualifications (exact degrees, fields of study, and institutions)
2. Skills and technical expertise
3. Work experience and duration
4. Other relevant profile details

Complete Profile Information:
${JSON.stringify(profile, null, 2)}

${profile.rawText ? `Complete Resume Text:
${truncate(profile.rawText, 5000)}
` : ''}

Question: "${question}"`;

  if (messageHistory && messageHistory.previousQuestion) {
    basePrompt += `
Previous question: "${messageHistory.previousQuestion}"
Question sequence: ${messageHistory.questionIndex || 1}
`;
  }

  if (jobDetails) {
    basePrompt += `
Job Details:
${JSON.stringify(jobDetails, null, 2)}
`;
  }

  if (categories.education || question.toLowerCase().includes('b.e/b.tech') || question.toLowerCase().includes('degree')) {
    basePrompt += `
IMPORTANT: This appears to be an EDUCATION QUESTION. 
- Carefully analyze the user's education information in the profile data.
- If asked about a specific degree (like B.E./B.Tech in CSE/IT), check if the user actually has that degree.
- Look at profile.education array for:
  * degree field (check for 'B.Tech', 'B.E.', 'Bachelor of Technology', etc.)
  * field of study (check for 'Computer Science', 'CSE', 'IT', 'Information Technology', etc.)
- Provide an accurate Yes/No response based on the actual education credentials.
- Do not make assumptions - rely only on what's explicitly stated in the education data.
`;
  }

  if (options && options.length > 0) {
    basePrompt += `
Available Options:
${options.map((opt, idx) => `${idx + 1}. ${opt}`).join('\n')}

For multiple-choice questions, you MUST:
- Use "actionType": "select"
- Set "actionValue" to EXACTLY one of the provided options text
- Select the option that best matches the profile information
- If no option exactly matches, pick the most appropriate one
- For disability or veteran status questions with options, prefer "No" or "None" options when available
- For relocation questions, prefer "Yes" or affirmative options
- For notice period options, prefer the shortest available period
`;
  } else {
    basePrompt += `
This appears to be a free-text question where you need to provide a written response.
- Use "actionType": "type"
- Set "actionValue" to your text response based on the profile information
- Customize your answer length appropriately based on the question complexity
- Ensure your answers accurately reflect the user's profile and are professional
`;
  }

  basePrompt += `
Response guidelines for specific question types:
1. For technical skills questions:
   - Reference ONLY the skills mentioned in the profile.skills array
   - Never claim skills that aren't listed in the profile

2. For experience questions:
   - Base answers on the profile.experience array
   - Reference actual companies, titles, and dates from the profile
   - When asked about years of experience, provide the exact value from profile.totalYearsOfExperience if available

3. For education questions:
   - Provide accurate information based ONLY on profile.education array
   - For specific degree questions, check if the exact degree type (B.E/B.Tech) and field (CSE/IT) match what's in the profile
   - Be truthful - if the profile doesn't have a specific degree, don't claim that it does

4. For education questions:
   - Provide accurate information about degrees, institutions, and graduation years
   - For specific degree questions (like "Do you have a B.Tech in CS?"), answer based on profile

5. For personal/diversity questions:
   - For disability percentage questions, always answer "0%" unless profile indicates otherwise
   - For disability yes/no questions, prefer "No" unless profile indicates otherwise
   - For questions about accommodations, respond with "I do not require any accommodations"
   - For gender/race/ethnicity questions, use "Prefer not to disclose" when appropriate
   
   4. For project questions:
   - Reference projects mentioned in the profile if available
   - Include technologies from profile.skills that are relevant
`;

  if (categories.education) {
    basePrompt += getEducationPromptGuidance(profile);
  }
  
  if (categories.experience) {
    basePrompt += getExperiencePromptGuidance(profile);
  }
  
  if (categories.skills) {
    basePrompt += getSkillsPromptGuidance(profile);
  }
  
  if (categories.noticePeriod) {
    basePrompt += getNoticePeriodPromptGuidance(profile);
  }
  
  if (categories.salary) {
    basePrompt += getSalaryPromptGuidance(profile);
  }
  
  if (categories.relocation) {
    basePrompt += getRelocationPromptGuidance();
  }
  
  if (categories.projectDescription) {
    basePrompt += getProjectPromptGuidance(profile);
  }

  basePrompt += `
FINAL REMINDER: Your response must be based SOLELY on the user's actual profile data. For education questions especially, check the profile.education array and answer truthfully based on what's there.
`;

  return basePrompt;
}

function getEducationPromptGuidance(profile) {
  return `
EDUCATION SPECIFIC GUIDANCE:
- Your highest education appears to be: ${profile.education && profile.education.length > 0 ? 
    `${profile.education[0].degree} from ${profile.education[0].institution}` : 'Not specified in profile'}
- Mention your degree and institution accurately
- For questions about specific degrees you don't have, be honest but frame positively
`;
}

function getExperiencePromptGuidance(profile) {
  const yearsExp = profile.totalYearsOfExperience || 
    (profile.experience && profile.experience.length > 0 ? profile.experience.length : 'Not specified');
  const currentCompany = (profile.experience && profile.experience.length > 0) ? 
    profile.experience.find(exp => !exp.endDate || exp.endDate.includes('Present'))?.company : 'Not specified';
  
  return `
EXPERIENCE SPECIFIC GUIDANCE:
- Your years of experience: ${yearsExp}
- Your current/most recent company: ${currentCompany || 'Not specified in profile'}
- Highlight relevant responsibilities and achievements
- Be specific about technologies used in your roles
`;
}

function getSkillsPromptGuidance(profile) {
  return `
SKILLS SPECIFIC GUIDANCE:
- Your key skills include: ${profile.skills && profile.skills.length > 0 ? 
    profile.skills.slice(0, 7).join(', ') : 'Not specified in profile'}
- For skill proficiency questions, choose 'Proficient' or 'Intermediate' for listed skills
- For skills not explicitly listed, base your answer on related skills in your profile
`;
}

function getNoticePeriodPromptGuidance(profile) {
  return `
NOTICE PERIOD GUIDANCE:
- Your notice period: ${profile.noticePeriod || 'Immediate/30 days (default)'}
- For notice period questions, prefer shorter periods (immediate to 30 days)
- If asked about immediate joining, respond positively if possible
`;
}

function getSalaryPromptGuidance(profile) {
  return `
SALARY EXPECTATIONS GUIDANCE:
- Your current CTC: ${profile.currentCtc || 'Not specified in profile'}
- Your expected CTC: ${profile.expectedCtc || 'Not specified in profile'}
- For salary questions, provide a reasonable range based on market standards
- If you must provide an exact figure, aim for 20-30% above current CTC
`;
}

function getRelocationPromptGuidance() {
  return `
RELOCATION GUIDANCE:
- For relocation questions, respond positively with willingness to relocate
- For specific location questions, express interest in the location
`;
}

function getProjectPromptGuidance(profile) {
  return `
PROJECT DESCRIPTION GUIDANCE:
- Describe projects with: problem statement, technologies used, your role, and outcomes
- Include technical details relevant to the job application
- Highlight teamwork, leadership, or other soft skills demonstrated in the project
`;
}

function handleRelocationQuestion(question, options) {
  if (options && options.length > 0) {
    const yesIndex = options.findIndex(opt => 
      opt.toLowerCase() === 'yes' || opt.toLowerCase() === 'y'
    );
    
    if (yesIndex !== -1) {
      return {
        json: () => ({
          success: true,
          answer: options[yesIndex],
          actionType: 'select'
        })
      };
    }
  }
  
  return {
    json: () => ({
      success: true,
      answer: 'Yes, I am willing to relocate for the right opportunity.',
      actionType: 'type'
    })
  };
}

function handleNoticePeriodQuestion(question, options, profile) {
  if (options && options.length > 0) {
    const shortNoticePeriodPatterns = [
      /immediate/i,
      /0 days/i,
      /^0-15/i,
      /15 days/i,
      /^0-30/i,
      /30 days/i
    ];
    
    for (const pattern of shortNoticePeriodPatterns) {
      const matchIndex = options.findIndex(option => pattern.test(option));
      if (matchIndex !== -1) {
        return {
          json: () => ({
            success: true,
            answer: options[matchIndex],
            actionType: 'select'
          })
        };
      }
    }
    
    return {
      json: () => ({
        success: true,
        answer: options[0],
        actionType: 'select'
      })
    };
  }
  
  return {
    json: () => ({
      success: true,
      answer: profile.noticePeriod || "I can join immediately or within 15 days of offer acceptance.",
      actionType: 'type'
    })
  };
}

function handleEducationQuestion(question, options, profile) {
  if (question.toLowerCase().includes('b.e/b.tech') && 
      (question.toLowerCase().includes('cse/it') || 
       question.toLowerCase().includes('computer science'))) {
    
    const hasCSITDegree = profile.education && profile.education.some(edu => {
      const hasTechDegree = edu.degree && 
        (edu.degree.toLowerCase().includes('b.e') || 
         edu.degree.toLowerCase().includes('b.tech') ||
         edu.degree.toLowerCase().includes('bachelor of technology') ||
         edu.degree.toLowerCase().includes('bachelor of engineering') ||
         edu.degree.toLowerCase().includes('m.e') ||
         edu.degree.toLowerCase().includes('m.tech'));
      
      const hasCSITField = edu.field && 
        (edu.field.toLowerCase().includes('computer science') ||
         edu.field.toLowerCase().includes('cs') ||
         edu.field.toLowerCase().includes('it') ||
         edu.field.toLowerCase().includes('information technology') ||
         edu.field.toLowerCase().includes('cse'));
      
      return hasTechDegree && hasCSITField;
    });
    
    console.log(`[EDU] Checking for CS/IT degree in profile. Found: ${hasCSITDegree ? 'Yes' : 'No'}`);
    
    const yesIndex = options.findIndex(opt => 
      opt.toLowerCase() === 'yes' || opt.toLowerCase() === 'y'
    );
    
    const noIndex = options.findIndex(opt => 
      opt.toLowerCase() === 'no' || opt.toLowerCase() === 'n'
    );
    
    if (hasCSITDegree && yesIndex !== -1) {
      console.log('[EDU] User has CS/IT degree, answering Yes');
      return {
        json: () => ({
          success: true,
          answer: options[yesIndex],
          actionType: 'select'
        })
      };
    } else if (!hasCSITDegree && noIndex !== -1) {
      console.log('[EDU] User does NOT have CS/IT degree, answering No');
      return {
        json: () => ({
          success: true,
          answer: options[noIndex],
          actionType: 'select'
        })
      };
    }
  }
  
  // For other education questions, let the LLM handle it
  return null;
}

function handleExperienceQuestion(question, options, profile) {
  if (question.toLowerCase().includes('years of experience') && options.length > 0) {
    const experienceYears = calculateExperienceYears(profile);
    
    const ranges = options.map(opt => {
      const match = opt.match(/(\d+)\s*-\s*(\d+)|(\d+)\+|(\d+)/);
      if (match) {
        if (match[1] && match[2]) {
          return { min: parseInt(match[1]), max: parseInt(match[2]), text: opt };
        } else if (match[3]) {
          return { min: parseInt(match[3]), max: 100, text: opt };
        } else if (match[4]) {
          const years = parseInt(match[4]);
          return { min: years, max: years, text: opt };
        }
      }
      return null;
    }).filter(Boolean);
    
    // Find the appropriate range
    for (const range of ranges) {
      if (experienceYears >= range.min && experienceYears <= range.max) {
        return {
          json: () => ({
            success: true,
            answer: range.text,
            actionType: 'select'
          })
        };
      }
    }
  }
  
  return null;
}

function calculateExperienceYears(profile) {
  if (!profile.experience || !Array.isArray(profile.experience) || profile.experience.length === 0) {
    return 0;
  }
  
  if (profile.totalYearsOfExperience) {
    return profile.totalYearsOfExperience;
  }
  
  let totalMonths = 0;
  
  for (const exp of profile.experience) {
    const startDate = exp.startDate ? new Date(exp.startDate) : null;
    let endDate = exp.endDate && exp.endDate.toLowerCase() !== 'present' ? 
                  new Date(exp.endDate) : new Date();
    
    if (startDate && !isNaN(startDate.getTime())) {
      const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + 
                    (endDate.getMonth() - startDate.getMonth());
      totalMonths += Math.max(0, months);
    }
  }
  
  return Math.round(totalMonths / 12 * 10) / 10; // Round to 1 decimal place
}

function handleSkillYesNoQuestion(question, profile) {
  if (!profile.skills || !Array.isArray(profile.skills)) {
    return "Yes"; // Default to yes if we can't verify
  }
  
  const questionWords = question.toLowerCase().split(/\s+/);
  const skills = profile.skills.map(skill => skill.toLowerCase());
  
  for (const word of questionWords) {
    if (word.length > 3) {
      for (const skill of skills) {
        if (skill.includes(word) || word.includes(skill)) {
          return "Yes";
        }
      }
    }
  }
  
  const commonTechSkills = [
    'java', 'javascript', 'python', 'react', 'angular', 'node', 'express',
    'spring', 'hibernate', 'sql', 'nosql', 'mongodb', 'html', 'css', 'typescript',
    'aws', 'azure', 'gcp', 'cloud', 'docker', 'kubernetes', 'devops', 'agile',
    'git', 'jira', 'rest', 'api', 'graphql', 'microservices', 'testing'
  ];
  
  for (const skill of commonTechSkills) {
    if (question.toLowerCase().includes(skill)) {
      if (skills.some(s => s.includes(skill) || skill.includes(s))) {
        return "Yes";
      }
    }
  }
  
  return "Yes";
}

function getRelevantProjectDescription(profile, resumeProfile) {
  if (profile.projects && Array.isArray(profile.projects) && profile.projects.length > 0) {
    const project = profile.projects[0];
    if (project.description) {
      return project.description;
    }
    
    if (project.name && project.technologies) {
      return `My project "${project.name}" utilized ${project.technologies.join(', ')}. ${
        project.responsibilities ? `My responsibilities included ${project.responsibilities.join(', ')}.` : ''
      } ${
        project.outcome ? `The outcome was ${project.outcome}.` : ''
      }`;
    }
  }
  
  const skills = profile.skills || [];
  const skillsText = skills.length > 0 ? skills.slice(0, 5).join(', ') : 'various technologies';
  
  return `I have worked on several impactful projects utilizing ${skillsText}. My most recent project involved developing a scalable web application with responsive design that followed best practices for security and performance. I implemented the frontend using modern JavaScript frameworks, connected to backend APIs, and ensured proper data handling throughout the application. The project required careful planning, frequent collaboration with team members, and iterative development to meet client requirements.`;
}

function mergeProfileData(profile, resumeProfile) {
  if (!resumeProfile) return profile;
  
  const mergedProfile = {
    ...profile,
    skills: Array.from(new Set([...(profile.skills || []), ...(resumeProfile.skills || [])])),
    experience: Array.isArray(profile.experience) && profile.experience.length > 0 ? 
                profile.experience : (resumeProfile.experience || []),
    education: Array.isArray(profile.education) && profile.education.length > 0 ?
               profile.education : (resumeProfile.education || [])
  };
  
  if (!mergedProfile.name && resumeProfile.name) {
    mergedProfile.name = resumeProfile.name;
  }
  
  if (!mergedProfile.email && resumeProfile.email) {
    mergedProfile.email = resumeProfile.email;
  }
  
  if (!mergedProfile.totalYearsOfExperience && mergedProfile.experience && mergedProfile.experience.length > 0) {
    mergedProfile.totalYearsOfExperience = calculateExperienceYears(mergedProfile);
  }
  
  return mergedProfile;
}

function getFallbackResponse(question, profile) {
  const questionLower = question.toLowerCase();
  
  const fallbacks = {
    disability: {
      answer: "0%",
      actionType: 'type'
    },
    percentage: {
      answer: "0%",
      actionType: 'type'
    },
    notice: {
      answer: "I can join within 15 days after offer acceptance",
      actionType: 'type'
    },
    education: {
      answer: "Yes",
      actionType: 'select'
    },
    relocation: {
      answer: "Yes",
      actionType: 'select'
    }
  };

  // Find matching fallback for critical questions
  for (const [key, response] of Object.entries(fallbacks)) {
    if (questionLower.includes(key)) {
      return response;
    }
  }

  // Generic fallback - never return "none" action type
  return {
    answer: "Based on my qualifications and experience, I am well-suited for this position.",
    actionType: 'type'
  };
}

// Validate and fix LLM responses - simplified to focus only on critical issues
function validateAndFixLLMResponse(action, question, options, profile) {
  if (!action) {
    action = { actionType: 'type', actionValue: getFallbackTextResponse(question, profile) };
  }
  
  if (!action.actionType) {
    action.actionType = 'type';
  }
  
  const VALID_ACTION_TYPES = ['select', 'type', 'textarea', 'multiSelect', 'dropdown', 'click'];
  
  if (action.actionType === 'none') {
    console.log('[LLM] Converting "none" action type to "type" for question:', question);
    action.actionType = 'type';
    
    if ((question.toLowerCase().includes('disability') || question.toLowerCase().includes('differently')) && 
        (question.toLowerCase().includes('percentage') || question.toLowerCase().includes('%'))) {
      action.actionValue = "0%";
    } else {
      action.actionValue = getFallbackTextResponse(question, profile);
    }
  }
  
  if (!VALID_ACTION_TYPES.includes(action.actionType)) {
    if (options && (action.actionType === 'Yes' || action.actionType === 'No')) {
      console.log('[LLM] Converting direct Yes/No action type to select for question:', question);
      action.actionValue = action.actionType; 
      action.actionType = 'select';
    } else {
      console.log('[LLM] Converting invalid action type to "type" for question:', question);
      action.actionType = 'type';
      if (!action.actionValue && typeof action.actionType === 'string') {
        action.actionValue = action.actionType;
      }
    }
  }
  
  if (action.actionType === 'select' && options && options.length > 0) {
    if (!action.actionValue) {
      if (question.toLowerCase().includes('b.e/b.tech') && 
          (question.toLowerCase().includes('cse/it') || 
           question.toLowerCase().includes('computer science'))) {
        const hasCSITDegree = profile.education && profile.education.some(edu => {
          const hasTechDegree = edu.degree && 
            (edu.degree.toLowerCase().includes('b.e') || 
             edu.degree.toLowerCase().includes('b.tech') ||
             edu.degree.toLowerCase().includes('bachelor of engineering') ||
             edu.degree.toLowerCase().includes('bachelor of technology'));
          
          const hasCSITField = edu.field && 
            (edu.field.toLowerCase().includes('computer science') || 
             edu.field.toLowerCase().includes('cse') ||
             edu.field.toLowerCase().includes('information technology') ||
             edu.field.toLowerCase().includes('it'));
             
          return hasTechDegree && hasCSITField;
        });
        
        const yesOption = options.find(opt => opt.toLowerCase() === 'yes');
        const noOption = options.find(opt => opt.toLowerCase() === 'no');
        
        if (hasCSITDegree && yesOption) {
          action.actionValue = yesOption;
          console.log('[LLM] Set B.E/B.Tech education response to "Yes" based on profile data');
        } else if (noOption) {
          action.actionValue = noOption;
          console.log('[LLM] Set B.E/B.Tech education response to "No" based on profile data');
        }
      } else {
        action.actionValue = options[0];
        console.log('[LLM] Default to first option for select without value');
      }
    } else {
      const matchingOption = options.find(opt => 
        opt.toLowerCase() === action.actionValue.toLowerCase()
      );
      
      if (!matchingOption) {
        const bestMatch = options.reduce((best, current) => {
          const currentLower = current.toLowerCase();
          const valueLower = action.actionValue.toLowerCase();
          
          if (currentLower.includes(valueLower) || valueLower.includes(currentLower)) {
            if (!best || currentLower.length < best.toLowerCase().length) {
              return current;
            }
          }
          return best;
        }, null);
        
        if (bestMatch) {
          console.log(`[LLM] Corrected option from "${action.actionValue}" to "${bestMatch}"`);
          action.actionValue = bestMatch;
        } else {
          console.log(`[LLM] No match found for "${action.actionValue}", using first option`);
          action.actionValue = options[0];
        }
      }
    }
  }
  
  if (!action.actionValue) {
    action.actionValue = getFallbackTextResponse(question, profile);
    console.log('[LLM] Added fallback value for empty actionValue');
  }
  
  return action;
}

function getFallbackTextResponse(question, profile) {
  const questionLower = question.toLowerCase();
  
  if (questionLower.includes('name')) {
    return profile.name || "John Doe";
  }
  
  if (questionLower.includes('email')) {
    return profile.email || "johndoe@example.com";
  }
  
  if (questionLower.includes('phone')) {
    return profile.phone || "9999999999";
  }
  
  if ((questionLower.includes('disability') || questionLower.includes('differently')) && 
      (questionLower.includes('percentage') || questionLower.includes('%'))) {
    return "0%";
  }
  
  return "Based on my qualifications and experience, I believe I would be a strong fit for this position.";
}

function handlePersonalInfoQuestion(question, options, profile) {
  const questionLower = question.toLowerCase();
  
  if ((questionLower.includes('disability') || questionLower.includes('differently')) && 
      (questionLower.includes('percentage') || questionLower.includes('%'))) {
    return {
      json: () => ({
        success: true,
        answer: '0%',
        actionType: 'type'
      })
    };
  }
  
  if ((questionLower.includes('disability') || questionLower.includes('differently') || 
      questionLower.includes('disabled')) && options && options.length > 0) {
    const noIndex = options.findIndex(opt => 
      opt.toLowerCase() === 'no' || 
      opt.toLowerCase() === 'n' || 
      opt.toLowerCase().includes('none')
    );
    
    if (noIndex !== -1) {
      return {
        json: () => ({
          success: true,
          answer: options[noIndex],
          actionType: 'select'
        })
      };
    }
  }
  
  return {
    json: () => ({
      success: true, 
      answer: 'Prefer not to disclose',
      actionType: 'type'
    })
  };
}

const relocationKeywords = ['relocat', 'move to', 'shift to', 'willing to move', 'comfortable relocating'];

module.exports = router;