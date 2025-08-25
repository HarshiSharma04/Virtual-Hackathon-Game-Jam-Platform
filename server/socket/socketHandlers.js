const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Event = require('../models/Event');
const Team = require('../models/Team');

const connectedUsers = new Map();

const socketHandlers = (io, socket) => {
  // Authentication
  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId);
      
      if (user) {
        socket.userId = user._id.toString();
        socket.user = user;
        connectedUsers.set(socket.userId, {
          socketId: socket.id,
          user: user,
          lastActive: new Date()
        });
        
        // Update user online status
        await User.findByIdAndUpdate(user._id, { 
          isOnline: true, 
          lastActive: new Date() 
        });
        
        socket.emit('authenticated', { user });
        io.emit('userStatusUpdate', { userId: user._id, isOnline: true });
        
        console.log(`User ${user.username} authenticated and connected`);
      }
    } catch (error) {
      socket.emit('authError', { message: 'Authentication failed' });
    }
  });

  // Join event room
  socket.on('joinEvent', async (eventId) => {
    try {
      const event = await Event.findById(eventId);
      if (event) {
        socket.join(`event:${eventId}`);
        socket.eventId = eventId;
        
        // Send real-time event data
        const eventData = await Event.findById(eventId)
          .populate('participants.user', 'username profile.avatar')
          .populate('teams', 'name members')
          .populate('submissions', 'project.name judging.totalScore');
        
        socket.emit('eventJoined', { event: eventData });
        
        // Notify others in the event
        socket.to(`event:${eventId}`).emit('userJoinedEvent', {
          user: socket.user,
          timestamp: new Date()
        });
      }
    } catch (error) {
      socket.emit('error', { message: 'Failed to join event' });
    }
  });

  // Leave event room
  socket.on('leaveEvent', (eventId) => {
    socket.leave(`event:${eventId}`);
    socket.to(`event:${eventId}`).emit('userLeftEvent', {
      user: socket.user,
      timestamp: new Date()
    });
  });

  // Join team room
  socket.on('joinTeam', async (teamId) => {
    try {
      const team = await Team.findById(teamId)
        .populate('members.user', 'username profile.avatar')
        .populate('leader', 'username profile.avatar');
      
      if (team) {
        socket.join(`team:${teamId}`);
        socket.teamId = teamId;
        
        socket.emit('teamJoined', { team });
        socket.to(`team:${teamId}`).emit('userJoinedTeam', {
          user: socket.user,
          timestamp: new Date()
        });
      }
    } catch (error) {
      socket.emit('error', { message: 'Failed to join team' });
    }
  });

  // Team chat
  socket.on('teamMessage', async (data) => {
    try {
      const { teamId, message, type = 'text' } = data;
      
      const team = await Team.findById(teamId);
      if (!team) return;
      
      const newMessage = {
        user: socket.userId,
        message,
        type,
        timestamp: new Date()
      };
      
      team.communication.chatRoom.messages.push(newMessage);
      await team.save();
      
      // Populate user data for the message
      await team.populate('communication.chatRoom.messages.user', 'username profile.avatar');
      const populatedMessage = team.communication.chatRoom.messages[team.communication.chatRoom.messages.length - 1];
      
      io.to(`team:${teamId}`).emit('newTeamMessage', {
        teamId,
        message: populatedMessage
      });
    } catch (error) {
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Event chat
  socket.on('eventMessage', async (data) => {
    try {
      const { eventId, message, roomType = 'general' } = data;
      
      const event = await Event.findById(eventId);
      if (!event) return;
      
      let chatRoom = event.chatRooms.find(room => room.type === roomType);
      if (!chatRoom) {
        chatRoom = {
          name: roomType,
          type: roomType,
          messages: []
        };
        event.chatRooms.push(chatRoom);
      }
      
      const newMessage = {
        user: socket.userId,
        message,
        timestamp: new Date()
      };
      
      chatRoom.messages.push(newMessage);
      await event.save();
      
      // Populate user data
      await event.populate('chatRooms.messages.user', 'username profile.avatar');
      const populatedMessage = chatRoom.messages[chatRoom.messages.length - 1];
      
      io.to(`event:${eventId}`).emit('newEventMessage', {
        eventId,
        roomType,
        message: populatedMessage
      });
    } catch (error) {
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Real-time leaderboard updates
  socket.on('requestLeaderboard', async (eventId) => {
    try {
      const event = await Event.findById(eventId)
        .populate({
          path: 'leaderboard.team',
          populate: {
            path: 'members.user',
            select: 'username profile.avatar'
          }
        })
        .populate('leaderboard.submission', 'project.name judging.totalScore');
      
      if (event) {
        socket.emit('leaderboardUpdate', {
          eventId,
          leaderboard: event.leaderboard
        });
      }
    } catch (error) {
      socket.emit('error', { message: 'Failed to get leaderboard' });
    }
  });

  // Task updates
  socket.on('updateTask', async (data) => {
    try {
      const { teamId, taskId, updates } = data;
      
      const team = await Team.findById(teamId);
      if (!team) return;
      
      const task = team.project.progress.tasks.id(taskId);
      if (!task) return;
      
      Object.assign(task, updates);
      if (updates.status === 'completed') {
        task.completedAt = new Date();
      }
      
      await team.save();
      
      io.to(`team:${teamId}`).emit('taskUpdated', {
        teamId,
        task,
        updatedBy: socket.user
      });
    } catch (error) {
      socket.emit('error', { message: 'Failed to update task' });
    }
  });

  // Live submission updates
  socket.on('submissionUpdate', async (data) => {
    try {
      const { eventId, submission } = data;
      
      io.to(`event:${eventId}`).emit('submissionUpdated', {
        eventId,
        submission,
        timestamp: new Date()
      });
    } catch (error) {
      socket.emit('error', { message: 'Failed to update submission' });
    }
  });

  // Voting updates
  socket.on('vote', async (data) => {
    try {
      const { submissionId, score } = data;
      
      // Update submission vote in database
      // This would be handled by the API route, but we can emit real-time updates
      
      io.emit('voteUpdate', {
        submissionId,
        score,
        voter: socket.user.username
      });
    } catch (error) {
      socket.emit('error', { message: 'Failed to submit vote' });
    }
  });

  // Team formation notifications
  socket.on('teamInvite', async (data) => {
    try {
      const { teamId, inviteeId } = data;
      
      const inviteeSocket = Array.from(connectedUsers.values())
        .find(user => user.user._id.toString() === inviteeId);
      
      if (inviteeSocket) {
        io.to(inviteeSocket.socketId).emit('teamInviteReceived', {
          teamId,
          from: socket.user,
          timestamp: new Date()
        });
      }
    } catch (error) {
      socket.emit('error', { message: 'Failed to send invite' });
    }
  });

  // Live event status updates
  socket.on('eventStatusChange', async (data) => {
    try {
      const { eventId, status } = data;
      
      io.to(`event:${eventId}`).emit('eventStatusChanged', {
        eventId,
        status,
        timestamp: new Date()
      });
    } catch (error) {
      socket.emit('error', { message: 'Failed to update event status' });
    }
  });

  // Typing indicators
  socket.on('typing', (data) => {
    const { roomType, roomId } = data;
    socket.to(`${roomType}:${roomId}`).emit('userTyping', {
      user: socket.user,
      timestamp: new Date()
    });
  });

  socket.on('stopTyping', (data) => {
    const { roomType, roomId } = data;
    socket.to(`${roomType}:${roomId}`).emit('userStoppedTyping', {
      user: socket.user
    });
  });

  // Disconnect handling
  socket.on('disconnect', async () => {
    if (socket.userId) {
      connectedUsers.delete(socket.userId);
      
      // Update user offline status
      await User.findByIdAndUpdate(socket.userId, { 
        isOnline: false, 
        lastActive: new Date() 
      });
      
      // Notify all rooms about user going offline
      io.emit('userStatusUpdate', { 
        userId: socket.userId, 
        isOnline: false 
      });
      
      console.log(`User ${socket.user?.username} disconnected`);
    }
  });

  // Heartbeat to keep connection alive
  socket.on('ping', () => {
    socket.emit('pong');
    
    if (socket.userId) {
      const user = connectedUsers.get(socket.userId);
      if (user) {
        user.lastActive = new Date();
      }
    }
  });
};

// Utility function to broadcast to all event participants
const broadcastToEvent = (io, eventId, event, data) => {
  io.to(`event:${eventId}`).emit(event, data);
};

// Utility function to broadcast to all team members
const broadcastToTeam = (io, teamId, event, data) => {
  io.to(`team:${teamId}`).emit(event, data);
};

module.exports = socketHandlers;