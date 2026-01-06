const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { Server } = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Database setup
const db = new sqlite3.Database('./forum.db', (err) => {
  if (err) console.error(err.message);
  console.log('Connected to SQLite database.');
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    email TEXT,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    content TEXT,
    image TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    receiver_id INTEGER,
    content TEXT,
    image TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  )`);

  // Add profile_image column if not exists
  db.run(`ALTER TABLE users ADD COLUMN profile_image TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding profile_image column:', err.message);
    }
  });
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'lrms-forum-secret',
  resave: false,
  saveUninitialized: true
}));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.redirect('/login');
  }
}

function requireAdmin(req, res, next) {
  if (req.session.role === 'admin') {
    next();
  } else {
    res.status(403).send('Access denied');
  }
}

// Routes
app.get('/', requireAuth, (req, res) => {
  db.all(`SELECT posts.*, users.username, users.profile_image FROM posts JOIN users ON posts.user_id = users.id ORDER BY created_at DESC`, [], (err, posts) => {
    if (err) return res.status(500).send(err.message);
    db.all(`SELECT id, username, profile_image FROM users WHERE id != ?`, [req.session.userId], (err, users) => {
      if (err) return res.status(500).send(err.message);
      res.render('index', { posts, users, user: req.session });
    });
  });
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
    if (err) return res.status(500).send(err.message);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.render('login', { error: 'Invalid credentials' });
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.profileImage = user.profile_image;
    res.redirect('/');
  });
});

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', upload.single('profileImage'), (req, res) => {
  const { username, password, email } = req.body;
  const profileImage = req.file ? req.file.filename : null;
  const hashedPassword = bcrypt.hashSync(password, 10);
  
  // Check if this is the first user
  db.get(`SELECT COUNT(*) as count FROM users`, [], (err, row) => {
    if (err) return res.render('register', { error: 'Database error' });
    
    const isFirstUser = row.count === 0;
    const role = isFirstUser ? 'admin' : 'user';
    
    db.run(`INSERT INTO users (username, password, email, profile_image, role) VALUES (?, ?, ?, ?, ?)`, [username, hashedPassword, email, profileImage, role], function(err) {
      if (err) return res.render('register', { error: 'Username already exists' });
      req.session.userId = this.lastID;
      req.session.username = username;
      req.session.role = role;
      req.session.profileImage = profileImage;
      res.redirect('/');
    });
  });
});

app.post('/post', requireAuth, upload.single('image'), (req, res) => {
  const { title, content } = req.body;
  const image = req.file ? req.file.filename : null;
  db.run(`INSERT INTO posts (user_id, title, content, image) VALUES (?, ?, ?, ?)`, [req.session.userId, title, content, image], (err) => {
    if (err) return res.status(500).send(err.message);
    res.redirect('/');
  });
});

app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  db.all(`SELECT * FROM users`, [], (err, users) => {
    if (err) return res.status(500).send(err.message);
    res.render('admin', { users });
  });
});

app.post('/admin/promote/:id', requireAuth, requireAdmin, (req, res) => {
  db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [req.params.id], (err) => {
    if (err) return res.status(500).send(err.message);
    res.redirect('/admin');
  });
});

app.get('/dm/:id', requireAuth, (req, res) => {
  const receiverId = req.params.id;
  db.get(`SELECT * FROM users WHERE id = ?`, [receiverId], (err, user) => {
    if (err) return res.status(500).send(err.message);
    if (!user) return res.status(404).send('User not found');
    db.all(`SELECT messages.*, users.username, users.profile_image FROM messages 
            JOIN users ON messages.sender_id = users.id 
            WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) 
            ORDER BY created_at ASC`, [req.session.userId, receiverId, receiverId, req.session.userId], (err, messages) => {
      if (err) return res.status(500).send(err.message);
      res.render('dm', { messages, receiver: user, user: req.session });
    });
  });
});

app.post('/dm/:id', requireAuth, upload.single('image'), (req, res) => {
  const receiverId = req.params.id;
  db.get(`SELECT id FROM users WHERE id = ?`, [receiverId], (err, user) => {
    if (err) return res.status(500).send(err.message);
    if (!user) return res.status(404).send('User not found');
    const { content } = req.body;
    const image = req.file ? req.file.filename : null;
    db.run(`INSERT INTO messages (sender_id, receiver_id, content, image) VALUES (?, ?, ?, ?)`, [req.session.userId, receiverId, content, image], (err) => {
      if (err) return res.status(500).send(err.message);
      res.redirect(`/dm/${receiverId}`);
    });
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Socket.io for real-time DMs
io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    socket.join(userId);
  });

  socket.on('sendMessage', (data) => {
    const { senderId, receiverId, content, image } = data;
    db.run(`INSERT INTO messages (sender_id, receiver_id, content, image) VALUES (?, ?, ?, ?)`, [senderId, receiverId, content, image], (err) => {
      if (err) console.error(err);
      io.to(receiverId).emit('newMessage', { senderId, content, image });
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});