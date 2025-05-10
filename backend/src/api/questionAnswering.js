const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Google AI with API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Generate answers to application questions using Gemini AI
 * POST /api/answer-question
 */
router.post('/answer-question', async (req, res) => {
  try {
    const { question, profile, jobDetails, questionFormat, options } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    console.log('Received question:', question);
    console.log('Question format:', questionFormat || 'TEXT_INPUT');

    if (options && options.length) {
      console.log('Options:', options);
    }

    // SPECIAL CASE: B.E/B.Tech Education Question with CSE/IT Stream
    // Add this fast-path handler before any other processing to ensure it always works
    const questionLower = question.toLowerCase();
    if ((questionLower.includes('b.e/b.tech') || questionLower.includes('b.tech') || questionLower.includes('b.e')) && 
        (questionLower.includes('cse/it') || questionLower.includes('cse') || questionLower.includes('computer science')) &&
        options && options.length === 2 && 
        options[0].toLowerCase() === 'yes' && options[1].toLowerCase() === 'no') {
      
      console.log('SPECIAL HANDLER: Detected B.E/B.Tech with CSE/IT education question');
      console.log('Checking resume for B.Tech/CSE education...');
      
      // Fast check for B.Tech in Computer Science in the profile
      let hasTechDegree = false;
      
      // Check education structure if available
      if (profile.education && profile.education.length > 0) {
        hasTechDegree = profile.education.some(edu => {
          const degree = (edu.degree || '').toLowerCase();
          const field = (edu.field || '').toLowerCase();
          
          return (degree.includes('b.tech') || degree.includes('bachelor of technology') || degree.includes('b.e')) && 
                 (field.includes('computer') || field.includes('cs') || field.includes('information tech') || field.includes('it'));
        });
        
        console.log('Education structure check result:', hasTechDegree ? 'Found B.Tech in CS/IT' : 'No B.Tech in CS/IT found in education structure');
      }
      
      // Fallback to full text search in the profile
      if (!hasTechDegree) {
        const resumeText = JSON.stringify(profile).toLowerCase();
        // Use a regex to match "b.tech" and "computer science" or "cse" or "it" in the same sentence or nearby
        const btechPattern = /b[.\s-]*tech/;
        const csePattern = /(computer\s*science(\s*&\s*engineering)?|cse|it|information\s*technology)/;
        // Find all lines or sentences containing "b.tech"
        const lines = resumeText.split(/[\n.]+/);
        hasTechDegree = lines.some(line => {
          return btechPattern.test(line) && csePattern.test(line);
        });
        // If not found in lines, try a global regex for proximity (within 50 chars)
        if (!hasTechDegree) {
          hasTechDegree = /b[.\s-]*tech.{0,50}(computer\s*science(\s*&\s*engineering)?|cse|it|information\s*technology)/.test(resumeText);
        }
        console.log('Full resume text search result:', hasTechDegree ? 'Found B.Tech in CS/IT keywords' : 'No B.Tech in CS/IT keywords found');
      }
      
      // Override for testing if needed
      // hasTechDegree = true;  // Uncomment this line to force "Yes" for testing
      
      const techAnswer = hasTechDegree ? 'Yes' : 'No';
      console.log('Special handler returning answer for B.E/B.Tech question:', techAnswer);
      
      return res.json({ answer: techAnswer });
    }

    // Analyze job context to ensure appropriate answers
    const jobContext = await analyzeJobContext(jobDetails, profile);
    console.log('Job context analysis:', jobContext);

    // Generate answer based on question format with job context awareness
    let answer;
    // MODIFICATION 1: Route NAUKRI_RADIO_BUTTONS to generateMultipleChoiceAnswer
    if (
        questionFormat === 'MULTIPLE_CHOICE' ||
        questionFormat === 'RADIO_BUTTONS' ||
        questionFormat === 'NAUKRI_RADIO_BUTTONS' // Added this condition
    ) {
      answer = await generateMultipleChoiceAnswer(question, options, profile, jobDetails, jobContext);
    } else { // For TEXT_INPUT or other future types where options are not predefined
      answer = await generateAnswerWithGemini(question, profile, jobDetails, jobContext);
    }

    if (answer === null || answer === undefined || answer === "UNCERTAIN") { 
      if (questionFormat === 'MULTIPLE_CHOICE' || questionFormat === 'RADIO_BUTTONS' || questionFormat === 'NAUKRI_RADIO_BUTTONS') {
        console.log('Unable to confidently select an option for multiple choice/radio button.');
        return res.status(400).json({ error: 'Unable to generate a confident answer from the given options' });
      }
      // If it was a text input that failed, we might still try a generic response or error out.
      // For now, erroring out is safer.
      console.log('Unable to generate a confident answer via Gemini text generation.');
      return res.status(400).json({ error: 'Unable to generate a confident answer' });
    }

    console.log('Generated answer:', answer);
    res.json({ answer });
  } catch (error) {
    console.error('Error generating answer:', error);
    res.status(500).json({
      error: 'Failed to generate answer',
      details: error.message
    });
  }
});

/**
 * Analyze job details to create intelligent context for answer generation
 * @param {Object} jobDetails - The job details
 * @param {Object} profile - The candidate profile
 * @returns {Object} - Job context object with insights
 */
