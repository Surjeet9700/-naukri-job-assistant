const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');

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
      - Full name
      - Email address
      - Phone number
      - List of skills (as an array)
      - Professional experience (as an array of objects with company, title, dates, and description)
      - Education (as an array of objects with institution, degree, field, and dates)
      - Professional summary
      
      Here's the resume text:
      ${resumeText}
      
      Return ONLY a valid JSON object with these fields, no additional text.
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
      const profile = JSON.parse(jsonString);
      
      // Ensure required fields exist
      return {
        name: profile.name || profile.fullName || '',
        email: profile.email || '',
        phone: profile.phone || profile.phoneNumber || '',
        skills: profile.skills || [],
        experience: profile.experience || profile.workExperience || [],
        education: profile.education || [],
        summary: profile.summary || profile.professionalSummary || ''
      };
    } catch (error) {
      console.error('Error parsing JSON from Gemini response:', error);
      throw new Error('Failed to parse structured data from resume');
    }
  } catch (error) {
    console.error('Error with Gemini AI:', error);
    throw error;
  }
}

module.exports = router;