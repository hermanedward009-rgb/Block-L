const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const cookieSession = require('cookie-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const onVercel = process.env.VERCEL === '1';
const dataDir = onVercel ? '/tmp' : __dirname;

// Ensure uploads directory exists
const uploadDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Multer config for profile images, payment screenshots & chat media
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

app.set('trust proxy', 1);

// Signed cookie sessions so auth survives Vercel’s serverless routing (memory sessions do not).
const sessionSecret = process.env.SESSION_SECRET || 'block_l_super_secret_key_2026';
app.use(
  cookieSession({
    name: 'block_l_sess',
    keys: [sessionSecret],
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: onVercel || process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  })
);

// Initialize SQLite Database. Vercel’s filesystem is read-only except /tmp.
const dbPath = path.join(dataDir, 'block_l.db');
if (onVercel && !fs.existsSync(dbPath)) {
  const bundledDb = path.join(__dirname, 'block_l.db');
  if (fs.existsSync(bundledDb)) fs.copyFileSync(bundledDb, dbPath);
}
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    second_name TEXT NOT NULL,
    username TEXT UNIQUE,
    phone TEXT UNIQUE NOT NULL,
    room TEXT,
    role TEXT DEFAULT 'resident',
    status TEXT DEFAULT 'pending',
    avatar TEXT NOT NULL,
    password_hash TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER, -- NULL means Block L Group Chat
    content TEXT NOT NULL,
    media_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Add media_url column safely if upgrading an existing block_l.db
  db.run(`ALTER TABLE messages ADD COLUMN media_url TEXT`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS toilet_schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_name TEXT NOT NULL,
    toilet_type TEXT NOT NULL, -- 'Large Toilet' or 'Small Toilet'
    assigned_user_id INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS electricity_bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    payer_name TEXT NOT NULL,
    amount REAL NOT NULL,
    token TEXT NOT NULL,
    screenshot TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending' or 'approved'
    round_number INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id INTEGER NOT NULL,
    type TEXT NOT NULL, -- 'announcement' or 'advice'
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, -- NULL means broadcast to all approved users
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Seed ONLY the 2 required accounts if database is empty
  db.get(`SELECT COUNT(*) AS count FROM users`, (err, row) => {
    if (row && row.count === 0) {
      const adminHash = bcrypt.hashSync('Admin@BlockL2026', 10);
      const residentHash = bcrypt.hashSync('Resident@123', 10);

      // Default SVG data URLs so accounts work immediately without external files
      const defaultAdminAvatar = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="%234f46e5"/><text x="50%" y="54%" font-size="44" font-family="Arial" fill="white" text-anchor="middle" dominant-baseline="middle">AD</text></svg>';
      const defaultResAvatar = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="%230ea5e9"/><text x="50%" y="54%" font-size="44" font-family="Arial" fill="white" text-anchor="middle" dominant-baseline="middle">JM</text></svg>';

      db.run(
        `INSERT INTO users (first_name, second_name, username, phone, room, role, status, avatar, password_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['Block L', 'Administrator', 'admin_blockl', '0700000000', 'ADMIN', 'admin', 'approved', defaultAdminAvatar, adminHash]
      );

      db.run(
        `INSERT INTO users (first_name, second_name, username, phone, room, role, status, avatar, password_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['Juma', 'Mushi', '0712345678', '0712345678', 'R-01', 'resident', 'approved', defaultResAvatar, residentHash]
      );

      // Seed permanent weekly schedule slots
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const toilets = ['Large Toilet', 'Small Toilet'];
      days.forEach((day, idx) => {
        toilets.forEach((toilet) => {
          const assigned = (idx === 0 && toilet === 'Large Toilet') ? 2 : null;
          db.run(`INSERT INTO toilet_schedule (day_name, toilet_type, assigned_user_id) VALUES (?, ?, ?)`, [day, toilet, assigned]);
        });
      });

      db.run(`INSERT INTO notifications (user_id, message) VALUES (NULL, 'Welcome to Block L Management System.')`);
    }
  });
});

// Socket.io Real-Time Connection
io.on('connection', (socket) => {
  socket.on('join_block', () => {
    socket.join('block_l');
  });
});

// Middleware
function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.userId || req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// --- AUTH ROUTES ---

// Login (Auto-detects Admin vs Resident)
app.post('/api/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Enter your credentials.' });
  }

  db.get(
    `SELECT * FROM users WHERE username = ? OR phone = ?`,
    [identifier.trim(), identifier.trim()],
    (err, user) => {
      if (err || !user) return res.status(401).json({ error: 'Invalid credentials.' });
      if (!bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
      if (user.status !== 'approved') {
        return res.status(403).json({ error: 'Account awaiting Admin approval.' });
      }

      req.session.userId = user.id;
      req.session.role = user.role;
      res.json({ success: true, role: user.role });
    }
  );
});