async function analyzeJobContext(jobDetails, profile) {
  try {
    // Default context structure
    const jobContext = {
      experienceLevel: 'mid-level', // default assumption: mid-level (2-5 years)
      isFresherRole: false,
      isSeniorRole: false,
      salaryRange: null,
      skills: [],
      experience: {
        min: 2,
        max: 5,
        unit: 'years'
      },
      industryBenchmarks: {
        fresher: {
          minCTC: '3 LPA',
          maxCTC: '8 LPA',
          typical: '5 LPA'
        },
        midLevel: {
          minCTC: '8 LPA',
          maxCTC: '20 LPA',
          typical: '12 LPA'
        },
        senior: {
          minCTC: '18 LPA',
          maxCTC: '45 LPA',
          typical: '30 LPA'
        }
      },
      profileJobAlignment: 'medium' // default assumption
    };

    // Extract information from job description if available
    if (jobDetails && jobDetails.description) {
      const description = jobDetails.description.toLowerCase();

      // Detect experience level from job description
      if (
        description.includes('fresher') ||
        description.includes('entry level') ||
        description.includes('0-1 year') ||
        description.includes('0-2 year') ||
        description.includes('no experience') ||
        description.includes('recent graduate')
      ) {
        jobContext.experienceLevel = 'entry-level';
        jobContext.isFresherRole = true;
        jobContext.experience = { min: 0, max: 1, unit: 'years' };
      }
      else if (
        description.includes('senior') ||
        description.includes('lead') ||
        description.includes('architect') ||
        description.includes('5+ years') ||
        description.includes('7+ years') ||
        description.includes('10+ years')
      ) {
        jobContext.experienceLevel = 'senior';
        jobContext.isSeniorRole = true;
        jobContext.experience = { min: 5, max: 10, unit: 'years' }; // Default, can be refined
        // Try to parse specific years for senior roles more accurately
        const seniorYearMatch = description.match(/(\d+)\+\s*years/);
        if (seniorYearMatch && parseInt(seniorYearMatch[1]) >=5) {
            jobContext.experience = { min: parseInt(seniorYearMatch[1]), max: parseInt(seniorYearMatch[1]) + 5, unit: 'years'};
        }

      }

      // Extract salary information if present
      const salaryMatches = description.match(/(\d+(\.\d+)?)\s*(lpa|lakhs|lac|l)/gi);
      if (salaryMatches && salaryMatches.length > 0) {
        // Parse salary figures
        const figures = salaryMatches.map(match => {
          const num = parseFloat(match.match(/\d+(\.\d+)?/)[0]);
          return num;
        }).filter(num => !isNaN(num)).sort((a, b) => a - b);

        if (figures.length >= 2) {
          jobContext.salaryRange = {
            min: figures[0],
            max: figures[figures.length - 1],
            unit: 'LPA'
          };
        } else if (figures.length === 1) {
          const figure = figures[0];
          // Heuristic: if a single number is mentioned, it could be max for fresher/mid, or min for senior
          if (jobContext.isFresherRole) {
            jobContext.salaryRange = { min: Math.max(1, figure * 0.7), max: figure, unit: 'LPA' };
          } else if (jobContext.isSeniorRole) {
             jobContext.salaryRange = { min: figure, max: figure * 1.5, unit: 'LPA' };
          } else { // Mid-level
             if (figure < 10) { // Potentially a minimum
                jobContext.salaryRange = { min: figure, max: figure * 1.8, unit: 'LPA' };
             } else { // Potentially a maximum
                jobContext.salaryRange = { min: figure * 0.6, max: figure, unit: 'LPA' };
             }
          }
        }
      }

      // Extract required skills
      if (jobDetails.skills && jobDetails.skills.length > 0) {
        jobContext.skills = jobDetails.skills;
      } else {
        // Try to extract skills from the description
        const commonSkills = [
          'javascript', 'react', 'angular', 'vue', 'node', 'python', 'java',
          'c++', 'c#', '.net', 'php', 'ruby', 'go', 'rust', 'typescript',
          'sql', 'nosql', 'mongodb', 'mysql', 'postgresql', 'oracle',
          'aws', 'azure', 'gcp', 'devops', 'ci/cd', 'docker', 'kubernetes',
          'html', 'css', 'spring boot', 'django', 'flask', 'swift', 'kotlin'
        ];

        jobContext.skills = commonSkills.filter(skill =>
          new RegExp(`\\b${skill}\\b`, 'i').test(description) // Use word boundary for better matching
        );
      }
    }

    // Evaluate alignment between profile and job
    if (profile && jobContext) { // Ensure profile is not null/undefined
      jobContext.profileJobAlignment = evaluateProfileJobAlignment(profile, jobContext);
    } else {
      jobContext.profileJobAlignment = 'unknown'; // Or 'medium' if profile is optional
    }

    return jobContext;
  } catch (error) {
    console.error('Error analyzing job context:', error);
    // Return default context in case of error
    return {
      experienceLevel: 'mid-level',
      isFresherRole: false,
      isSeniorRole: false,
      salaryRange: null,
      skills: [],
      experience: {min: 2, max: 5, unit: 'years'},
      industryBenchmarks: { /* ... as defined ... */ },
      profileJobAlignment: 'medium'
    };
  }
}

/**
 * Evaluate how well the candidate profile aligns with the job context
 */
