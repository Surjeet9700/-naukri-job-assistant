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
    const { profile } = req.body;
    
    if (!profile || !profile.skills || profile.skills.length === 0) {
      return res.status(400).json({ error: 'Invalid profile data' });
    }
    
    const db = getDb();
    const jobs = await findMatchingJobs(profile);
    
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
async function findMatchingJobs(profile) {
  const db = getDb();
  const jobsCollection = db.collection('jobs');
  
  const userSkills = profile.skills.map(skill => skill.toLowerCase());
  
  console.log('Looking for skills:', userSkills); // Debug log
  
  // Get all jobs that match the user's skills and are internal only
  const matchingJobs = await jobsCollection.find({
    $and: [
      { 'Application Type': 'Internal' }, // Filter for Internal jobs only
      {
        $or: userSkills.map(skill => ({
          'Skills': { $regex: new RegExp(skill, 'i') }
        }))
      }
    ]
  }).limit(20).toArray();
  
  // Calculate a match score for each job
  const scoredJobs = matchingJobs.map(job => {
    // Get all skills from the job as an array
    const jobSkills = job.Skills ? job.Skills.split(',').map(s => s.trim().toLowerCase()) : [];
    
    // Count matching skills
    let matchingSkillsCount = 0;
    for (const skill of userSkills) {
      if (jobSkills.some(jobSkill => 
        jobSkill.includes(skill.toLowerCase()) || 
        skill.toLowerCase().includes(jobSkill)
      )) {
        matchingSkillsCount++;
      }
    }
    
    // Calculate score based on skill match percentage
    const skillMatchPercentage = jobSkills.length > 0 
      ? (matchingSkillsCount / Math.max(userSkills.length, jobSkills.length)) * 100 
      : 0;
    
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
      matchScore: skillMatchPercentage
    };
  });
  
  // Sort by match score (highest first)
  return scoredJobs.sort((a, b) => b.matchScore - a.matchScore);
}

module.exports = router;