// Register (Enforces 10-digit phone, mandatory image, max 2 members per room R-01..R-10)
app.post('/api/register', upload.single('avatar'), (req, res) => {
  const { first_name, second_name, phone, room, password } = req.body;
  const validRooms = ['R-01','R-02','R-03','R-04','R-05','R-06','R-07','R-08','R-09','R-10'];

  if (!first_name || !second_name || !phone || !room || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (!/^\d{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Phone number must be exactly 10 digits.' });
  }
  if (!validRooms.includes(room)) {
    return res.status(400).json({ error: 'Invalid room selection.' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Profile image is mandatory.' });
  }

  // Check room occupancy (approved + pending cannot exceed 2)
  db.get(
    `SELECT COUNT(*) AS count FROM users WHERE room = ? AND role = 'resident' AND status IN ('approved', 'pending')`,
    [room],
    (err, row) => {
      if (row && row.count >= 2) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: `Room ${room} is already full (Max 2 members).` });
      }

      const hash = bcrypt.hashSync(password, 10);
      const avatarUrl = `/uploads/${req.file.filename}`;

      db.run(
        `INSERT INTO users (first_name, second_name, username, phone, room, role, status, avatar, password_hash)
         VALUES (?, ?, ?, ?, ?, 'resident', 'pending', ?, ?)`,
        [first_name.trim(), second_name.trim(), phone.trim(), phone.trim(), room, avatarUrl, hash],
        function (insertErr) {
          if (insertErr) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Phone number is already registered.' });
          }
          db.run(`INSERT INTO notifications (user_id, message) VALUES (1, ?)`, [
            `New registration from ${first_name} ${second_name} (${room}) awaits approval.`
          ]);
          io.to('block_l').emit('notification:new');
          res.json({ success: true, message: 'Registration submitted. Wait for Admin approval.' });
        }
      );
    }
  );
});

// Forgot Password
app.post('/api/forgot-password', (req, res) => {
  const { phone, room, new_password } = req.body;
  if (!phone || !room || !new_password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  db.get(`SELECT * FROM users WHERE phone = ? AND room = ?`, [phone.trim(), room.trim()], (err, user) => {
    if (!user) return res.status(404).json({ error: 'No matching account found.' });
    const hash = bcrypt.hashSync(new_password, 10);
    db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, user.id], () => {
      res.json({ success: true, message: 'Password updated. You can now sign in.' });
    });
  });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ success: true });
});

// Room availability endpoint for registration dropdown
app.get('/api/rooms-availability', (req, res) => {
  const rooms = ['R-01','R-02','R-03','R-04','R-05','R-06','R-07','R-08','R-09','R-10'];
  db.all(
    `SELECT room, COUNT(*) AS count FROM users WHERE role = 'resident' AND status IN ('approved', 'pending') GROUP BY room`,
    [],
    (err, rows) => {
      const map = {};
      (rows || []).forEach(r => (map[r.room] = r.count));
      res.json(rooms.map(r => ({ room: r, count: map[r] || 0, full: (map[r] || 0) >= 2 })));
    }
  );
});

// --- USER & PROFILE ROUTES ---

app.get('/api/me', requireAuth, (req, res) => {
  db.get(
    `SELECT id, first_name, second_name, username, phone, room, role, status, avatar FROM users WHERE id = ?`,
    [req.session.userId],
    (err, user) => res.json(user)
  );
});