function evaluateProfileJobAlignment(profile, jobContext) {
  if (!profile) return 'unknown'; // Guard against null profile

  let alignmentScore = 0;
  // const maxScore = 100; // Not explicitly used for capping, but good for reference

  // Check experience alignment
  const profileExperienceYears = profile.totalExperienceYears || 0; // Assuming profile has a numeric totalExperienceYears

  if (jobContext.isFresherRole && profileExperienceYears <= jobContext.experience.max) { // Max for fresher usually 1 or 2
    alignmentScore += 30;
  } else if (jobContext.isSeniorRole && profileExperienceYears >= jobContext.experience.min) { // Min for senior usually 5+
    alignmentScore += 30;
  } else if (!jobContext.isFresherRole && !jobContext.isSeniorRole &&
             profileExperienceYears >= jobContext.experience.min &&
             profileExperienceYears <= jobContext.experience.max) { // Mid-level
    alignmentScore += 30;
  } else if (profileExperienceYears > 0 && (jobContext.experience.min === 0 && jobContext.experience.max === 0)) {
    // Job doesn't specify experience, any profile experience is a mild plus
    alignmentScore += 15;
  }
  else {
    alignmentScore += 5; // Some points even for mismatch, to avoid zero scores easily
  }

  // Check skills alignment
  if (jobContext.skills && jobContext.skills.length > 0 && profile.skills && profile.skills.length > 0) {
    const matchingSkills = jobContext.skills.filter(jobSkill =>
      profile.skills.some(profileSkill =>
        profileSkill.toLowerCase().includes(jobSkill.toLowerCase()) ||
        jobSkill.toLowerCase().includes(profileSkill.toLowerCase()) // Allow partial match like "node" in "nodejs"
      )
    );
    const skillAlignmentScore = Math.min(30, Math.floor((matchingSkills.length / jobContext.skills.length) * 30));
    alignmentScore += skillAlignmentScore;
  } else if (jobContext.skills && jobContext.skills.length > 0 && (!profile.skills || profile.skills.length === 0)) {
    alignmentScore += 5; // Profile has no skills listed but job requires them
  } else {
    alignmentScore += 15; // No job skills listed or no profile skills, neutral score
  }

  // Check education alignment (simple check)
  if (profile.education && profile.education.length > 0) {
    alignmentScore += 20; // Base points for having education listed
    // Optional: More specific education check against job requirements if available
  } else {
    alignmentScore += 5;
  }

  // Add some points for having a complete profile summary
  if (profile.summary && profile.summary.length > 50) { // Check for a reasonable summary length
    alignmentScore += 20;
  } else {
    alignmentScore += 10;
  }

  // Determine alignment category
  if (alignmentScore >= 70) {
    return 'high';
  } else if (alignmentScore >= 40) {
    return 'medium';
  } else {
    return 'low';
  }
}


/**
 * Generate answer for multiple choice questions by selecting the best option
 * with awareness of job context
 */
