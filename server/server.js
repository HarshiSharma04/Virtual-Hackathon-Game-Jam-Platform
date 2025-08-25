const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/events');
const teamRoutes = require('./routes/teams');
const submissionRoutes = require('./routes/submissions');
const leaderboardRoutes = require('./routes/leaderboard'); // Add this line
const socketHandlers = require('./socket/socketHandlers');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hackathon-platform', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  socketHandlers(io, socket);

  // Leaderboard (fetch from DB)
  socket.on('getLeaderboard', async () => {
    try {
      const Submission = require('./models/Submission');
      const leaderboard = await Submission.find().sort({ score: -1 }).limit(10);
      socket.emit('leaderboardUpdate', leaderboard);
    } catch (err) {
      socket.emit('leaderboardUpdate', []);
    }
  });

  // Chat
  socket.on('chatMessage', (msg) => {
    io.emit('chatMessage', msg);
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/leaderboard', leaderboardRoutes); // Add this line

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});