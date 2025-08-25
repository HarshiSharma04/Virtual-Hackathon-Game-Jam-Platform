const express = require('express');
const Team = require('../models/Team');
const Event = require('../models/Event');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Get all teams for an event
router.get('/event/:eventId', async (req, res) => {
  try {
    const { page = 1, limit = 10, lookingForMembers } = req.query;
    
    let query = { event: req.params.eventId };
    
    if (lookingForMembers === 'true') {
      query.lookingForMembers = true;
    }

    const teams = await Team.find(query)
      .populate('leader', 'username profile.avatar')
      .populate('members.user', 'username profile.avatar profile.skills')
      .populate('event', 'title maxTeamSize')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Team.countDocuments(query);

    res.json({
      teams,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get teams error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get team by ID
router.get('/:id', async (req, res) => {
  try {
    const team = await Team.findById(req.params.id)
      .populate('leader', 'username profile')
      .populate('members.user', 'username profile.avatar profile.skills stats')
      .populate('event', 'title startDate endDate maxTeamSize')
      .populate('invitations.user', 'username profile.avatar')
      .populate('invitations.invitedBy', 'username')
      .populate('project.progress.tasks.assignedTo', 'username profile.avatar')
      .populate('communication.chatRoom.messages.user', 'username profile.avatar')
      .populate('communication.meetings.participants', 'username profile.avatar')
      .populate('submission');

    if (!team) {
      return res.status(404).json({ message: 'Team not found' });
    }

    res.json({ team });
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new team
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, description, eventId, requiredSkills, isPublic } = req.body;

    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check if user is participant in the event
    const isParticipant = event.participants.some(
      p => p.user.toString() === req.user._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({ message: 'You must join the event first' });
    }

    // Check if user already has a team in this event
    const existingTeam = await Team.findOne({
      event: eventId,
      $or: [
        { leader: req.user._id },
        { 'members.user': req.user._id }
      ]
    });

    if (existingTeam) {
      return res.status(400).json({ message: 'You already have a team in this event' });
    }

    const team = new Team({
      name,
      description,
      event: eventId,
      leader: req.user._id,
      members: [{
        user: req.user._id,
        role: 'leader',
        skills: req.user.profile.skills || [],
        joinedAt: new Date(),
        status: 'active'
      }],
      requiredSkills: requiredSkills || [],
      isPublic: isPublic !== false,
      lookingForMembers: true
    });

    await team.save();

    // Add team to event
    event.teams.push(team._id);
    await event.save();

    // Add team to user's current teams
    req.user.currentTeams.push(team._id);
    await req.user.save();

    await team.populate([
      { path: 'leader', select: 'username profile.avatar' },
      { path: 'members.user', select: 'username profile.avatar profile.skills' },
      { path: 'event', select: 'title maxTeamSize' }
    ]);

    res.status(201).json({
      message: 'Team created successfully',
      team
    });
  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update team
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);

    if (!team) {
      return res.status(404).json({ message: 'Team not found' });
    }

    // Check if user is team leader
    if (team.leader.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only team leader can update team' });
    }

    const allowedUpdates = ['name', 'description', 'requiredSkills', 'lookingForMembers', 'isPublic'];
    const updates = {};

    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    Object.assign(team, updates);
    await team.save();

    await team.populate([
      { path: 'leader', select: 'username profile.avatar' },
      { path: 'members.user', select: 'username profile.avatar profile.skills' },
      { path: 'event', select: 'title maxTeamSize' }
    ]);

    res.json({
      message: 'Team updated successfully',
      team
    });
  } catch (error) {
    console.error('Update team error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Join team
router.post('/:id/join', authMiddleware, async (req, res) => {
  try {
    const team = await Team.findById(req.params.id).populate('event');

    if (!team) {
      return res.status(404).json({ message: 'Team not found' });
    }

    // Check if team has space
    const activeMembers = team.members.filter(m => m.status === 'active').length;
    if (activeMembers >= team.event.maxTeamSize) {
      return res.status(400).json({ message: 'Team is full' });
    }

    // Check if user is already a member
    const isMember = team.members.some(
      m => m.user.toString() === req.user._id.toString() && m.status === 'active'
    );

    if (isMember) {
      return res.status(400).json({ message: 'Already a member of this team' });
    }

    // Check if user has a team in this event
    const existingTeam = await Team.findOne({
      event: team.event._id,
      'members.user': req.user._id,
      'members.status': 'active'
    });

    if (existingTeam) {
      return res.status(400).json({ message: 'You already have a team in this event' });
    }

    // Add user to team
    team.members.push({
      user: req.user._id,
      role: 'member',
      skills: req.user.profile.skills || [],
      joinedAt: new Date(),
      status: 'active'
    });

    await team.save();

    // Add team to user's current teams
    req.user.currentTeams.push(team._id);
    await req.user.save();

    await team.populate('members.user', 'username profile.avatar profile.skills');

    res.json({
      message: 'Successfully joined the team',
      team
    });
  } catch (error) {
    console.error('Join team error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Leave team
router.post('/:id/leave', authMiddleware, async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);

    if (!team) {
      return res.status(404).json({ message: 'Team not found' });
    }

    // Check if user is team leader
    if (team.leader.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Team leader cannot leave. Transfer leadership first or delete the team.' });
    }

    // Remove user from team
    team.members = team.members.filter(
      m => m.user.toString() !== req.user._id.toString()
    );

    await team.save();

    // Remove team from user's current teams
    req.user.currentTeams = req.user.currentTeams.filter(
      teamId => teamId.toString() !== team._id.toString()
    );
    await req.user.save();

    res.json({ message: 'Successfully left the team' });
  } catch (error) {
    console.error('Leave team error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Invite user to team
router.post('/:id/invite', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.body;
    const team = await Team.findById(req.params.id).populate('event');

    if (!team) {
      return res.status(404).json({ message: 'Team not found' });
    }

    // Check if user is team leader or member
    const isTeamMember = team.members.some(
      m => m.user.toString() === req.user._id.toString() && m.status === 'active'
    );

    if (!isTeamMember) {
      return res.status(403).json({ message: 'Only team members can invite others' });
    }

    // Check if team has space
    const activeMembers = team.members.filter(m => m.status === 'active').length;
    if (activeMembers >= team.event.maxTeamSize) {
      return res.status(400).json({ message: 'Team is full' });
    }

    // Check if user exists and is participant in the event
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const event = await Event.findById(team.event._id);
    const isEventParticipant = event.participants.some(
      p => p.user.toString() === userId
    );

    if (!isEventParticipant) {
      return res.status(400).json({ message: 'User is not a participant in this event' });
    }

    // Check if already invited
    const existingInvite = team.invitations.find(
      inv => inv.user.toString() === userId && inv.status === 'pending'
    );

    if (existingInvite) {
      return res.status(400).json({ message: 'User already invited' });
    }

    // Check if user is already a member
    const isMember = team.members.some(
      m => m.user.toString() === userId && m.status === 'active'
    );

    if (isMember) {
      return res.status(400).json({ message: 'User is already a team member' });
    }

    // Add invitation
    team.invitations.push({
      user: userId,
      status: 'pending',
      invitedBy: req.user._id,
      createdAt: new Date()
    });

    await team.save();

    res.json({
      message: 'Invitation sent successfully',
      team
    });
  } catch (error) {
    console.error('Invite user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Respond to team invitation
router.post('/:id/invitation/:invitationId/respond', authMiddleware, async (req, res) => {
  try {
    const { response } = req.body; // 'accepted' or 'declined'
    const team = await Team.findById(req.params.id).populate('event');

    if (!team) {
      return res.status(404).json({ message: 'Team not found' });
    }

    const invitation = team.invitations.id(req.params.invitationId);
    if (!invitation) {
      return res.status(404).json({ message: 'Invitation not found' });
    }

    // Check if invitation is for the current user
    if (invitation.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ message: 'Invitation already responded to' });
    }

    invitation.status = response;

    if (response === 'accepted') {
      // Check if team still has space
      const activeMembers = team.members.filter(m => m.status === 'active').length;
      if (activeMembers >= team.event.maxTeamSize) {
        return res.status(400).json({ message: 'Team is now full' });
      }

      // Check if user doesn't have a team in this event
      const existingTeam = await Team.findOne({
        event: team.event._id,
        'members.user': req.user._id,
        'members.status': 'active'
      });

      if (existingTeam) {
        return res.status(400).json({ message: 'You already have a team in this event' });
      }

      // Add user to team
      team.members.push({
        user: req.user._id,
        role: 'member',
        skills: req.user.profile.skills || [],
        joinedAt: new Date(),
        status: 'active'
      });

      // Add team to user's current teams
      req.user.currentTeams.push(team._id);
      await req.user.save();
    }

    await team.save();

    res.json({
      message: `Invitation ${response}`,
      team
    });
  } catch (error) {
    console.error('Respond to invitation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's invitations
router.get('/invitations/me', authMiddleware, async (req, res) => {
  try {
    const teams = await Team.find({
      'invitations.user': req.user._id,
      'invitations.status': 'pending'
    })
    .populate('leader', 'username profile.avatar')
    .populate('event', 'title startDate endDate')
    .populate('invitations.invitedBy', 'username');

    const invitations = [];
    teams.forEach(team => {
      team.invitations.forEach(inv => {
        if (inv.user.toString() === req.user._id.toString() && inv.status === 'pending') {
          invitations.push({
            _id: inv._id,
            team: {
              _id: team._id,
              name: team.name,
              description: team.description,
              leader: team.leader,
              event: team.event,
              memberCount: team.members.filter(m => m.status === 'active').length
            },
            invitedBy: inv.invitedBy,
            createdAt: inv.createdAt
          });
        }
      });
    });

    res.json({ invitations });
  } catch (error) {
    console.error('Get invitations error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add task to team project
router.post('/:id/tasks', authMiddleware, async (req, res) => {
  try {
    const { title, description, assignedTo, priority, deadline } = req.body;
    const team = await Team.findById(req.params.id);

    if (!team) {
      return res.status(404).json({ message: 'Team not found' });
    }

    // Check if user is team member
    const isMember = team.members.some(
      m => m.user.toString() === req.user._id.toString() && m.status === 'active'
    );

    if (!isMember) {
      return res.status(403).json({ message: 'Only team members can add tasks' });
    }

    if (!team.project) {
      team.project = { progress: { tasks: [], milestones: [] } };
    }

    const task = {
      title,
      description,
      assignedTo: assignedTo || req.user._id,
      priority: priority || 'medium',
      deadline,
      status: 'todo',
      createdAt: new Date()
    };

    team.project.progress.tasks.push(task);
    await team.save();

    await team.populate('project.progress.tasks.assignedTo', 'username profile.avatar');

    res.json({
      message: 'Task added successfully',
      task: team.project.progress.tasks[team.project.progress.tasks.length - 1]
    });
  } catch (error) {
    console.error('Add task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update task status
router.put('/:id/tasks/:taskId', authMiddleware, async (req, res) => {
  try {
    const { status, title, description, priority, assignedTo } = req.body;
    const team = await Team.findById(req.params.id);

    if (!team) {
      return res.status(404).json({ message: 'Team not found' });
    }

    const isMember = team.members.some(
      m => m.user.toString() === req.user._id.toString() && m.status === 'active'
    );

    if (!isMember) {
      return res.status(403).json({ message: 'Only team members can update tasks' });
    }

    const task = team.project.progress.tasks.id(req.params.taskId);
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    if (status) task.status = status;
    if (title) task.title = title;
    if (description) task.description = description;
    if (priority) task.priority = priority;
    if (assignedTo) task.assignedTo = assignedTo;

    if (status === 'completed' && task.status !== 'completed') {
      task.completedAt = new Date();
    }

    await team.save();

    res.json({
      message: 'Task updated successfully',
      task
    });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete team
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);

    if (!team) {
      return res.status(404).json({ message: 'Team not found' });
    }

    if (team.leader.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only team leader can delete team' });
    }

    // Remove team from event
    await Event.findByIdAndUpdate(team.event, {
      $pull: { teams: team._id }
    });

    // Remove team from all members' current teams
    const memberIds = team.members.map(m => m.user);
    await User.updateMany(
      { _id: { $in: memberIds } },
      { $pull: { currentTeams: team._id } }
    );

    await Team.findByIdAndDelete(req.params.id);

    res.json({ message: 'Team deleted successfully' });
  } catch (error) {
    console.error('Delete team error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;