async function generateMultipleChoiceAnswer(question, options, profile, jobDetails, jobContext) {
  try {
    const questionLower = question.toLowerCase();

    // Handle notice period questions
    if (questionLower.includes('notice period') || questionLower.includes('when can you join')) {
      const noticeAnswer = handleNoticePeriodQuestion(options, profile);
      if (noticeAnswer) return noticeAnswer;
      // If null, will fall through to LLM
    }

    // Handle location questions
    // MODIFICATION 2: Pass `question` to `handleLocationQuestion`
    if (questionLower.includes('location') || questionLower.includes('city') || questionLower.includes('relocate') || questionLower.includes('based')) {
      const locationAnswer = handleLocationQuestion(options, profile, question); // Pass question here
      if (locationAnswer) return locationAnswer;
      // If null, will fall through to LLM
    }

    // Special case handling for salary/compensation questions with job context awareness
    if (questionLower.includes('ctc') || questionLower.includes('salary') || questionLower.includes('compensation')) {
        const salaryOption = handleMultipleChoiceSalaryQuestion(options, profile, jobContext);
        if (salaryOption) return salaryOption;
        // If null, fall through to LLM
    }

    // For other questions or if specific handlers return null, use Gemini to select the best option
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' }); 
    const context = buildProfileContext(profile, jobDetails);

    // Specific handling for Yes/No questions related to qualifications based on profile
    if (options.length === 2 && options.map(o => o.toLowerCase()).includes('yes') && options.map(o => o.toLowerCase()).includes('no')) {
        if (questionLower.includes('b.e') || questionLower.includes('b.tech') ||
            questionLower.includes('m.e') || questionLower.includes('m.tech') ||
            questionLower.includes('bachelor') || questionLower.includes('master') ||
            (questionLower.includes('education') && (questionLower.includes('cse') || questionLower.includes('it') || questionLower.includes('computer')) )||
            (questionLower.includes('degree') && (questionLower.includes('cse') || questionLower.includes('it') || questionLower.includes('computer')) )) {

            const hasRelevantDegree = profile?.education?.some(edu => {
                const degreeLower = edu.degree?.toLowerCase() || '';
                const fieldLower = edu.field?.toLowerCase() || '';
                return (
                    degreeLower.includes('b.tech') || degreeLower.includes('b.e') ||
                    degreeLower.includes('m.tech') || degreeLower.includes('m.e') || degreeLower.includes('bachelor') || degreeLower.includes('master')
                ) && (
                    fieldLower.includes('computer science') || fieldLower.includes('cse') ||
                    fieldLower.includes('information technology') || fieldLower.includes('it') ||
                    // Check if question keywords are in degree/field
                    (questionLower.includes('cse') && (degreeLower.includes('cse') || fieldLower.includes('cse'))) ||
                    (questionLower.includes('it') && (degreeLower.includes('it') || fieldLower.includes('it')))
                );
            });
            if (hasRelevantDegree !== undefined) return hasRelevantDegree ? 'Yes' : 'No';
        }
    }


    const prompt = `
      You are an AI assistant helping a job seeker choose the best option for a job application question.
      Your goal is to select the most appropriate and truthful answer based on the candidate's profile and the job context.

      Candidate Profile:
      - Name: ${context.candidateProfile.name}
      - Location: ${context.candidateProfile.location}
      - Skills: ${context.candidateProfile.skills.join(', ') || 'Not specified'}
      - Summary: ${context.candidateProfile.summary || 'Not specified'}
      ${context.candidateProfile.experience && context.candidateProfile.experience.length > 0 ? `
      - Experience:
        ${context.candidateProfile.experience.map(exp =>
          `* ${exp.title} at ${exp.company} (${exp.startDate} - ${exp.endDate || 'Present'})`
        ).join('\n        ')}` : '- Experience: Not specified'}
      ${context.candidateProfile.education && context.candidateProfile.education.length > 0 ? `
      - Education:
        ${context.candidateProfile.education.map(edu =>
          `* ${edu.degree || 'N/A'} in ${edu.field || 'N/A'} from ${edu.institution || 'N/A'} (${edu.year || 'N/A'})`
        ).join('\n        ')}` : '- Education: Not specified'}
      - Current CTC: ${context.candidateProfile.currentCtc || 'Not specified'}
      - Expected CTC: ${context.candidateProfile.expectedCtc || 'Not specified'}
      - Notice Period: ${context.candidateProfile.noticePeriod || 'Not specified'}

      Job Context:
      - Position: ${context.jobContext.title || 'Not specified'}
      - Company: ${context.jobContext.company || 'Not specified'}
      - Description: ${context.jobContext.description ? context.jobContext.description.substring(0, 300) + '...' : 'Not specified'}
      - Required Skills: ${jobContext.skills ? jobContext.skills.join(', ') : 'Not specified'}
      - Experience Level: ${jobContext.experienceLevel || 'Not specified'}
      - Is Fresher Role: ${jobContext.isFresherRole}
      - Is Senior Role: ${jobContext.isSeniorRole}

      Question: "${question}"

      Available Options:
      ${options.map((opt, idx) => `${idx + 1}. ${opt}`).join('\n')}

      Instructions:
      1. Analyze the question, the candidate's profile, and the job context carefully.
      2. Choose the SINGLE BEST and MOST TRUTHFUL option from the available choices.
      3. If the question is about willingness (e.g., to relocate, to work in shifts) and the profile doesn't specify, assume willingness if the job requires it or if it's a general positive trait, unless an option explicitly allows expressing non-willingness based on profile.
      4. For salary/CTC, pick an option that aligns with the profile's current/expected CTC and the job's experience level and benchmarks. If the candidate's expectation is known and available as an option, prefer that.
      5. If you cannot confidently determine the best option, or if none of the options seem appropriate or truthful based on the provided context, reply with the exact string "UNCERTAIN".
      6. Return ONLY the exact text of the selected option. Do not add any other commentary or explanation.

      Your Answer (exact text of the selected option or "UNCERTAIN"):
    `;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1, // Lower for more deterministic choice
        topK: 1,
        topP: 0.95, // Slightly higher topP can allow for more nuance if topK is also adjusted
        maxOutputTokens: 80, // Options are usually short
      }
    });

    const response = await result.response;
    let answer = response.text().trim();

    if (answer === "UNCERTAIN" || !options.map(o => o.toLowerCase()).includes(answer.toLowerCase())) {
      console.log('LLM could not confidently select an option or returned an invalid option. LLM Answer:', answer);
      // Try to find the closest match if the LLM slightly rephrased.
      const bestMatch = options.find(opt => answer.toLowerCase().includes(opt.toLowerCase()) || opt.toLowerCase().includes(answer.toLowerCase()));
      if(bestMatch) {
        console.log("Found close match:", bestMatch);
        return bestMatch;
      }
      return null; // Indicate failure to select a valid option
    }

    // Return the exact option text for precise matching by the calling function/frontend
    const matchingOption = options.find(opt => opt.toLowerCase() === answer.toLowerCase());
    return matchingOption || answer; // Fallback to raw answer if exact match fails (should be rare)

  } catch (error) {
    console.error('Error generating multiple choice answer with LLM:', error);
    return null; // Indicate failure
  }
}

