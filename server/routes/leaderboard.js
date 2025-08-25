const express = require('express');
const router = express.Router();
const Submission = require('../models/Submission');

// GET /api/leaderboard - Top 10 submissions by score
router.get('/', async (req, res) => {
  try {
    const leaderboard = await Submission.find().sort({ score: -1 }).limit(10);
    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;