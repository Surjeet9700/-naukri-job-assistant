const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDb } = require('../db/mongodb');

/**
 * Find matching jobs based on user profile
 * POST /api/matching-jobs
 */
router.post('/matching-jobs', async (req, res) => {
  try {
    const { profile, jobType } = req.body;
    
    if (!profile || !profile.skills || profile.skills.length === 0) {
      return res.status(400).json({ error: 'Invalid profile data' });
    }
    
    const db = getDb();
    const jobs = await findMatchingJobs(profile, jobType);
    
    console.log(`Found ${jobs.length} matching jobs`); // Debug log
    res.json({ jobs });
  } catch (error) {
    console.error('Error finding matching jobs:', error);
    res.status(500).json({ error: 'Failed to find matching jobs' });
  }
});

/**
 * Find jobs matching the user's profile
 */
async function findMatchingJobs(profile, jobType) {
  const db = getDb();
  const jobsCollection = db.collection('jobs');
  
  const userSkills = profile.skills.map(skill => skill.toLowerCase());
  
  console.log('Looking for skills:', userSkills); // Debug log
  console.log('Job type filter:', jobType || 'All');
  
  // Prepare base query
  let query = {
    $and: [
      {
        $or: userSkills.map(skill => ({
          'Skills': { $regex: new RegExp(skill, 'i') }
        }))
      },
      {
        $or: [
          { 'Application Type': 'Internal' },
          { jobType: 'Internal' },
          { isInternal: true }
        ]
      }
    ]
  };
  
  // If jobType is specified, add it to the query
  if (jobType) {
    query['Application Type'] = jobType;
  }
  
  // Get all matching jobs with less strict filtering
  const matchingJobs = await jobsCollection.find(query).limit(50).toArray();
  
  console.log(`Found ${matchingJobs.length} initial matches in database`);
  
  // Calculate a match score for each job, with a more lenient scoring system
  const scoredJobs = matchingJobs.map(job => {
    // Get all skills from the job as an array
    const jobSkills = job.Skills ? job.Skills.split(',').map(s => s.trim().toLowerCase()) : [];
    
    // Count matching skills with a more lenient approach
    let matchingSkillsCount = 0;
    for (const skill of userSkills) {
      // More lenient matching - check if any job skill contains parts of the user skill, or vice versa
      if (jobSkills.some(jobSkill => 
        jobSkill.includes(skill.toLowerCase()) || 
        skill.toLowerCase().includes(jobSkill) ||
        // Check for partial matches with at least 3 characters
        (skill.length >= 3 && jobSkill.includes(skill.substring(0, 3))) ||
        (jobSkill.length >= 3 && skill.includes(jobSkill.substring(0, 3)))
      )) {
        matchingSkillsCount++;
      }
    }
    
    // Calculate score based on skill match percentage, with a minimum score boost
    let skillMatchPercentage = jobSkills.length > 0 
      ? (matchingSkillsCount / Math.min(userSkills.length, jobSkills.length)) * 100 
      : 0;
    
    // Give a minimum match score to ensure more results are shown
    skillMatchPercentage = Math.max(skillMatchPercentage, 20);
    
    return {
      id: job._id.toString(),
      title: job['Job Title'],
      company: job['Company Name'],
      location: job['Location'],
      description: job['Job Description'],
      url: job['Job URL'],
      experience: job['Experience Required'],
      salary: job['Salary'],
      skills: jobSkills,
      applicationStatus: 'NOT_APPLIED',
      naukriJobId: job._id.toString(),
      postedDate: job['Scraped Date'] || job['firstScraped'],
      jobType: job['Application Type'],
      isInternal: job['Application Type'] === 'Internal',
      matchScore: skillMatchPercentage
    };
  });
  
  // Sort by match score (highest first)
  return scoredJobs.sort((a, b) => b.matchScore - a.matchScore);
}

module.exports = router;