const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  theme: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['hackathon', 'game-jam', 'design-sprint'],
    required: true
  },
  difficulty: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced'],
    default: 'intermediate'
  },
  status: {
    type: String,
    enum: ['upcoming', 'active', 'judging', 'completed'],
    default: 'upcoming'
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  maxTeamSize: {
    type: Number,
    default: 4,
    min: 1,
    max: 10
  },
  maxTeams: {
    type: Number,
    default: 100
  },
  prizes: [{
    position: String,
    title: String,
    description: String,
    value: String
  }],
  rules: [String],
  judging: {
    criteria: [{
      name: String,
      weight: Number,
      description: String
    }],
    isAutomated: { type: Boolean, default: true },
    judges: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  },
  requirements: {
    technologies: [String],
    deliverables: [String],
    submissionFormat: String
  },
  organizer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  participants: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    joinedAt: { type: Date, default: Date.now },
    role: { type: String, enum: ['participant', 'mentor', 'judge'], default: 'participant' }
  }],
  teams: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Team' }],
  submissions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Submission' }],
  chatRooms: [{
    name: String,
    type: { type: String, enum: ['general', 'help', 'announcements'], default: 'general' },
    messages: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      message: String,
      timestamp: { type: Date, default: Date.now },
      type: { type: String, enum: ['text', 'image', 'file'], default: 'text' }
    }]
  }],
  leaderboard: [{
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    submission: { type: mongoose.Schema.Types.ObjectId, ref: 'Submission' },
    totalScore: Number,
    scores: [{
      criterion: String,
      score: Number
    }],
    rank: Number,
    updatedAt: { type: Date, default: Date.now }
  }],
  stats: {
    totalParticipants: { type: Number, default: 0 },
    totalTeams: { type: Number, default: 0 },
    totalSubmissions: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

// Update stats before saving
EventSchema.pre('save', function(next) {
  this.stats.totalParticipants = this.participants.length;
  this.stats.totalTeams = this.teams.length;
  this.stats.totalSubmissions = this.submissions.length;
  next();
});

// Virtual for duration
EventSchema.virtual('duration').get(function() {
  return this.endDate - this.startDate;
});

// Virtual for time remaining
EventSchema.virtual('timeRemaining').get(function() {
  if (this.status === 'completed') return 0;
  return this.endDate - Date.now();
});

module.exports = mongoose.model('Event', EventSchema);