const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Create necessary directories
const dirs = ['uploads/videos', 'uploads/profiles', 'data'];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// File storage configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (file.fieldname === 'video') {
            cb(null, 'uploads/videos/');
        } else if (file.fieldname === 'profile') {
            cb(null, 'uploads/profiles/');
        }
    },
    filename: function (req, file, cb) {
        const uniqueName = uuidv4() + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'video') {
            if (file.mimetype.startsWith('video/')) {
                cb(null, true);
            } else {
                cb(new Error('Only video files are allowed'));
            }
        } else if (file.fieldname === 'profile') {
            if (file.mimetype.startsWith('image/')) {
                cb(null, true);
            } else {
                cb(new Error('Only image files are allowed'));
            }
        }
    }
});

// Data files
const USERS_FILE = 'data/users.json';
const VIDEOS_FILE = 'data/videos.json';
const LOGS_FILE = 'data/logs.json';

// Helper functions
function readJSONFile(filename) {
    try {
        if (fs.existsSync(filename)) {
            const data = fs.readFileSync(filename, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.error(`Error reading ${filename}:`, error);
        return [];
    }
}

function writeJSONFile(filename, data) {
    try {
        fs.writeFileSync(filename, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error writing ${filename}:`, error);
        return false;
    }
}

function logInteraction(action, userId, videoId = null, data = null) {
    const logs = readJSONFile(LOGS_FILE);
    const logEntry = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        userId: userId,
        action: action,
        videoId: videoId,
        data: data
    };
    
    logs.push(logEntry);
    
    // Keep only last 10000 entries
    if (logs.length > 10000) {
        logs.splice(0, logs.length - 10000);
    }
    
    writeJSONFile(LOGS_FILE, logs);
}

// API Routes

// Get all videos
app.get('/api/videos', (req, res) => {
    const videos = readJSONFile(VIDEOS_FILE);
    res.json(videos);
});

// Get video by ID
app.get('/api/videos/:id', (req, res) => {
    const videos = readJSONFile(VIDEOS_FILE);
    const video = videos.find(v => v.id === req.params.id);
    
    if (!video) {
        return res.status(404).json({ error: 'Video not found' });
    }
    
    res.json(video);
});

// Upload new video
app.post('/api/videos', upload.single('video'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No video file provided' });
        }
        
        const { description, username } = req.body;
        const videos = readJSONFile(VIDEOS_FILE);
        
        const newVideo = {
            id: uuidv4(),
            author: username,
            authorPic: `/uploads/profiles/${username}.jpg`, // Default or user profile
            description: description || '',
            videoSrc: `/uploads/videos/${req.file.filename}`,
            timestamp: new Date().toISOString(),
            likes: 0,
            comments: [],
            liked: false,
            views: 0
        };
        
        videos.unshift(newVideo);
        writeJSONFile(VIDEOS_FILE, videos);
        
        // Log the upload
        logInteraction('upload', username, newVideo.id);
        
        res.json({ success: true, video: newVideo });
    } catch (error) {
        console.error('Error uploading video:', error);
        res.status(500).json({ error: 'Failed to upload video' });
    }
});

// Like/Unlike video
app.post('/api/videos/:id/like', (req, res) => {
    const { username } = req.body;
    const videos = readJSONFile(VIDEOS_FILE);
    const video = videos.find(v => v.id === req.params.id);
    
    if (!video) {
        return res.status(404).json({ error: 'Video not found' });
    }
    
    // Toggle like
    video.liked = !video.liked;
    video.likes += video.liked ? 1 : -1;
    
    writeJSONFile(VIDEOS_FILE, videos);
    
    // Log the interaction
    logInteraction('like', username, video.id, video.liked);
    
    res.json({ success: true, liked: video.liked, likes: video.likes });
});

// Add comment to video
app.post('/api/videos/:id/comment', (req, res) => {
    const { username, text, userPic } = req.body;
    const videos = readJSONFile(VIDEOS_FILE);
    const video = videos.find(v => v.id === req.params.id);
    
    if (!video) {
        return res.status(404).json({ error: 'Video not found' });
    }
    
    const newComment = {
        id: uuidv4(),
        author: username,
        text: text,
        authorPic: userPic,
        timestamp: new Date().toISOString()
    };
    
    video.comments.push(newComment);
    writeJSONFile(VIDEOS_FILE, videos);
    
    // Log the interaction
    logInteraction('comment', username, video.id, text);
    
    res.json({ success: true, comment: newComment });
});

// Update user profile
app.post('/api/users/:username/profile', upload.single('profile'), (req, res) => {
    try {
        const { username } = req.params;
        const { newUsername } = req.body;
        
        const users = readJSONFile(USERS_FILE);
        let user = users.find(u => u.username === username);
        
        if (!user) {
            user = {
                id: uuidv4(),
                username: username,
                profilePic: '/uploads/profiles/default.jpg',
                joinDate: new Date().toISOString()
            };
            users.push(user);
        }
        
        // Update username if provided
        if (newUsername && newUsername !== username) {
            user.username = newUsername;
        }
        
        // Update profile picture if provided
        if (req.file) {
            user.profilePic = `/uploads/profiles/${req.file.filename}`;
        }
        
        writeJSONFile(USERS_FILE, users);
        
        // Log the update
        logInteraction('profile_update', user.username);
        
        res.json({ success: true, user: user });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// Get user profile
app.get('/api/users/:username', (req, res) => {
    const users = readJSONFile(USERS_FILE);
    const user = users.find(u => u.username === req.params.username);
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
});

// Get trending hashtags
app.get('/api/trending', (req, res) => {
    const videos = readJSONFile(VIDEOS_FILE);
    const hashtags = {};
    
    videos.forEach(video => {
        const tags = video.description.match(/#\w+/g) || [];
        tags.forEach(tag => {
            hashtags[tag] = (hashtags[tag] || 0) + 1;
        });
    });
    
    const trending = Object.entries(hashtags)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count }));
    
    res.json(trending);
});

// Get analytics/logs
app.get('/api/analytics', (req, res) => {
    const logs = readJSONFile(LOGS_FILE);
    const analytics = {
        totalInteractions: logs.length,
        actionCounts: {},
        userActivity: {},
        recentActivity: logs.slice(-100)
    };
    
    logs.forEach(log => {
        analytics.actionCounts[log.action] = (analytics.actionCounts[log.action] || 0) + 1;
        analytics.userActivity[log.userId] = (analytics.userActivity[log.userId] || 0) + 1;
    });
    
    res.json(analytics);
});

// Search videos
app.get('/api/search', (req, res) => {
    const { q } = req.query;
    const videos = readJSONFile(VIDEOS_FILE);
    
    if (!q) {
        return res.json([]);
    }
    
    const results = videos.filter(video =>
        video.description.toLowerCase().includes(q.toLowerCase()) ||
        video.author.toLowerCase().includes(q.toLowerCase())
    );
    
    res.json(results);
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`VidShare server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to use the app`);
    
    // Log server start
    logInteraction('server_start', 'system');
});

module.exports = app;