function handleMultipleChoiceSalaryQuestion(options, profile, jobContext) {
    const profileExpectedCtc = profile?.expectedCtc; // e.g., "10 LPA", "10-12 LPA"
    const profileCurrentCtc = profile?.currentCtc; // e.g., "8 LPA"

    let expectedMin = null;
    let expectedMax = null;

    if (profileExpectedCtc) {
        const ctcStr = String(profileExpectedCtc).toLowerCase().replace(/lpa|lakhs|l/g, '').trim();
        const parts = ctcStr.split('-').map(p => parseFloat(p.trim()));
        if (parts.length === 1 && !isNaN(parts[0])) {
            expectedMin = parts[0];
            expectedMax = parts[0] * 1.2; // Assume a +20% range if single value
        } else if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            expectedMin = parts[0];
            expectedMax = parts[1];
        }
    }

    // If no profile expected CTC, use job context benchmarks
    if (!expectedMin) {
        if (jobContext.isFresherRole) {
            expectedMin = parseFloat(jobContext.industryBenchmarks.fresher.minCTC);
            expectedMax = parseFloat(jobContext.industryBenchmarks.fresher.maxCTC);
        } else if (jobContext.isSeniorRole) {
            expectedMin = parseFloat(jobContext.industryBenchmarks.senior.minCTC);
            expectedMax = parseFloat(jobContext.industryBenchmarks.senior.maxCTC);
        } else { // Mid-level
            expectedMin = parseFloat(jobContext.industryBenchmarks.midLevel.minCTC);
            expectedMax = parseFloat(jobContext.industryBenchmarks.midLevel.maxCTC);
        }
    }

    let bestOption = null;
    let closestDiff = Infinity;

    for (const option of options) {
        const optionLower = option.toLowerCase();
        // Try to parse a numeric value or range from the option
        // Examples: "5-8 LPA", "upto 10 LPA", "15 LPA", "Negotiable", "As per company standards"
        const numbers = optionLower.match(/\d+(\.\d+)?/g)?.map(Number);

        if (numbers && numbers.length > 0) {
            let optMin, optMax;
            if (optionLower.includes('upto') || optionLower.includes('up to') || optionLower.includes('below')) {
                optMin = numbers[0] * 0.7; // Assume a lower bound
                optMax = numbers[0];
            } else if (optionLower.includes('above') || optionLower.includes('+')) {
                optMin = numbers[0];
                optMax = numbers[0] * 1.5; // Assume an upper bound
            } else if (numbers.length === 1) {
                optMin = numbers[0];
                optMax = numbers[0];
            } else if (numbers.length >= 2) {
                optMin = Math.min(...numbers);
                optMax = Math.max(...numbers);
            }

            if (optMin !== undefined && optMax !== undefined) {
                // Check if candidate's expectation falls within this option's range
                if (expectedMin >= optMin && expectedMax <= optMax) {
                    return option; // Perfect match
                }
                // If not a perfect match, find the closest option to the candidate's expectedMin
                const diff = Math.abs(optMin - expectedMin) + Math.abs(optMax - expectedMax);
                if (diff < closestDiff) {
                    closestDiff = diff;
                    bestOption = option;
                }
            }
        } else if (optionLower.includes('negotiable') || optionLower.includes('company standards') || optionLower.includes('market rate')) {
            if (!bestOption) bestOption = option; // Prefer numeric, but take this if no numeric match
        }
    }
    return bestOption; // Could be null if no suitable option found
}


/**
 * Generate answer using Gemini with intelligent job context awareness
 */
