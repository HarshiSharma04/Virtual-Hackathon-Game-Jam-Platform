const express = require('express');
const router = express.Router();
const Event = require('../models/Event');

// Get events (optionally limit and filter upcoming)
router.get('/', async (req, res) => {
  const { limit, upcoming } = req.query;
  const query = upcoming ? { startDate: { $gte: new Date() } } : {};
  const events = await Event.find(query).limit(Number(limit) || 10);
  res.json({ events });
});

// Create event
router.post('/', async (req, res) => {
  const event = new Event(req.body);
  await event.save();
  res.json(event);
});

module.exports = router;