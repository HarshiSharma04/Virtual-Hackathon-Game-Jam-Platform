const express = require('express');
const router = express.Router();
const Submission = require('../models/Submission');

// Get all submissions
router.get('/', async (req, res) => {
  const submissions = await Submission.find();
  res.json(submissions);
});

// Submit a project
router.post('/', async (req, res) => {
  const submission = new Submission(req.body);
  // Automated judging logic example
  submission.judgingStatus = submission.projectName ? 'Passed' : 'Pending';
  await submission.save();
  res.json(submission);
});

module.exports = router;