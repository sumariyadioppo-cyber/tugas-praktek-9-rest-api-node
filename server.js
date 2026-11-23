const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const API_KEY = process.env.API_KEY || "rahasia-praktek-9";

function cekApiKey(req, res, next) {
  const clientKey = req.header("X-API-Key");
  if (!clientKey || clientKey !== API_KEY) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: X-API-Key tidak valid atau tidak ada"
    });
  }
  next();
}

const db = new sqlite3.Database("./database.sqlite", (err) => {
  if (err) {
    console.error("Gagal membuka SQLite:", err.message);
  } else {
    console.log("Terhubung ke database SQLite.");
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    max_threshold REAL NOT NULL
  )`);
  db.run(`INSERT OR IGNORE INTO settings (id, max_threshold) VALUES (1, 30.0)`);

  db.run(`CREATE TABLE IF NOT EXISTS temperature_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    temperature REAL NOT NULL,
    is_alert INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

app.put("/api/threshold", cekApiKey, (req, res) => {
  const { threshold } = req.body;
  if (typeof threshold !== "number" || Number.isNaN(threshold)) {
    return res.status(400).json({ message: "Threshold harus berupa angka" });
  }

  db.run(
    `UPDATE settings SET max_threshold = ? WHERE id = 1`,
    [threshold],
    function (err) {
      if (err) return res.status(500).json({ message: err.message });
      res.json({ success: true, threshold });
    }
  );
});

app.post("/api/temperature", cekApiKey, (req, res) => {
  const { temperature } = req.body;
  if (typeof temperature !== "number" || Number.isNaN(temperature)) {
    return res.status(400).json({ message: "Temperature harus berupa angka" });
  }

  db.get(`SELECT max_threshold FROM settings WHERE id = 1`, (err, row) => {
    if (err) return res.status(500).json({ message: err.message });

    const threshold = row ? row.max_threshold : 30;
    const isExceeded = temperature > threshold;
    const notification = isExceeded
      ? `PERINGATAN! Suhu ${temperature}°C melewati batas ${threshold}°C`
      : null;

    db.run(
      `INSERT INTO temperature_history (temperature, is_alert) VALUES (?, ?)`,
      [temperature, isExceeded ? 1 : 0],
      function (insertErr) {
        if (insertErr) return res.status(500).json({ message: insertErr.message });

        const payload = {
          id: this.lastID,
          temperature,
          threshold,
          isExceeded,
          notification,
          timestamp: new Date().toISOString()
        };

        broadcast(payload);

        res.status(201).json({
          success: true,
          data: payload
        });
      }
    );
  });
});

app.get("/api/history", cekApiKey, (req, res) => {
  db.all(
    `SELECT * FROM temperature_history ORDER BY id DESC LIMIT 50`,
    (err, rows) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json({ success: true, data: rows.reverse() });
    }
  );
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});