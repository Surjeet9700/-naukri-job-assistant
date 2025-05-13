const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { generateRawResumeText } = require('./parseResumeText');

// Initialize Google AI with API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'YOUR_API_KEY_HERE');

/**
 * Parse resume using Gemini AI
 * POST /api/parse-resume
 */
router.post('/parse-resume', async (req, res) => {
  try {
    const { fileName, fileType, content } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'No file content provided' });
    }
    
    // Convert base64 back to text if it's a PDF
    let resumeText;
    if (fileType.includes('pdf')) {
      // For MVP, we'll assume the content is already extracted text
      // In a production app, you'd use a PDF parsing library here
      resumeText = content;
    } else {
      // Assume it's plain text
      const buffer = Buffer.from(content, 'base64');
      resumeText = buffer.toString('utf-8');
    }
    
    // Generate structured profile from resume text using Gemini
    const profile = await parseResumeWithGemini(resumeText);
    
    // Add the raw text for LLM context
    profile.rawText = generateRawResumeText(profile);
    
    res.json({ profile });
  } catch (error) {
    console.error('Error parsing resume:', error);
    res.status(500).json({ error: 'Failed to parse resume' });
  }
});

/**
 * Parse resume text using Gemini AI
 */
async function parseResumeWithGemini(resumeText) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    
    const prompt = `
      Parse the following resume text into a structured JSON format. 
      Extract the following information:
      - name: Full name of the person
      - email: Email address
      - phone: Phone number
      - skills: Array of skills (technical and non-technical)
      - experience: Array of work experiences with company, title, startDate, endDate, and description
      - education: Array of education entries with institution, degree, field, startDate, and endDate
      - summary: Professional summary or objective
      - totalYearsOfExperience: Numerical value (can be approximate)
      - currentCompany: Current company name if working
      - noticePeriod: Notice period if mentioned
      - currentCtc: Current CTC/salary if mentioned
      - expectedCtc: Expected CTC/salary if mentioned
      
      Here's the resume text:
      ${resumeText.substring(0, 15000)}
      
      Return ONLY a valid JSON object with these fields, no additional text.
      Only include fields that you can confidently extract from the resume.
    `;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const responseText = response.text();
    
    // Extract JSON from the response
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                      responseText.match(/{[\s\S]*?}/);
                      
    const jsonString = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText;
    
    // Try to parse the JSON
    try {
      const extractedProfile = JSON.parse(jsonString);
      
      // Ensure required fields exist and standardize the structure
      const standardizedProfile = {
        name: extractedProfile.name || extractedProfile.fullName || '',
        email: extractedProfile.email || '',
        phone: extractedProfile.phone || extractedProfile.phoneNumber || '',
        skills: Array.isArray(extractedProfile.skills) ? extractedProfile.skills : [],
        experience: Array.isArray(extractedProfile.experience) ? extractedProfile.experience.map(exp => ({
          company: exp.company || '',
          title: exp.title || exp.position || '',
          startDate: exp.startDate || '',
          endDate: exp.endDate || 'Present',
          description: exp.description || '',
          isCurrent: exp.isCurrent || exp.current || (exp.endDate === 'Present' || !exp.endDate)
        })) : [],
        education: Array.isArray(extractedProfile.education) ? extractedProfile.education.map(edu => ({
          institution: edu.institution || edu.school || '',
          degree: edu.degree || '',
          field: edu.field || edu.fieldOfStudy || '',
          startDate: edu.startDate || '',
          endDate: edu.endDate || ''
        })) : [],
        summary: extractedProfile.summary || extractedProfile.professionalSummary || '',
        totalYearsOfExperience: extractedProfile.totalYearsOfExperience || null,
        currentCompany: extractedProfile.currentCompany || '',
        noticePeriod: extractedProfile.noticePeriod || '',
        currentCtc: extractedProfile.currentCtc || '',
        expectedCtc: extractedProfile.expectedCtc || ''
      };

      // If experience is present but totalYearsOfExperience isn't, calculate it
      if (!standardizedProfile.totalYearsOfExperience && standardizedProfile.experience.length > 0) {
        let totalMonths = 0;
        standardizedProfile.experience.forEach(exp => {
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
          standardizedProfile.totalYearsOfExperience = Math.round(totalMonths / 12 * 10) / 10;
        }
      }

      // If currentCompany isn't set but we have a current job, extract it
      if (!standardizedProfile.currentCompany && standardizedProfile.experience.length > 0) {
        const currentJob = standardizedProfile.experience.find(job => job.isCurrent || job.endDate === 'Present');
        if (currentJob) {
          standardizedProfile.currentCompany = currentJob.company;
        }
      }
      
      return standardizedProfile;
    } catch (error) {
      console.error('Error parsing JSON from Gemini response:', error);
      // Add fallback extraction similar to parseResumeText.js
      const fallbackProfile = {
        name: '',
        email: (resumeText.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+/) || [''])[0],
        phone: (resumeText.match(/(\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9})/) || [''])[0],
        summary: resumeText.substring(0, 200) + '...',
        skills: [],
        experience: [],
        education: [],
        rawText: resumeText
      };
      
      return fallbackProfile;
    }
  } catch (error) {
    console.error('Error with Gemini AI:', error);
    throw error;
  }
}

module.exports = router;