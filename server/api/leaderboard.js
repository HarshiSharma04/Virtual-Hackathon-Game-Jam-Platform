const express = require('express');
const router = express.Router();
const Submission = require('../models/Submission');

// Simple leaderboard by score
router.get('/', async (req, res) => {
  const leaderboard = await Submission.find().sort({ score: -1 }).limit(10);
  res.json(leaderboard);
});

module.exports = router;