// Update profile details & profile picture
app.post('/api/profile/update', requireAuth, upload.single('avatar'), (req, res) => {
  const { first_name, second_name, phone } = req.body;
  if (!/^\d{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Phone number must be 10 digits.' });
  }

  if (req.file) {
    const avatarUrl = `/uploads/${req.file.filename}`;
    db.run(
      `UPDATE users SET first_name = ?, second_name = ?, phone = ?, avatar = ? WHERE id = ?`,
      [first_name.trim(), second_name.trim(), phone.trim(), avatarUrl, req.session.userId],
      (err) => {
        if (err) return res.status(400).json({ error: 'Phone already in use.' });
        res.json({ success: true, avatar: avatarUrl });
      }
    );
  } else {
    db.run(
      `UPDATE users SET first_name = ?, second_name = ?, phone = ? WHERE id = ?`,
      [first_name.trim(), second_name.trim(), phone.trim(), req.session.userId],
      (err) => {
        if (err) return res.status(400).json({ error: 'Phone already in use.' });
        res.json({ success: true });
      }
    );
  }
});

// All approved members (including Admin)
app.get('/api/members', requireAuth, (req, res) => {
  db.all(
    `SELECT id, first_name, second_name, phone, room, role, status, avatar FROM users WHERE status = 'approved' ORDER BY role DESC, room ASC`,
    [],
    (err, rows) => res.json(rows || [])
  );
});

// Pending users (Admin only)
app.get('/api/admin/pending-users', requireAdmin, (req, res) => {
  db.all(`SELECT id, first_name, second_name, phone, room, avatar FROM users WHERE status = 'pending'`, [], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/admin/approve-user/:id', requireAdmin, (req, res) => {
  const { action } = req.body; // 'approve' or 'reject'
  const status = action === 'approve' ? 'approved' : 'rejected';
  db.run(`UPDATE users SET status = ? WHERE id = ?`, [status, req.params.id], () => {
    db.run(`INSERT INTO notifications (user_id, message) VALUES (NULL, ?)`, [
      `Resident registration has been ${status} by Admin.`
    ]);
    io.to('block_l').emit('notification:new');
    res.json({ success: true });
  });
});

// Admin: Fetch all accounts (approved, pending, rejected)
app.get('/api/admin/all-accounts', requireAdmin, (req, res) => {
  db.all(
    `SELECT id, first_name, second_name, username, phone, room, role, status, avatar FROM users ORDER BY role DESC, room ASC, id ASC`,
    [],
    (err, rows) => res.json(rows || [])
  );
});

// Admin: Edit any account's details, room (max 2), role, status, or password
app.put('/api/admin/accounts/:id', requireAdmin, (req, res) => {
  const { first_name, second_name, phone, room, role, status, password } = req.body;
  const validRooms = ['R-01','R-02','R-03','R-04','R-05','R-06','R-07','R-08','R-09','R-10','ADMIN'];

  if (!first_name || !second_name || !phone) {
    return res.status(400).json({ error: 'First name, second name, and phone are required.' });
  }
  if (!/^\d{10}$/.test(phone.trim())) {
    return res.status(400).json({ error: 'Phone number must be exactly 10 digits.' });
  }
  if (!validRooms.includes(room)) {
    return res.status(400).json({ error: 'Invalid room selection.' });
  }

  const applyUpdate = () => {
    const cleanFirst = first_name.trim();
    const cleanSecond = second_name.trim();
    const cleanPhone = phone.trim();

    if (password && password.trim().length > 0) {
      const hash = bcrypt.hashSync(password.trim(), 10);
      db.run(
        `UPDATE users SET first_name = ?, second_name = ?, phone = ?, username = ?, room = ?, role = ?, status = ?, password_hash = ? WHERE id = ?`,
        [cleanFirst, cleanSecond, cleanPhone, cleanPhone, room, role, status, hash, req.params.id],
        function (err) {
          if (err) return res.status(400).json({ error: 'Phone number already exists on another account.' });
          io.to('block_l').emit('notification:new');
          res.json({ success: true });
        }
      );
    } else {
      db.run(
        `UPDATE users SET first_name = ?, second_name = ?, phone = ?, username = ?, room = ?, role = ?, status = ? WHERE id = ?`,
        [cleanFirst, cleanSecond, cleanPhone, cleanPhone, room, role, status, req.params.id],
        function (err) {
          if (err) return res.status(400).json({ error: 'Phone number already exists on another account.' });
          io.to('block_l').emit('notification:new');
          res.json({ success: true });
        }
      );
    }
  };

  if (role === 'resident' && room !== 'ADMIN' && status !== 'rejected') {
    db.get(
      `SELECT COUNT(*) AS count FROM users WHERE room = ? AND role = 'resident' AND status != 'rejected' AND id != ?`,
      [room, req.params.id],
      (err, row) => {
        if (row && row.count >= 2) {
          return res.status(400).json({ error: `${room} already has 2 members.` });
        }
        applyUpdate();
      }
    );
  } else {
    applyUpdate();
  }
});

// Admin: Delete a resident account
app.delete('/api/admin/accounts/:id', requireAdmin, (req, res) => {
  db.run(`DELETE FROM users WHERE id = ? AND role != 'admin'`, [req.params.id], function () {
    if (this.changes === 0) return res.status(404).json({ error: 'Account not found or cannot be deleted.' });
    res.json({ success: true });
  });
});

// Admin: Reassign resident room (enforces max 2 per room)
app.patch('/api/admin/residents/:id/room', requireAdmin, (req, res) => {
  const { room } = req.body;
  const validRooms = ['R-01','R-02','R-03','R-04','R-05','R-06','R-07','R-08','R-09','R-10'];
  if (!validRooms.includes(room)) {
    return res.status(400).json({ error: 'Invalid room number.' });
  }

  db.get(
    `SELECT COUNT(*) AS count FROM users WHERE room = ? AND role = 'resident' AND status = 'approved' AND id != ?`,
    [room, req.params.id],
    (err, row) => {
      if (row && row.count >= 2) {
        return res.status(400).json({ error: `${room} already has 2 residents.` });
      }
      db.run(`UPDATE users SET room = ? WHERE id = ? AND role = 'resident'`, [room, req.params.id], () => {
        db.run(`INSERT INTO notifications (user_id, message) VALUES (NULL, ?)`, [`Room assignment updated to ${room}.`]);
        io.to('block_l').emit('notification:new');
        res.json({ success: true });
      });
    }
  );
});

// Admin: Remove a resident account
app.delete('/api/admin/residents/:id', requireAdmin, (req, res) => {
  db.run(`DELETE FROM users WHERE id = ? AND role = 'resident'`, [req.params.id], function () {
    if (this.changes === 0) return res.status(404).json({ error: 'Resident not found.' });
    res.json({ success: true });
  });
});

// --- CHAT ROUTES ---

app.get('/api/messages', requireAuth, (req, res) => {
  const peerId = req.query.peerId;
  const me = req.session.userId;

  if (!peerId || peerId === 'group') {
    db.all(
      `SELECT m.*, u.first_name, u.second_name, u.room, u.role, u.avatar
       FROM messages m JOIN users u ON m.sender_id = u.id
       WHERE m.receiver_id IS NULL ORDER BY m.id ASC`,
      [],
      (err, rows) => res.json(rows || [])
    );
  } else {
    db.all(
      `SELECT m.*, u.first_name, u.second_name, u.room, u.role, u.avatar
       FROM messages m JOIN users u ON m.sender_id = u.id
       WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
       ORDER BY m.id ASC`,
      [me, peerId, peerId, me],
      (err, rows) => res.json(rows || [])
    );
  }
});

app.post('/api/messages', requireAuth, upload.single('media'), (req, res) => {
  const { receiver_id, content } = req.body;
  const cleanText = (content || '').trim();
  const mediaUrl = req.file ? `/uploads/${req.file.filename}` : null;

  if (!cleanText && !mediaUrl) {
    return res.status(400).json({ error: 'Message text or media file required.' });
  }

  const target = !receiver_id || receiver_id === 'group' ? null : Number(receiver_id);
  db.run(
    `INSERT INTO messages (sender_id, receiver_id, content, media_url) VALUES (?, ?, ?, ?)`,
    [req.session.userId, target, cleanText, mediaUrl],
    function () {
      db.get(
        `SELECT m.*, u.first_name, u.second_name, u.room, u.role, u.avatar
         FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?`,
        [this.lastID],
        (err, row) => {
          if (row) io.to('block_l').emit('chat:message', row);
          res.json({ success: true, message: row });
        }
      );
    }
  );
});

// --- TOILET SCHEDULE ROUTES ---

app.get('/api/schedule', requireAuth, (req, res) => {
  db.all(
    `SELECT s.*, u.first_name, u.second_name, u.room, u.avatar
     FROM toilet_schedule s LEFT JOIN users u ON s.assigned_user_id = u.id
     ORDER BY s.id ASC`,
    [],
    (err, rows) => res.json(rows || [])
  );
});

app.post('/api/schedule/assign', requireAdmin, (req, res) => {
  const { schedule_id, user_id } = req.body;
  db.run(
    `UPDATE toilet_schedule SET assigned_user_id = ? WHERE id = ?`,
    [user_id || null, schedule_id],
    () => {
      db.run(`INSERT INTO notifications (user_id, message) VALUES (NULL, 'Toilet cleaning timetable updated by Admin.')`);
      io.to('block_l').emit('notification:new');
      res.json({ success: true });
    }
  );
});

// --- ELECTRICITY ROUTES ---

app.get('/api/electricity', requireAuth, (req, res) => {
  db.all(`SELECT * FROM electricity_bills ORDER BY id DESC`, [], (err, bills) => {
    const currentRound = bills && bills.length ? Math.max(...bills.map(b => b.round_number)) : 1;
    const paidRooms = new Set(
      (bills || []).filter(b => b.round_number === currentRound && b.status === 'approved').map(b => b.room)
    );
    const remainingCount = 10 - paidRooms.size;

    res.json({
      currentRound,
      bills: bills || [],
      paidRooms: Array.from(paidRooms),
      remainingCount,
      reminderActive: remainingCount <= 5 && remainingCount > 0
    });
  });
});

app.post('/api/electricity', requireAuth, upload.single('screenshot'), (req, res) => {
  const { payer_name, amount, room, token } = req.body;
  if (!payer_name || !amount || !room || !token || !req.file) {
    return res.status(400).json({ error: 'All fields and transaction screenshot are required.' });
  }

  db.get(`SELECT MAX(round_number) AS r FROM electricity_bills`, [], (err, row) => {
    const round = (row && row.r) || 1;
    const screenshotUrl = `/uploads/${req.file.filename}`;

    db.run(
      `INSERT INTO electricity_bills (room, payer_name, amount, token, screenshot, status, round_number)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [room, payer_name.trim(), amount, token.trim(), screenshotUrl, round],
      () => {
        db.run(`INSERT INTO notifications (user_id, message) VALUES (1, ?)`, [
          `Electricity payment submitted for ${room} by ${payer_name}.`
        ]);
        io.to('block_l').emit('notification:new');
        res.json({ success: true });
      }
    );
  });
});

app.post('/api/electricity/approve/:id', requireAdmin, (req, res) => {
  db.run(`UPDATE electricity_bills SET status = 'approved' WHERE id = ?`, [req.params.id], () => {
    // Check if 5 rooms remain and trigger reminder notification
    db.all(`SELECT * FROM electricity_bills WHERE status = 'approved'`, [], (err, bills) => {
      const currentRound = bills.length ? Math.max(...bills.map(b => b.round_number)) : 1;
      const paidSet = new Set(bills.filter(b => b.round_number === currentRound).map(b => b.room));
      const remaining = 10 - paidSet.size;

      if (remaining === 5) {
        db.run(`INSERT INTO notifications (user_id, message) VALUES (NULL, ?)`, [
          `REMINDER: Only 5 rooms remain to complete Electricity Round #${currentRound}!`
        ]);
      } else if (remaining === 0) {
        db.run(`INSERT INTO notifications (user_id, message) VALUES (NULL, ?)`, [
          `All 10 rooms have paid for Round #${currentRound}! Ready for next round.`
        ]);
      }
      io.to('block_l').emit('notification:new');
      res.json({ success: true });
    });
  });
});

