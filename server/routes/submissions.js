const express = require('express');
const multer = require('multer');
const path = require('path');
const Submission = require('../models/Submission');
const Team = require('../models/Team');
const Event = require('../models/Event');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/submissions/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Get all submissions for an event
router.get('/event/:eventId', async (req, res) => {
  try {
    const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc' } = req.query;
    
    const sortOption = {};
    sortOption[sortBy] = order === 'desc' ? -1 : 1;

    const submissions = await Submission.find({ 
      event: req.params.eventId,
      status: { $ne: 'draft' }
    })
    .populate('team', 'name members')
    .populate('submittedBy', 'username profile.avatar')
    .populate({
      path: 'team',
      populate: {
        path: 'members.user',
        select: 'username profile.avatar'
      }
    })
    .sort(sortOption)
    .limit(limit * 1)
    .skip((page - 1) * limit);

    const total = await Submission.countDocuments({ 
      event: req.params.eventId,
      status: { $ne: 'draft' }
    });

    res.json({
      submissions,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get submissions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get submission by ID
router.get('/:id', async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id)
      .populate('team')
      .populate('submittedBy', 'username profile')
      .populate('event', 'title judging')
      .populate('judging.scores.judge', 'username profile.avatar')
      .populate('voting.votes.user', 'username')
      .populate('feedback.from', 'username profile.avatar')
      .populate({
        path: 'team',
        populate: {
          path: 'members.user leader',
          select: 'username profile.avatar profile.skills'
        }
      });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    res.json({ submission });
  } catch (error) {
    console.error('Get submission error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create/Update submission
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      eventId,
      teamId,
      project,
      links,
      metadata,
      status = 'draft'
    } = req.body;

    // Verify team membership
    const team = await Team.findById(teamId).populate('event');
    if (!team) {
      return res.status(404).json({ message: 'Team not found' });
    }

    const isMember = team.members.some(
      m => m.user.toString() === req.user._id.toString() && m.status === 'active'
    );

    if (!isMember) {
      return res.status(403).json({ message: 'Only team members can create submissions' });
    }

    // Check if submission already exists
    let submission = await Submission.findOne({ team: teamId, event: eventId });

    if (submission) {
      // Update existing submission
      submission.project = project;
      submission.links = links;
      submission.metadata = metadata;
      submission.status = status;
      
      if (status === 'submitted' && !submission.submittedAt) {
        submission.submittedAt = new Date();
        submission.submittedBy = req.user._id;
      }
    } else {
      // Create new submission
      submission = new Submission({
        event: eventId,
        team: teamId,
        project,
        links,
        metadata,
        status,
        submittedBy: req.user._id,
        submittedAt: status === 'submitted' ? new Date() : undefined
      });
    }

    await submission.save();

    // Update team submission reference
    team.submission = submission._id;
    await team.save();

    // Add to event submissions if not already added
    const event = await Event.findById(eventId);
    if (!event.submissions.includes(submission._id)) {
      event.submissions.push(submission._id);
      await event.save();
    }

    // Auto-judge if automated judging is enabled and submission is complete
    if (event.judging.isAutomated && status === 'submitted' && metadata) {
      await submission.autoJudge();
      
      // Update leaderboard
      await updateEventLeaderboard(eventId);
    }

    await submission.populate([
      { path: 'team', select: 'name members' },
      { path: 'submittedBy', select: 'username profile.avatar' }
    ]);

    res.status(submission.isNew ? 201 : 200).json({
      message: submission.isNew ? 'Submission created successfully' : 'Submission updated successfully',
      submission
    });
  } catch (error) {
    console.error('Create/Update submission error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Upload media files for submission
router.post('/:id/media', authMiddleware, upload.array('media', 5), async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id).populate('team');

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if user is team member
    const isMember = submission.team.members.some(
      m => m.user.toString() === req.user._id.toString() && m.status === 'active'
    );

    if (!isMember) {
      return res.status(403).json({ message: 'Only team members can upload media' });
    }

    const mediaFiles = req.files.map((file, index) => ({
      type: file.mimetype.startsWith('video/') ? 'video' : 'image',
      url: `/uploads/submissions/${file.filename}`,
      caption: req.body.captions ? req.body.captions[index] : '',
      order: index
    }));

    submission.media = [...(submission.media || []), ...mediaFiles];
    await submission.save();

    res.json({
      message: 'Media uploaded successfully',
      media: mediaFiles
    });
  } catch (error) {
    console.error('Upload media error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Vote on submission
router.post('/:id/vote', authMiddleware, async (req, res) => {
  try {
    const { score } = req.body; // 1-5 rating
    
    if (score < 1 || score > 5) {
      return res.status(400).json({ message: 'Score must be between 1 and 5' });
    }

    const submission = await Submission.findById(req.params.id);

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if event allows voting
    const event = await Event.findById(submission.event);
    if (event.status !== 'judging' && event.status !== 'completed') {
      return res.status(400).json({ message: 'Voting is not open for this event' });
    }

    // Check if user already voted
    const existingVote = submission.voting.votes.find(
      vote => vote.user.toString() === req.user._id.toString()
    );

    if (existingVote) {
      existingVote.score = score;
      existingVote.timestamp = new Date();
    } else {
      submission.voting.votes.push({
        user: req.user._id,
        score,
        timestamp: new Date()
      });
    }

    await submission.save();

    // Update leaderboard
    await updateEventLeaderboard(submission.event);

    res.json({
      message: 'Vote submitted successfully',
      averageScore: submission.voting.publicVotes
    });
  } catch (error) {
    console.error('Vote error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Judge submission (for judges)
router.post('/:id/judge', authMiddleware, async (req, res) => {
  try {
    const { scores, feedback } = req.body;
    
    const submission = await Submission.findById(req.params.id).populate('event');

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if user is authorized to judge
    const event = submission.event;
    const isJudge = event.judging.judges.includes(req.user._id) || 
                   event.organizer.toString() === req.user._id.toString();

    if (!isJudge) {
      return res.status(403).json({ message: 'Not authorized to judge this submission' });
    }

    // Remove existing scores from this judge
    submission.judging.scores = submission.judging.scores.filter(
      score => score.judge.toString() !== req.user._id.toString()
    );

    // Add new scores
    scores.forEach(scoreData => {
      submission.judging.scores.push({
        criterion: scoreData.criterion,
        score: scoreData.score,
        maxScore: scoreData.maxScore || 100,
        judge: req.user._id,
        feedback: scoreData.feedback,
        timestamp: new Date()
      });
    });

    submission.judging.status = 'judged';

    if (feedback) {
      submission.feedback.push({
        from: req.user._id,
        message: feedback,
        type: 'judge',
        timestamp: new Date()
      });
    }

    await submission.save();

    // Update leaderboard
    await updateEventLeaderboard(submission.event._id);

    res.json({
      message: 'Submission judged successfully',
      totalScore: submission.judging.totalScore
    });
  } catch (error) {
    console.error('Judge submission error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add feedback to submission
router.post('/:id/feedback', authMiddleware, async (req, res) => {
  try {
    const { message, type = 'peer' } = req.body;
    
    const submission = await Submission.findById(req.params.id);

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    submission.feedback.push({
      from: req.user._id,
      message,
      type,
      timestamp: new Date()
    });

    await submission.save();

    await submission.populate('feedback.from', 'username profile.avatar');

    res.json({
      message: 'Feedback added successfully',
      feedback: submission.feedback[submission.feedback.length - 1]
    });
  } catch (error) {
    console.error('Add feedback error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get submission analytics
router.get('/:id/analytics', authMiddleware, async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id).populate('team event');

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if user is authorized (team member, judge, or organizer)
    const isMember = submission.team.members.some(
      m => m.user.toString() === req.user._id.toString()
    );
    const isJudge = submission.event.judging.judges.includes(req.user._id);
    const isOrganizer = submission.event.organizer.toString() === req.user._id.toString();

    if (!isMember && !isJudge && !isOrganizer) {
      return res.status(403).json({ message: 'Not authorized to view analytics' });
    }

    const analytics = {
      views: submission.views || 0,
      votes: {
        count: submission.voting.votes.length,
        average: submission.voting.publicVotes,
        distribution: {}
      },
      judging: {
        totalScore: submission.judging.totalScore,
        averageScore: submission.judging.averageScore,
        criteriaBreakdown: {}
      },
      feedback: {
        count: submission.feedback.length,
        types: {}
      },
      rank: submission.judging.rank || 'N/A'
    };

    // Vote distribution
    for (let i = 1; i <= 5; i++) {
      analytics.votes.distribution[i] = submission.voting.votes.filter(v => v.score === i).length;
    }

    // Criteria breakdown
    submission.judging.scores.forEach(score => {
      if (!analytics.judging.criteriaBreakdown[score.criterion]) {
        analytics.judging.criteriaBreakdown[score.criterion] = {
          total: 0,
          count: 0,
          average: 0
        };
      }
      analytics.judging.criteriaBreakdown[score.criterion].total += score.score;
      analytics.judging.criteriaBreakdown[score.criterion].count += 1;
      analytics.judging.criteriaBreakdown[score.criterion].average = 
        analytics.judging.criteriaBreakdown[score.criterion].total / 
        analytics.judging.criteriaBreakdown[score.criterion].count;
    });

    // Feedback types
    submission.feedback.forEach(fb => {
      analytics.feedback.types[fb.type] = (analytics.feedback.types[fb.type] || 0) + 1;
    });

    res.json({ analytics });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete submission
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id).populate('team event');

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if user is team leader or organizer
    const isLeader = submission.team.leader.toString() === req.user._id.toString();
    const isOrganizer = submission.event.organizer.toString() === req.user._id.toString();

    if (!isLeader && !isOrganizer) {
      return res.status(403).json({ message: 'Not authorized to delete this submission' });
    }

    // Remove from team
    submission.team.submission = undefined;
    await submission.team.save();

    // Remove from event
    await Event.findByIdAndUpdate(submission.event._id, {
      $pull: { submissions: submission._id }
    });

    await Submission.findByIdAndDelete(req.params.id);

    // Update leaderboard
    await updateEventLeaderboard(submission.event._id);

    res.json({ message: 'Submission deleted successfully' });
  } catch (error) {
    console.error('Delete submission error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get team's submission for an event
router.get('/team/:teamId/event/:eventId', authMiddleware, async (req, res) => {
  try {
    const submission = await Submission.findOne({
      team: req.params.teamId,
      event: req.params.eventId
    })
    .populate('team')
    .populate('submittedBy', 'username profile.avatar')
    .populate('judging.scores.judge', 'username')
    .populate('feedback.from', 'username profile.avatar');

    res.json({ submission });
  } catch (error) {
    console.error('Get team submission error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get top submissions (featured/popular)
router.get('/event/:eventId/top', async (req, res) => {
  try {
    const { limit = 6 } = req.query;

    const topSubmissions = await Submission.find({
      event: req.params.eventId,
      status: 'submitted'
    })
    .populate('team', 'name members')
    .populate({
      path: 'team',
      populate: {
        path: 'members.user',
        select: 'username profile.avatar'
      }
    })
    .sort({ 'judging.totalScore': -1, 'voting.publicVotes': -1 })
    .limit(parseInt(limit));

    res.json({ submissions: topSubmissions });
  } catch (error) {
    console.error('Get top submissions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper function to update event leaderboard
async function updateEventLeaderboard(eventId) {
  try {
    const event = await Event.findById(eventId).populate('submissions');
    
    const leaderboard = [];

    for (const submission of event.submissions) {
      if (submission.status === 'submitted' && submission.judging.totalScore > 0) {
        await submission.populate('team');
        
        leaderboard.push({
          team: submission.team._id,
          submission: submission._id,
          totalScore: submission.judging.totalScore + (submission.voting.publicVotes * 10), // Combine judge + public scores
          scores: submission.judging.scores,
          rank: 0,
          updatedAt: new Date()
        });
      }
    }

    // Sort and assign ranks
    leaderboard.sort((a, b) => b.totalScore - a.totalScore);
    leaderboard.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    event.leaderboard = leaderboard;
    await event.save();

    return leaderboard;
  } catch (error) {
    console.error('Update leaderboard error:', error);
    return [];
  }
}

module.exports = router;