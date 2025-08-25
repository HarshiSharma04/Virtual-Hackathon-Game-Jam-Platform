const mongoose = require('mongoose');

const SubmissionSchema = new mongoose.Schema({
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true
  },
  project: {
    name: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: true,
      maxlength: 2000
    },
    tagline: {
      type: String,
      maxlength: 100
    },
    technologies: [String],
    category: String
  },
  links: {
    repository: {
      type: String,
      required: true
    },
    demo: String,
    video: String,
    presentation: String,
    documentation: String
  },
  media: [{
    type: { type: String, enum: ['image', 'video'] },
    url: String,
    caption: String,
    order: Number
  }],
  metadata: {
    linesOfCode: Number,
    commits: Number,
    contributors: Number,
    technologies: [String],
    complexity: { type: String, enum: ['low', 'medium', 'high'] },
    innovation: { type: Number, min: 1, max: 10 },
    completeness: { type: Number, min: 1, max: 10 },
    documentation: { type: Number, min: 1, max: 10 },
    presentation: { type: Number, min: 1, max: 10 }
  },
  judging: {
    scores: [{
      criterion: String,
      score: Number,
      maxScore: Number,
      judge: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      feedback: String,
      timestamp: { type: Date, default: Date.now }
    }],
    totalScore: { type: Number, default: 0 },
    averageScore: { type: Number, default: 0 },
    rank: Number,
    status: { type: String, enum: ['pending', 'judging', 'judged'], default: 'pending' }
  },
  voting: {
    publicVotes: { type: Number, default: 0 },
    votes: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      score: { type: Number, min: 1, max: 5 },
      timestamp: { type: Date, default: Date.now }
    }]
  },
  status: {
    type: String,
    enum: ['draft', 'submitted', 'under-review', 'approved', 'rejected'],
    default: 'draft'
  },
  submittedAt: Date,
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  feedback: [{
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    message: String,
    type: { type: String, enum: ['judge', 'peer', 'mentor'], default: 'peer' },
    timestamp: { type: Date, default: Date.now }
  }],
  achievements: [{
    title: String,
    description: String,
    badge: String,
    earnedAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

// Auto-calculate scores when judges submit ratings
SubmissionSchema.pre('save', function(next) {
  if (this.judging && this.judging.scores && this.judging.scores.length > 0) {
    // Calculate total score
    this.judging.totalScore = this.judging.scores.reduce((sum, score) => sum + score.score, 0);
    
    // Calculate average score
    this.judging.averageScore = this.judging.totalScore / this.judging.scores.length;
  }
  
  // Calculate public voting average
  if (this.voting && this.voting.votes && this.voting.votes.length > 0) {
    this.voting.publicVotes = this.voting.votes.reduce((sum, vote) => sum + vote.score, 0) / this.voting.votes.length;
  }
  
  next();
});

// Auto-judge based on metadata (for automated judging)
SubmissionSchema.methods.autoJudge = function() {
  if (!this.metadata) return;
  
  const scores = [];
  
  // Innovation score (1-100)
  if (this.metadata.innovation) {
    scores.push({
      criterion: 'Innovation',
      score: this.metadata.innovation * 10,
      maxScore: 100,
      timestamp: Date.now()
    });
  }
  
  // Technical Complexity (based on technologies and lines of code)
  if (this.metadata.technologies && this.metadata.linesOfCode) {
    const techScore = Math.min(this.metadata.technologies.length * 10, 50);
    const codeScore = Math.min(this.metadata.linesOfCode / 100, 50);
    scores.push({
      criterion: 'Technical Complexity',
      score: techScore + codeScore,
      maxScore: 100,
      timestamp: Date.now()
    });
  }
  
  // Completeness score
  if (this.metadata.completeness) {
    scores.push({
      criterion: 'Completeness',
      score: this.metadata.completeness * 10,
      maxScore: 100,
      timestamp: Date.now()
    });
  }
  
  // Documentation score
  if (this.metadata.documentation) {
    scores.push({
      criterion: 'Documentation',
      score: this.metadata.documentation * 10,
      maxScore: 100,
      timestamp: Date.now()
    });
  }
  
  // Presentation score
  if (this.metadata.presentation) {
    scores.push({
      criterion: 'Presentation',
      score: this.metadata.presentation * 10,
      maxScore: 100,
      timestamp: Date.now()
    });
  }
  
  this.judging.scores = scores;
  this.judging.status = 'judged';
  
  return this.save();
};

module.exports = mongoose.model('Submission', SubmissionSchema);