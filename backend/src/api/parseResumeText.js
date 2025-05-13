const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini/OpenAI with your API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * POST /api/parse-resume-text
 * Parse resume text using LLM and extract structured information
 */
router.post('/parse-resume-text', async (req, res) => {
  try {
    const { resumeText } = req.body;
    
    if (!resumeText) {
      return res.status(400).json({
        success: false,
        error: 'Resume text is required'
      });
    }
    
    // Limit text length to avoid token limits
    const limitedText = resumeText.substring(0, 15000);
    
    // Create prompt for resume parsing
    const prompt = `
You are a professional resume parser. Your task is to extract structured information from a resume.
Extract the following information in JSON format:
- name: Full name of the person
- email: Email address
- phone: Phone number
- summary: Professional summary or objective
- skills: Array of skills (technical and non-technical)
- experience: Array of work experiences with company, title, startDate, endDate, and description
- education: Array of education entries with institution, degree, field, startDate, and endDate
- totalYearsOfExperience: Numerical value (can be approximate)
- currentCompany: Current company name if working
- noticePeriod: Notice period if mentioned
- currentCtc: Current CTC/salary if mentioned
- expectedCtc: Expected CTC/salary if mentioned
- immediateJoiner: Boolean indicating if the person can join immediately

Resume Text:
${limitedText}

Return ONLY a valid JSON object with the structure described above. Don't include any other text.
Only include fields that you can confidently extract from the resume.
`;
    
    console.log('[LLM] Sending resume text for parsing');
    
    // Call Gemini with resume text
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const responseText = await result.response.text();
    
    // Extract JSON from response
    try {
      // Find JSON object in the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON object found in LLM response');
      }
      
      const profileData = JSON.parse(jsonMatch[0]);
      
      // Validate the extracted data
      const validatedProfile = validateProfileData(profileData);
      
      // Generate raw text format for the LLM context
      validatedProfile.rawText = generateRawResumeText(validatedProfile);
      
      return res.json({
        success: true,
        profile: validatedProfile
      });
    } catch (parseError) {
      console.error('Error parsing LLM JSON response:', parseError);
      console.log('Raw LLM response:', responseText);
      
      // Attempt to extract basic information using regex
      const fallbackProfile = extractBasicInfoFallback(resumeText);
      fallbackProfile.rawText = resumeText;
      
      return res.json({
        success: true,
        profile: fallbackProfile,
        warning: 'Failed to parse LLM response, using fallback extraction'
      });
    }
  } catch (error) {
    console.error('Error in /api/parse-resume-text:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to parse resume'
    });
  }
});

/**
 * Generate a formatted text representation of the resume for LLM context
 */
function generateRawResumeText(profile) {
  let text = `NAME: ${profile.name || ''}\n`;
  text += `EMAIL: ${profile.email || ''}\n`;
  text += `PHONE: ${profile.phone || ''}\n\n`;
  
  if (profile.summary) {
    text += `SUMMARY:\n${profile.summary}\n\n`;
  }
  
  if (profile.totalYearsOfExperience) {
    text += `EXPERIENCE: ${profile.totalYearsOfExperience} years\n\n`;
  }
  
  if (profile.currentCompany) {
    text += `CURRENT COMPANY: ${profile.currentCompany}\n\n`;
  }
  
  if (profile.noticePeriod) {
    text += `NOTICE PERIOD: ${profile.noticePeriod}\n\n`;
  }
  
  if (profile.currentCtc) {
    text += `CURRENT CTC: ${profile.currentCtc}\n\n`;
  }
  
  if (profile.expectedCtc) {
    text += `EXPECTED CTC: ${profile.expectedCtc}\n\n`;
  }
  
  if (profile.skills && profile.skills.length) {
    text += `SKILLS:\n${profile.skills.join(', ')}\n\n`;
  }
  
  if (profile.experience && profile.experience.length) {
    text += `EXPERIENCE:\n`;
    profile.experience.forEach(exp => {
      const current = exp.isCurrent ? "(Current)" : "";
      text += `- ${exp.title || ''} at ${exp.company || ''} ${current}\n`;
      text += `  ${exp.startDate || ''} to ${exp.endDate || 'Present'}\n`;
      if (exp.description) {
        text += `  ${exp.description}\n`;
      }
      text += `\n`;
    });
  }
  
  if (profile.education && profile.education.length) {
    text += `EDUCATION:\n`;
    profile.education.forEach(edu => {
      text += `- ${edu.degree || ''} in ${edu.field || ''} from ${edu.institution || ''}\n`;
      text += `  ${edu.startDate || ''} to ${edu.endDate || ''}\n`;
      if (edu.description) {
        text += `  ${edu.description}\n`;
      }
      text += `\n`;
    });
  }
  
  return text;
}

