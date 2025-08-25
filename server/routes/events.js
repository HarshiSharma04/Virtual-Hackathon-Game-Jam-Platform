const express = require('express');
const Event = require('../models/Event');
const Team = require('../models/Team');
const Submission = require('../models/Submission');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Create event
router.post('/', async (req, res) => {
  try {
    const event = new Event(req.body);
    await event.save();
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create event' });
  }
});

// Get events (optionally filter by user)
router.get('/', async (req, res) => {
  try {
    const query = req.query.user ? { participants: req.query.user } : {};
    const events = await Event.find(query);
    res.json({ events });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch events' });
  }
});

// Get event by ID
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('organizer', 'username profile')
      .populate('participants.user', 'username profile.avatar stats')
      .populate({
        path: 'teams',
        populate: {
          path: 'members.user leader',
          select: 'username profile.avatar'
        }
      })
      .populate({
        path: 'submissions',
        populate: {
          path: 'team submittedBy',
          select: 'name username'
        }
      })
      .populate('chatRooms.messages.user', 'username profile.avatar');

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check if user is participant
    let isParticipant = false;
    let userRole = null;
    
    if (req.user) {
      const participant = event.participants.find(
        p => p.user._id.toString() === req.user._id.toString()
      );
      isParticipant = !!participant;
      userRole = participant?.role;
    }

    res.json({
      event,
      isParticipant,
      userRole
    });
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update event
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check if user is organizer
    if (event.organizer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this event' });
    }

    Object.assign(event, req.body);
    await event.save();

    await event.populate('organizer', 'username profile.avatar');

    res.json({
      message: 'Event updated successfully',
      event
    });
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Join event
router.post('/:id/join', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check if already joined
    const isAlreadyJoined = event.participants.some(
      p => p.user.toString() === req.user._id.toString()
    );

    if (isAlreadyJoined) {
      return res.status(400).json({ message: 'Already joined this event' });
    }

    // Check if event is open for registration
    if (event.status !== 'upcoming') {
      return res.status(400).json({ message: 'Event registration is closed' });
    }

    // Add participant
    event.participants.push({
      user: req.user._id,
      role: 'participant'
    });

    // Update user stats
    req.user.stats.eventsJoined += 1;
    await req.user.save();

    await event.save();

    res.json({
      message: 'Successfully joined the event',
      event
    });
  } catch (error) {
    console.error('Join event error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Leave event
router.post('/:id/leave', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Remove participant
    event.participants = event.participants.filter(
      p => p.user.toString() !== req.user._id.toString()
    );

    // Remove from teams in this event
    await Team.updateMany(
      { event: event._id },
      { $pull: { 'members': { user: req.user._id } } }
    );

    await event.save();

    res.json({ message: 'Successfully left the event' });
  } catch (error) {
    console.error('Leave event error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get event leaderboard
router.get('/:id/leaderboard', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate({
        path: 'leaderboard.team',
        populate: {
          path: 'members.user leader',
          select: 'username profile.avatar'
        }
      })
      .populate({
        path: 'leaderboard.submission',
        select: 'project judging voting'
      })
      .select('leaderboard title');

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Sort leaderboard by total score
    event.leaderboard.sort((a, b) => b.totalScore - a.totalScore);

    // Update ranks
    event.leaderboard.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    await event.save();

    res.json({ leaderboard: event.leaderboard });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update leaderboard (automated judging)
router.post('/:id/update-leaderboard', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('submissions');

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check authorization
    if (event.organizer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const leaderboard = [];

    for (const submission of event.submissions) {
      await submission.populate('team');
      
      // Auto-judge if not already judged
      if (submission.judging.status === 'pending') {
        await submission.autoJudge();
      }

      leaderboard.push({
        team: submission.team._id,
        submission: submission._id,
        totalScore: submission.judging.totalScore || 0,
        scores: submission.judging.scores,
        rank: 0,
        updatedAt: new Date()
      });
    }

    // Sort and assign ranks
    leaderboard.sort((a, b) => b.totalScore - a.totalScore);
    leaderboard.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    event.leaderboard = leaderboard;
    await event.save();

    res.json({
      message: 'Leaderboard updated successfully',
      leaderboard: event.leaderboard
    });
  } catch (error) {
    console.error('Update leaderboard error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Start event
router.post('/:id/start', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (event.organizer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    event.status = 'active';
    await event.save();

    res.json({
      message: 'Event started successfully',
      event
    });
  } catch (error) {
    console.error('Start event error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// End event
router.post('/:id/end', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (event.organizer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    event.status = 'judging';
    await event.save();

    res.json({
      message: 'Event moved to judging phase',
      event
    });
  } catch (error) {
    console.error('End event error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Complete event
router.post('/:id/complete', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (event.organizer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    event.status = 'completed';
    await event.save();

    res.json({
      message: 'Event completed successfully',
      event
    });
  } catch (error) {
    console.error('Complete event error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get event statistics
router.get('/:id/stats', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const stats = {
      totalParticipants: event.participants.length,
      totalTeams: event.teams.length,
      totalSubmissions: event.submissions.length,
      participantsByRole: event.participants.reduce((acc, p) => {
        acc[p.role] = (acc[p.role] || 0) + 1;
        return acc;
      }, {}),
      timeRemaining: event.endDate - Date.now(),
      duration: event.endDate - event.startDate
    };

    res.json({ stats });
  } catch (error) {
    console.error('Get event stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;