async function generateAnswerWithGemini(question, profile, jobDetails, jobContext) {
  try {
    // Special case handling for simple radio button questions
    const questionLower = question.toLowerCase();
    const questionFormat = detectQuestionFormat(question);
    
    // For radio button questions with yes/no options, provide short answers
    if (questionFormat === 'NAUKRI_RADIO_BUTTONS' || questionFormat === 'RADIO_BUTTONS') {
      // Check if this is a yes/no question with simple options
      const containsYesNoOptions = hasYesNoOptions(question);
      
      if (containsYesNoOptions) {
        console.log('Detected yes/no radio button question, using simple answer format');
        
        // For education/qualification questions about B.E/B.Tech/M.E/M.Tech with CSE/IT stream
        if ((questionLower.includes('b.e') || questionLower.includes('b.tech') || 
            questionLower.includes('m.e') || questionLower.includes('m.tech')) &&
            (questionLower.includes('cse') || questionLower.includes('it') || 
             questionLower.includes('computer') || questionLower.includes('information tech'))) {
          
          console.log('Detected education qualification question for CSE/IT stream');
          
          // Check profile's education information
          if (profile.education && profile.education.length > 0) {
            // Log education details for debugging
            console.log('Education entries in profile:', profile.education.length);
            profile.education.forEach((edu, index) => {
              console.log(`Education #${index + 1}:`, 
                         `Degree: ${edu.degree || 'N/A'}, `,
                         `Field: ${edu.field || 'N/A'}, `,
                         `Institution: ${edu.institution || 'N/A'}`);
            });
            
            // Check for CS/IT related degree in any of the education entries
            const hasCSITDegree = profile.education.some(edu => {
              // Normalize education data for better matching
              const degree = (edu.degree || '').toLowerCase();
              const field = (edu.field || '').toLowerCase();
              
              // Check if degree contains B.E/B.Tech/M.E/M.Tech
              const hasTechDegree = degree.includes('b.tech') || 
                                   degree.includes('b.e') || 
                                   degree.includes('m.tech') || 
                                   degree.includes('m.e') ||
                                   degree.includes('bachelor of technology') ||
                                   degree.includes('bachelor of engineering') ||
                                   degree.includes('master of technology') ||
                                   degree.includes('master of engineering') ||
                                   degree.includes('engineering') ||
                                   degree.includes('technology');
              
              // Check if field is related to CSE or IT
              const hasCSITField = field.includes('computer') || 
                                  field.includes('comput') ||
                                  field.includes('cs') || 
                                  field.includes('cse') || 
                                  field.includes('information tech') || 
                                  field.includes('it') ||
                                  field.includes('software');
              
              // Also check if degree directly mentions computer science
              const degreeContainsCSIT = degree.includes('computer') || 
                                        degree.includes('cs') || 
                                        degree.includes('information tech') || 
                                        degree.includes('it');
              
              const result = hasTechDegree && (hasCSITField || degreeContainsCSIT);
              console.log(`Education match check: Tech Degree: ${hasTechDegree}, CS/IT Field: ${hasCSITField}, Degree contains CS/IT: ${degreeContainsCSIT}, Final match: ${result}`);
              
              return result;
            });
            
            // Special case for resume text directly mentioning B.Tech in Computer Science
            const resumeSummary = profile.summary || '';
            const resumeText = JSON.stringify(profile); // Convert entire profile to searchable text
            const resumeContainsCSE = resumeText.toLowerCase().includes('computer science') || 
                                     resumeText.toLowerCase().includes('cse') ||
                                     resumeText.toLowerCase().includes('information technology');
            
            const resumeContainsBTech = resumeText.toLowerCase().includes('b.tech') || 
                                       resumeText.toLowerCase().includes('bachelor of technology') ||
                                       resumeText.toLowerCase().includes('b tech');
            
            const resumeMatch = resumeContainsBTech && resumeContainsCSE;
            console.log(`Resume text match check: Contains B.Tech: ${resumeContainsBTech}, Contains CSE/IT: ${resumeContainsCSE}, Match: ${resumeMatch}`);
            
            // Make the final decision based on both profile structure and resume text
            const finalAnswer = hasCSITDegree || resumeMatch ? 'Yes' : 'No';
            console.log(`Final education qualification answer: ${finalAnswer} (hasCSITDegree: ${hasCSITDegree}, resumeMatch: ${resumeMatch})`);
            
            return finalAnswer;
          } else {
            console.log('No structured education data found in profile, checking resume text');
            
            // If no structured education data, check the entire profile for relevant keywords
            const resumeText = JSON.stringify(profile).toLowerCase();
            const hasBTechKeywords = resumeText.includes('b.tech') || 
                                    resumeText.includes('bachelor of technology') || 
                                    resumeText.includes('btech');
            const hasCSEKeywords = resumeText.includes('computer science') || 
                                  resumeText.includes('cse') || 
                                  resumeText.includes('computer engineering');
            
            // Check if resume mentions both B.Tech and Computer Science
            if (hasBTechKeywords && hasCSEKeywords) {
              console.log('Resume text indicates B.Tech in Computer Science - answering Yes');
              return 'Yes';
            } else {
              // Default case - if we can't confirm, better to say No
              console.log('Could not confirm B.Tech in CS/IT from resume text - answering No');
              return 'No';
            }
          }
        }
        
        // For other education/qualification questions
        else if (questionLower.includes('education') || questionLower.includes('degree') || 
                questionLower.includes('graduate')) {
          // Check if profile has relevant education
          const hasRelevantDegree = profile?.education?.some(edu => 
            edu.degree?.toLowerCase().includes('b.tech') || 
            edu.degree?.toLowerCase().includes('b.e') ||
            edu.degree?.toLowerCase().includes('m.tech') ||
            edu.degree?.toLowerCase().includes('m.e') ||
            edu.degree?.toLowerCase().includes('computer') ||
            edu.degree?.toLowerCase().includes('it') ||
            edu.degree?.toLowerCase().includes('information tech') ||
            edu.field?.toLowerCase().includes('computer') ||
            edu.field?.toLowerCase().includes('it') ||
            edu.field?.toLowerCase().includes('information tech')
          );
          
          return hasRelevantDegree ? 'Yes' : 'No';
        }
        
        // For location questions (are you in X city)
        if (questionLower.includes('located in') || questionLower.includes('location')) {
          return 'Yes'; // Default to Yes for location questions
        }
        
        // For work authorization questions
        if (questionLower.includes('authorized to work') || questionLower.includes('work permit')) {
          return 'Yes'; // Default to Yes for work authorization
        }
        
        // For relocation questions
        if (questionLower.includes('willing to relocate') || questionLower.includes('can relocate')) {
          return 'Yes'; // Default to Yes for relocation willingness
        }
        
        // For other yes/no questions, default to positive response
        return 'Yes';
      }
    }
    
    // Special case handling for CTC/Salary questions
    if (questionLower.includes('ctc') || 
        questionLower.includes('salary') || 
        questionLower.includes('package') || 
        (questionLower.includes('current') && questionLower.includes('lakh'))) {
      
      console.log('Detected CTC/salary question, using specialized handler');
      return handleSalaryQuestion(question, profile, jobContext);
    }
    
    // For all other questions, use the AI model
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    // Build context for the AI
    const context = buildProfileContext(profile, jobDetails);
    
    // ...existing code...
  } catch (error) {
    console.error('Gemini API Error:', error);
    return null; // Return null to indicate failure
  }
}

/**
 * Detect question format based on text and patterns
 */
function detectQuestionFormat(questionText) {
  const lowerQuestion = questionText.toLowerCase();

  // Look for Naukri-specific patterns that usually come with options
  if (lowerQuestion.includes('kindly answer') &&
      (lowerQuestion.includes('yes') || lowerQuestion.includes('no')) && // Often part of the question text itself, not necessarily the only options
      (questionText.match(/Yes\s*No/) || questionText.match(/Yes\s*[\s\S]*?No/) || questionText.includes('Choose one'))) { // Check if "Yes" and "No" appear as distinct options
      // Further check if specific options are present in the request. If `req.body.options` exist, it's likely a choice.
      // This check should ideally happen where `options` are available. For now, this is a hint.
    return 'NAUKRI_RADIO_BUTTONS';
  }

  // General radio button patterns (often implies options will be provided separately)
  if (lowerQuestion.includes('select one') || lowerQuestion.includes('choose one') ||
     ( (lowerQuestion.includes(' yes') || lowerQuestion.includes('yes ')) &&
       (lowerQuestion.includes(' no') || lowerQuestion.includes('no ')) &&
       !lowerQuestion.includes('textarea') && !lowerQuestion.includes('text input') &&
       questionText.length < 200 // Short questions with yes/no are often radio
     )
  ) {
    return 'RADIO_BUTTONS';
  }
  // Add more heuristics if needed, e.g., for MULTIPLE_CHOICE if distinct from RADIO_BUTTONS

  return 'TEXT_INPUT'; // Default to text input
}

/**
 * Check if question text implies Yes/No options (used as a helper, but primary logic is now option-based)
 */