/**
 * Validate and fix profile data extracted from resume
 */
function validateProfileData(profileData) {
  // Ensure all required fields exist
  const validatedProfile = {
    name: profileData.name || 'Unknown',
    email: profileData.email || '',
    phone: profileData.phone || '',
    summary: profileData.summary || '',
    skills: ensureArray(profileData.skills),
    experience: ensureArray(profileData.experience),
    education: ensureArray(profileData.education),
    // Optional fields
    totalYearsOfExperience: profileData.totalYearsOfExperience || null,
    currentCompany: profileData.currentCompany || '',
    noticePeriod: profileData.noticePeriod || '',
    currentCtc: profileData.currentCtc || '',
    expectedCtc: profileData.expectedCtc || '',
    immediateJoiner: profileData.immediateJoiner || false
  };
  
  // Ensure experience items have required fields
  validatedProfile.experience = validatedProfile.experience.map(exp => ({
    company: exp.company || 'Unknown Company',
    title: exp.title || 'Unknown Position',
    startDate: exp.startDate || '',
    endDate: exp.endDate || 'Present',
    description: exp.description || '',
    isCurrent: exp.isCurrent || (exp.endDate === 'Present' || !exp.endDate)
  }));
  
  // Ensure education items have required fields
  validatedProfile.education = validatedProfile.education.map(edu => ({
    institution: edu.institution || 'Unknown Institution',
    degree: edu.degree || '',
    field: edu.field || '',
    startDate: edu.startDate || '',
    endDate: edu.endDate || ''
  }));
  
  // Calculate estimated experience from listed positions if not provided
  if (!validatedProfile.totalYearsOfExperience && validatedProfile.experience && validatedProfile.experience.length > 0) {
    let totalMonths = 0;
    validatedProfile.experience.forEach(exp => {
      if (exp.startDate) {
        const startYear = parseInt(exp.startDate.split(' ').pop());
        let endYear = new Date().getFullYear();
        if (exp.endDate && exp.endDate !== 'Present') {
          endYear = parseInt(exp.endDate.split(' ').pop());
        }
        if (!isNaN(startYear) && !isNaN(endYear)) {
          totalMonths += (endYear - startYear) * 12;
        }
      }
    });
    if (totalMonths > 0) {
      validatedProfile.totalYearsOfExperience = Math.round(totalMonths / 12 * 10) / 10;
    }
  }
  
  // Extract current company if not already provided
  if (!validatedProfile.currentCompany) {
    const currentJob = validatedProfile.experience.find(exp => exp.isCurrent || exp.endDate === 'Present');
    if (currentJob) {
      validatedProfile.currentCompany = currentJob.company;
    }
  }
  
  return validatedProfile;
}

/**
 * Ensure a value is an array
 */
function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Extract basic information from resume text using regex as a fallback
 */
function extractBasicInfoFallback(resumeText) {
  const fallbackProfile = {
    name: '',
    email: '',
    phone: '',
    summary: '',
    skills: [],
    experience: [],
    education: []
  };
  
  // Extract email
  const emailMatch = resumeText.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+/);
  if (emailMatch) {
    fallbackProfile.email = emailMatch[0];
  }
  
  // Extract phone
  const phoneMatch = resumeText.match(/(\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9})/);
  if (phoneMatch) {
    fallbackProfile.phone = phoneMatch[0];
  }
  
  // Extract a short summary
  fallbackProfile.summary = resumeText.substring(0, 200) + '...';
  
  // Try to extract some skills based on common keywords
  const commonSkills = [
    'java', 'python', 'javascript', 'typescript', 'react', 'angular', 'node', 
    'html', 'css', 'sql', 'aws', 'azure', 'gcp', 'docker', 'kubernetes', 
    'git', 'agile', 'scrum', 'project management', 'leadership', 'communication'
  ];
  
  fallbackProfile.skills = commonSkills.filter(skill => 
    resumeText.toLowerCase().includes(skill.toLowerCase())
  );
  
  // Try to extract notice period if mentioned
  const noticePeriodMatch = resumeText.match(/notice\s*period[:\s]*(\d+\s*(?:days|months|weeks))/i);
  if (noticePeriodMatch) {
    fallbackProfile.noticePeriod = noticePeriodMatch[1];
  }
  
  // Try to extract CTC information
  const ctcMatch = resumeText.match(/(?:current|present)\s*ctc[:\s]*(?:Rs\.?|INR)?\s*([\d,\.]+)\s*(?:lpa|lakhs|lacs|L)/i);
  if (ctcMatch) {
    fallbackProfile.currentCtc = ctcMatch[1];
  }
  
  return fallbackProfile;
}

// Export the raw text generator function separately so it can be used by other modules
module.exports = {
  router,
  generateRawResumeText
}; 