const mongoose = require('mongoose');

const TeamSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    maxlength: 500
  },
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  leader: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, default: 'member' },
    skills: [String],
    joinedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['active', 'inactive', 'left'], default: 'active' }
  }],
  invitations: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  }],
  project: {
    name: String,
    description: String,
    technologies: [String],
    repository: {
      url: String,
      branch: String
    },
    demo: {
      url: String,
      video: String
    },
    progress: {
      tasks: [{
        title: String,
        description: String,
        assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        status: { type: String, enum: ['todo', 'in-progress', 'completed'], default: 'todo' },
        priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
        createdAt: { type: Date, default: Date.now },
        completedAt: Date
      }],
      milestones: [{
        title: String,
        description: String,
        deadline: Date,
        completed: { type: Boolean, default: false },
        completedAt: Date
      }]
    }
  },
  communication: {
    chatRoom: {
      messages: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        message: String,
        type: { type: String, enum: ['text', 'file', 'image'], default: 'text' },
        timestamp: { type: Date, default: Date.now }
      }]
    },
    meetings: [{
      title: String,
      scheduledAt: Date,
      duration: Number,
      meetingUrl: String,
      participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      notes: String,
      status: { type: String, enum: ['scheduled', 'completed', 'cancelled'], default: 'scheduled' }
    }]
  },
  submission: { type: mongoose.Schema.Types.ObjectId, ref: 'Submission' },
  stats: {
    totalTasks: { type: Number, default: 0 },
    completedTasks: { type: Number, default: 0 },
    progressPercentage: { type: Number, default: 0 }
  },
  isPublic: { type: Boolean, default: true },
  lookingForMembers: { type: Boolean, default: false },
  requiredSkills: [String]
}, {
  timestamps: true
});

// Update stats before saving
TeamSchema.pre('save', function(next) {
  if (this.project && this.project.progress && this.project.progress.tasks) {
    this.stats.totalTasks = this.project.progress.tasks.length;
    this.stats.completedTasks = this.project.progress.tasks.filter(task => task.status === 'completed').length;
    this.stats.progressPercentage = this.stats.totalTasks > 0 ? 
      Math.round((this.stats.completedTasks / this.stats.totalTasks) * 100) : 0;
  }
  next();
});

// Virtual for member count
TeamSchema.virtual('memberCount').get(function() {
  return this.members.filter(member => member.status === 'active').length;
});

// Virtual for available spots
TeamSchema.virtual('availableSpots').get(function() {
  return this.event ? this.event.maxTeamSize - this.memberCount : 0;
});

module.exports = mongoose.model('Team', TeamSchema);