app.post('/api/electricity/next-round', requireAdmin, (req, res) => {
  db.get(`SELECT MAX(round_number) AS r FROM electricity_bills`, [], (err, row) => {
    const nextRound = ((row && row.r) || 1) + 1;
    db.run(
      `INSERT INTO electricity_bills (room, payer_name, amount, token, screenshot, status, round_number)
       VALUES ('SYSTEM', 'Round Initialized', 0, 'N/A', '', 'system', ?)`,
      [nextRound],
      () => {
        db.run(`INSERT INTO notifications (user_id, message) VALUES (NULL, ?)`, [
          `Electricity Round #${nextRound} has officially started.`
        ]);
        io.to('block_l').emit('notification:new');
        res.json({ success: true });
      }
    );
  });
});

// --- ANNOUNCEMENTS & ADVICE ROUTES ---

app.get('/api/posts', requireAuth, (req, res) => {
  db.all(
    `SELECT p.*, u.first_name, u.second_name, u.room, u.role, u.avatar
     FROM posts p JOIN users u ON p.author_id = u.id ORDER BY p.id DESC`,
    [],
    (err, rows) => res.json(rows || [])
  );
});

app.post('/api/posts', requireAuth, (req, res) => {
  const { type, title, body } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and message are required.' });

  // Strict security: Residents CANNOT create announcements
  if (type === 'announcement' && req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Only Admin can post announcements.' });
  }

  db.run(
    `INSERT INTO posts (author_id, type, title, body) VALUES (?, ?, ?, ?)`,
    [req.session.userId, type, title.trim(), body.trim()],
    () => {
      if (type === 'announcement') {
        db.run(`INSERT INTO notifications (user_id, message) VALUES (NULL, ?)`, [
          `New Admin Announcement: ${title.trim()}`
        ]);
        io.to('block_l').emit('notification:new');
      }
      res.json({ success: true });
    }
  );
});

// --- NOTIFICATIONS ---

app.get('/api/notifications', requireAuth, (req, res) => {
  db.all(
    `SELECT * FROM notifications WHERE user_id IS NULL OR user_id = ? ORDER BY id DESC LIMIT 15`,
    [req.session.userId],
    (err, rows) => res.json(rows || [])
  );
});

if (!onVercel) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Block L System running on http://localhost:${PORT}`);
  });
}

module.exports = server;