const express = require('express');
const router = express.Router();

// For now, chat is handled by socket.io. This is a placeholder.
router.get('/', (req, res) => {
  res.json({ message: 'Chat is real-time via sockets.' });
});

module.exports = router;