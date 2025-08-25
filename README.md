# Virtual Hackathon / Game Jam Platform

[![Watch Demo](https://img.youtube.com/vi/YOUTUBE_VIDEO_ID/0.jpg)](https://www.youtube.com/watch?v=YOUTUBE_VIDEO_ID)

## Overview

The **Virtual Hackathon / Game Jam Platform** is a web-based application that allows users to participate in timed coding events or game jams, submit their projects, vote on submissions, and interact with other participants in real-time.

It is designed to bring hackathon experiences online, providing collaboration, competition, and engagement features for developers and creators worldwide.

---

## Features

- **Real-time Leaderboard**: Tracks participants’ points and ranks dynamically as votes are submitted.
- **Chat and Collaboration Rooms**: Participants can communicate, discuss ideas, and form teams during the event.
- **Automated Judging**: Projects are automatically evaluated based on submission metadata (e.g., time, completeness, and criteria).
- **User Authentication**: Secure login/signup system for participants.
- **Event Management**: Admins can create events with start/end times, rules, and submission criteria.
- **Project Submission**: Users can submit their projects, upload files, and provide descriptions.
- **Voting System**: Participants and/or judges can vote for submissions.
- **Notifications**: Users receive updates about event progress and leaderboard changes in real-time.

---

## Tech Stack

| Layer | Technology | Description |
|-------|-----------|-------------|
| Frontend | **React.js** | Dynamic user interface, responsive design, real-time updates using WebSockets. |
| Backend | **Node.js + Express.js** | REST API for handling authentication, project submissions, voting, and event management. |
| Database | **MongoDB** | NoSQL database to store user data, projects, votes, and event metadata. |
| Real-time | **WebSockets / Socket.IO** | Enables live updates for leaderboards, chat, and notifications. |

---

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/virtual-hackathon-platform.git
   cd virtual-hackathon-platform