function hasYesNoOptions(questionText) { // This function might be less critical now if options are always passed for radio/mcq
  const lowerQuestion = questionText.toLowerCase();

  // Direct yes/no options present in the question string itself
  if (/\byes\b[\s\S]*\bno\b/i.test(lowerQuestion) || /\bno\b[\s\S]*\byes\b/i.test(lowerQuestion)) {
      // Example: "Are you willing to relocate? Yes No"
      if (questionText.match(/Yes\s{1,5}No|No\s{1,5}Yes/)) return true; // Simple inline Yes No
  }

  // Common yes/no question phrasing
  return (
    lowerQuestion.startsWith('are you') ||
    lowerQuestion.startsWith('do you') ||
    lowerQuestion.startsWith('have you') ||
    lowerQuestion.startsWith('can you') ||
    lowerQuestion.startsWith('will you') ||
    lowerQuestion.startsWith('would you') ||
    lowerQuestion.startsWith('is it') ||
    lowerQuestion.includes(' (yes/no)')
  );
}

/**
 * Special handler for salary/CTC related questions (TEXT_INPUT type)
 */
function handleSalaryQuestion(question, profile, jobContext) {
  const questionLower = question.toLowerCase();

  // Prioritize profile's expected CTC if the question asks for it
  if (questionLower.includes('expected') || questionLower.includes('desired') || questionLower.includes('looking for')) {
    if (profile?.expectedCtc) return `${profile.expectedCtc}`;
    // Fallback to job context if profile has no expected CTC
    if (jobContext.isFresherRole) return `${jobContext.industryBenchmarks.fresher.typical}`;
    if (jobContext.isSeniorRole) return `${jobContext.industryBenchmarks.senior.typical}`;
    return `${jobContext.industryBenchmarks.midLevel.typical}`;
  }

  // For current CTC questions, or if question is generic about salary
  if (questionLower.includes('current') || !questionLower.includes('expected')) {
    if (profile?.currentCtc) return `${profile.currentCtc}`;
     // Fallback if current CTC not in profile
    if (jobContext.isFresherRole) return "Not applicable as a fresher, but my expectation is around " + `${jobContext.industryBenchmarks.fresher.typical}.`; // Freshers might not have a "current CTC"
    if (jobContext.isSeniorRole) return `${jobContext.industryBenchmarks.senior.minCTC}`; // State a reasonable current based on seniority
    return `${jobContext.industryBenchmarks.midLevel.minCTC}`; // Mid-level reasonable current
  }

  // Default general response if unable to parse specifics
  return "My salary expectations are negotiable and align with industry standards for a role of this nature and my experience level. I'm happy to discuss this further.";
}


/**
 * Handle notice period multiple choice questions
 */
function handleNoticePeriodQuestion(options, profile) {
  const profileNoticePeriod = profile?.noticePeriod; // e.g., "30 days", "Immediate", "2 months"
  if (!profileNoticePeriod) return null; // Cannot determine without profile info

  const days = extractDaysFromNoticePeriod(String(profileNoticePeriod));
  if (days === null) return null; // Could not parse days from profile

  // Try to find the best matching option
  let bestOption = null;

  if (days <= 0) { // Immediate
    bestOption = findOptionByPattern(options, ['immediate', '0 days', 'within 7 days', 'within 15 days']);
  } else if (days <= 7) {
    bestOption = findOptionByPattern(options, ['7 days', '1 week', 'within 7 days', 'within 15 days', '15 days']);
  } else if (days <= 15) {
    bestOption = findOptionByPattern(options, ['15 days', '2 weeks', 'within 15 days', 'less than 30 days', '1 month', '30 days']);
  } else if (days <= 30) {
    bestOption = findOptionByPattern(options, ['30 days', '1 month', 'one month', '4 weeks']);
  } else if (days <= 45) {
    bestOption = findOptionByPattern(options, ['45 days', '1.5 months', 'less than 60 days', '2 months', '60 days']);
  } else if (days <= 60) {
    bestOption = findOptionByPattern(options, ['60 days', '2 months', 'two months']);
  } else if (days <= 75) {
    bestOption = findOptionByPattern(options, ['75 days', '2.5 months', 'less than 90 days', '3 months', '90 days']);
  } else if (days <= 90) {
    bestOption = findOptionByPattern(options, ['90 days', '3 months', 'three months']);
  } else { // More than 90 days
    bestOption = findOptionByPattern(options, ['more than 90 days', 'more than 3 months', '90+ days']);
  }

  // If no specific match, try generic options
  if (!bestOption) {
    if (days > 60) bestOption = findOptionByPattern(options, ['more than 60 days', 'more than 2 months']);
    if (!bestOption && days > 30) bestOption = findOptionByPattern(options, ['more than 30 days', 'more than 1 month']);
  }
  // Ensure the chosen option is one of the provided options
  if (bestOption && options.includes(bestOption)) {
      return bestOption;
  } else if (bestOption) { // If findOptionByPattern returned a pattern, not an exact option
      const exactOption = options.find(opt => opt.toLowerCase().includes(bestOption.toLowerCase()));
      if (exactOption) return exactOption;
  }


  return null; // Fallback to LLM if no confident match
}

/**
 * Extract number of days from a notice period string
 */
function extractDaysFromNoticePeriod(noticePeriod) {
  if (!noticePeriod) return null;
  const lowerPeriod = String(noticePeriod).toLowerCase();

  if (lowerPeriod.includes('immediate')) return 0;

  const numberMatch = lowerPeriod.match(/\d+(\.\d+)?/);
  if (numberMatch) {
    const number = parseFloat(numberMatch[0]);
    if (lowerPeriod.includes('day')) return number;
    if (lowerPeriod.includes('week')) return number * 7;
    if (lowerPeriod.includes('month')) return number * 30; // Approximate
    return number; // Assume days if no unit but number present
  }
  // Word-based matching
  if (lowerPeriod.includes('one month')) return 30;
  if (lowerPeriod.includes('two month')) return 60;
  if (lowerPeriod.includes('three month')) return 90;

  return null;
}

