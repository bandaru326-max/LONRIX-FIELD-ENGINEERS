const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Serves index.html, styles.css, app.js directly

// Helper: Default permissions mapping
function getDefaultPermissions() {
  const permissions = {};
  for (let i = 1; i <= 10; i++) {
    permissions[`OP ${i}`] = true; // All operators are allowed to edit by default
  }
  return permissions;
}

// Helper: Read database file
function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = { records: [], permissions: getDefaultPermissions() };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
      return initial;
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    let parsed = JSON.parse(data || '{}');

    // Migration logic for old array-only format
    if (Array.isArray(parsed)) {
      parsed = {
        records: parsed,
        permissions: getDefaultPermissions()
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(parsed, null, 2), 'utf8');
    }

    if (!parsed.records) parsed.records = [];
    if (!parsed.permissions) parsed.permissions = getDefaultPermissions();

    return parsed;
  } catch (err) {
    console.error("Error reading database file:", err);
    return { records: [], permissions: getDefaultPermissions() };
  }
}

// Helper: Write database file
function writeDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error("Error writing to database file:", err);
    return false;
  }
}

// Helper: Get local network IPv4 address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIpAddress();

// Middleware: Authenticate Admin Role for restricted operations
function requireAdmin(req, res, next) {
  const roleHeader = req.headers['x-role'] || req.query.role;
  if (roleHeader === 'Admin') {
    next();
  } else {
    res.status(403).json({ error: "Access denied. Administrator privileges required." });
  }
}

// API: System Status and Networking
app.get('/api/status', (req, res) => {
  res.json({
    status: "online",
    ip: LOCAL_IP,
    port: PORT,
    sharingUrl: `http://${LOCAL_IP}:${PORT}`,
    uptime: process.uptime()
  });
});

// API: Get All Records
app.get('/api/records', (req, res) => {
  const db = readDb();
  res.json(db.records);
});

// API: Get Permissions Map
app.get('/api/permissions', (req, res) => {
  const db = readDb();
  res.json(db.permissions);
});

// API: Update Operator Permissions (Admin Only)
app.post('/api/permissions', requireAdmin, (req, res) => {
  const db = readDb();
  db.permissions = {
    ...db.permissions,
    ...req.body
  };

  if (writeDb(db)) {
    res.json({ success: true, permissions: db.permissions });
  } else {
    res.status(500).json({ error: "Failed to save permissions to database." });
  }
});

// API: Create a New Record
app.post('/api/records', (req, res) => {
  const db = readDb();
  const newRecord = {
    ...req.body,
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)
  };

  db.records.push(newRecord);
  if (writeDb(db)) {
    res.status(201).json(newRecord);
  } else {
    res.status(500).json({ error: "Failed to write record to database." });
  }
});

// API: Update an Existing Record
app.put('/api/records/:id', (req, res) => {
  const id = req.params.id;
  const db = readDb();
  const index = db.records.findIndex(r => r.id === id);

  if (index === -1) {
    return res.status(404).json({ error: "Record not found." });
  }

  db.records[index] = {
    ...req.body,
    id: id
  };

  if (writeDb(db)) {
    res.json(db.records[index]);
  } else {
    res.status(500).json({ error: "Failed to save updates to database." });
  }
});

// API: Delete a Record (Allowed for all but restricted to Admin via client permission rules)
app.delete('/api/records/:id', (req, res) => {
  const id = req.params.id;
  const db = readDb();
  const initialLength = db.records.length;
  
  db.records = db.records.filter(r => r.id !== id);

  if (db.records.length === initialLength) {
    return res.status(404).json({ error: "Record not found." });
  }

  if (writeDb(db)) {
    res.json({ success: true, message: "Record deleted successfully." });
  } else {
    res.status(500).json({ error: "Failed to delete record from database." });
  }
});

// API: Reset Database (Wipe records, clear database - Admin Only)
app.post('/api/reset', requireAdmin, (req, res) => {
  const db = readDb();
  db.records = []; // Clear records but preserve operator permissions setup

  if (writeDb(db)) {
    res.json({ success: true, message: "Database records cleared successfully." });
  } else {
    res.status(500).json({ error: "Failed to reset database." });
  }
});

// Fallback Route - Serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`   LONRIX FIELD MONITORING CENTRAL HUB IS LIVE`);
  console.log(`======================================================`);
  console.log(`* Local Access:        http://localhost:${PORT}`);
  console.log(`* Shared Network Link: http://${LOCAL_IP}:${PORT}`);
  console.log(`======================================================\n`);
});