/**
 * Find option matching any of the given patterns (case-insensitive)
 */
function findOptionByPattern(options, patterns) {
  for (const pattern of patterns) {
    const foundOption = options.find(opt => opt.toLowerCase().includes(pattern.toLowerCase()));
    if (foundOption) return foundOption;
  }
  return null;
}

/**
 * MODIFICATION 3: Enhanced handleLocationQuestion
 * Handle location multiple choice questions
 */
function handleLocationQuestion(options, profile, question) {
  if (!profile?.location) {
    // If profile location is missing, cannot make a specific choice based on it.
    // However, if the question is about willingness to relocate, we might still answer.
    if (question.toLowerCase().includes('willing to relocate') || question.toLowerCase().includes('open to relocating')) {
        if (profile?.relocationFlexible === true) {
            const yesOption = findOptionByPattern(options, ['yes', 'willing to relocate', 'open to relocate']);
            if (yesOption) return yesOption;
        } else if (profile?.relocationFlexible === false) {
            const noOption = findOptionByPattern(options, ['no', 'not willing to relocate']);
            if (noOption) return noOption;
        }
    }
    return null; // Fallback to LLM
  }

  const preferredLocation = profile.location.toLowerCase();
  const questionLower = question.toLowerCase();

  // Try to match preferred location directly with an option
  let matchingOption = options.find(opt => opt.toLowerCase().includes(preferredLocation));
  if (matchingOption) return matchingOption;

  // Specific handling for "Within [City]" / "Outside [City]" common in Naukri
  if (options.length === 2) {
    const option1Text = options[0].toLowerCase(); // e.g., "within hyderabad"
    const option2Text = options[1].toLowerCase(); // e.g., "outside hyderabad"

    let cityInQuestion = null;

    // Try to extract city from "Within [City]" option
    if (option1Text.startsWith('within ')) {
      cityInQuestion = option1Text.substring('within '.length).trim();
    } else if (option2Text.startsWith('within ')) { // Check if second option is "within"
      cityInQuestion = option2Text.substring('within '.length).trim();
    }

    // If city not found in options, try to extract from question: "based in Hyderabad" or "current location is Hyderabad"
    if (!cityInQuestion) {
        const cityMatch = questionLower.match(/based in (\w+)|current location.* (\w+)|located in (\w+)|stay in (\w+)/);
        if (cityMatch) {
            cityInQuestion = cityMatch[1] || cityMatch[2] || cityMatch[3] || cityMatch[4];
        }
    }

    if (cityInQuestion) {
      cityInQuestion = cityInQuestion.toLowerCase();
      if (preferredLocation === cityInQuestion) {
        // Profile location matches the city in question
        return options.find(opt => opt.toLowerCase().startsWith('within ') || (opt.toLowerCase().includes(cityInQuestion) && !opt.toLowerCase().includes('outside')));
      } else {
        // Profile location does NOT match the city in question
        return options.find(opt => opt.toLowerCase().startsWith('outside ') || (opt.toLowerCase().includes('outside') && opt.toLowerCase().includes(cityInQuestion)) || opt.toLowerCase() === 'outside ' + cityInQuestion );
      }
    }
  }

  // If it's a general relocation willingness question
  if (questionLower.includes('willing to relocate') || questionLower.includes('open to relocating') || questionLower.includes('consider relocating')) {
    if (profile.relocationFlexible === true) { // Assuming profile has this boolean
      const yesOption = findOptionByPattern(options, ['yes', 'willing', 'open to relocate']);
      if (yesOption) return yesOption;
    } else if (profile.relocationFlexible === false) {
      const noOption = findOptionByPattern(options, ['no', 'not willing']);
      if (noOption) return noOption;
    }
    // If relocationFlexible is undefined, might select "Yes" by default or let LLM decide. For now, default to yes if such option exists.
    const yesOptionDefault = findOptionByPattern(options, ['yes', 'willing', 'open to relocate']);
    if (yesOptionDefault) return yesOptionDefault;

  }

  // If no specific logic handles it, return null to let the LLM try.
  return null;
}


/**
 * Build context object from profile and job details
 */
function buildProfileContext(profile, jobDetails) {
  // Ensure profile and jobDetails are at least empty objects to avoid errors on undefined properties
  profile = profile || {};
  jobDetails = jobDetails || {};

  return {
    candidateProfile: {
      name: profile.name || 'Candidate',
      skills: profile.skills || [],
      summary: profile.summary || '',
      experience: profile.experience || [], // Array of experience objects
      education: profile.education || [],   // Array of education objects
      location: profile.location || null, // Keep null if not specified
      currentCtc: profile.currentCtc || null,
      expectedCtc: profile.expectedCtc || null,
      noticePeriod: profile.noticePeriod || null,
      totalExperienceYears: profile.totalExperienceYears || (profile.experience?.length > 0 ? profile.experience.reduce((acc, exp) => acc + (exp.durationYears || 0), 0) : 0) // Basic calculation if not directly available
    },
    jobContext: {
      title: jobDetails.title || null,
      company: jobDetails.company || null,
      description: jobDetails.description || '',
      skills: jobDetails.skills || [] // From analyzeJobContext

    }
  };
}




module.exports = router;