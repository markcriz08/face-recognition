const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const fs = require('fs');

// Explicitly load .env from root directory
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Serve static frontend assets from public directory at root level
app.use(express.static(path.join(__dirname, '../public')));

// In-memory cache for anti-double-scan interval
const scanCache = {};

// Helper: Precise Philippine Time (UTC+8)
function getPhilippineDateTime() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const phTime = new Date(utc + (3600000 * 8));
  return {
    date: phTime.toISOString().split('T')[0],
    time: phTime.toTimeString().split(' ')[0],
    formattedReadable: phTime.toLocaleString('en-US', { timeZone: 'Asia/Manila' })
  };
}

// ==================== ADMIN AUTH & REGISTRATION ====================
app.post('/api/admin/register', async (req, res) => {
  try {
    const { name, age, contact, address, email, password } = req.body;
    
    const existing = await pool.query('SELECT * FROM admin_users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Email address already registered.' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const query = `
      INSERT INTO admin_users (name, age, contact, address, email, password_hash)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email;
    `;
    const values = [name, age, contact, address, email, password_hash];
    const newAdmin = await pool.query(query, values);

    res.json({ 
      success: true, 
      message: 'Admin registered successfully!',
      adminId: newAdmin.rows[0].id 
    });
  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== ADMIN LOGIN API ====================
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const result = await pool.query('SELECT * FROM admin_users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const admin = result.rows[0];

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    res.json({ 
      success: true, 
      message: 'Login successful!', 
      admin: { id: admin.id, name: admin.name, email: admin.email } 
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== STAFF MANAGEMENT API ====================
app.get('/api/staff', async (req, res) => {
  try {
    const staff = await pool.query('SELECT * FROM staff_members ORDER BY name ASC');
    res.json(staff.rows);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/staff', async (req, res) => {
  try {
    const { delta_code, name, contact, address, age, birthday, date_hired, facebook_link, messenger_psid, display_photo, face_descriptor } = req.body;
    
    const check = await pool.query('SELECT * FROM staff_members WHERE delta_code = $1', [delta_code]);
    if (check.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Delta Code already registered.' });
    }

    let descriptorString = face_descriptor;
    if (Array.isArray(face_descriptor)) {
      descriptorString = JSON.stringify(face_descriptor);
    } else if (typeof face_descriptor === 'string') {
      try {
        const parsed = JSON.parse(face_descriptor);
        descriptorString = JSON.stringify(parsed);
      } catch (e) {
        descriptorString = face_descriptor;
      }
    }

    const query = `
      INSERT INTO staff_members (delta_code, name, contact, address, age, birthday, date_hired, facebook_link, messenger_psid, display_photo, face_descriptor)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *;
    `;
    const values = [delta_code, name, contact, address, age, birthday, date_hired, facebook_link, messenger_psid || '', display_photo || '', descriptorString];
    const newStaff = await pool.query(query, values);
    res.json({ success: true, data: newStaff.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/staff/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM staff_members WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Staff member deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== KIOSK SCAN & FACE RECOGNITION API ====================
app.post('/api/kiosk/scan', async (req, res) => {
  try {
    const { delta_code, captured_photo_base64 } = req.body;
    const { date, time, formattedReadable } = getPhilippineDateTime();

    const nowTimestamp = Date.now();
    if (scanCache[delta_code] && (nowTimestamp - scanCache[delta_code] < 60000)) {
      return res.status(429).json({ success: false, error: 'Accidental double scan prevented. Please wait 1 minute.' });
    }
    scanCache[delta_code] = nowTimestamp;

    const staffRes = await pool.query('SELECT * FROM staff_members WHERE delta_code = $1', [delta_code]);
    if (staffRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Staff member not found for this Delta Code.' });
    }
    const staff = staffRes.rows[0];

    let recordRes = await pool.query('SELECT * FROM time_records WHERE delta_code = $1 AND record_date = $2', [delta_code, date]);
    let actionType = '';

    if (recordRes.rows.length === 0) {
      await pool.query('INSERT INTO time_records (delta_code, name, record_date, time_in) VALUES ($1, $2, $3, $4)', [delta_code, staff.name, date, time]);
      actionType = 'Time In';
    } else {
      const rec = recordRes.rows[0];
      if (!rec.lunch_out) {
        await pool.query('UPDATE time_records SET lunch_out = $1 WHERE id = $2', [time, rec.id]);
        actionType = 'Lunch Out';
      } else if (!rec.lunch_in) {
        await pool.query('UPDATE time_records SET lunch_in = $1 WHERE id = $2', [time, rec.id]);
        actionType = 'Lunch In';
      } else if (!rec.time_out) {
        await pool.query('UPDATE time_records SET time_out = $1 WHERE id = $2', [time, rec.id]);
        actionType = 'Time Out';
      } else {
        return res.status(400).json({ success: false, error: 'All time record slots already completed for today.' });
      }
    }

    // ==================== FACEBOOK MESSENGER INTEGRATION ====================
    try {
      if (staff.messenger_psid && process.env.FB_ACCESS_TOKEN) {
        let imageUrl = '';

        if (captured_photo_base64) {
          try {
            const uploadRes = await cloudinary.uploader.upload(captured_photo_base64, {
              folder: 'mdrrmo_attendance'
            });
            imageUrl = uploadRes.secure_url;
          } catch (cloudErr) {
            console.error('Cloudinary Upload Error:', cloudErr.message);
          }
        }

        const messageText = `[Time Management System]\nName: ${staff.name}\nAction: ${actionType}\nTimestamp: ${formattedReadable}`;
        await axios.post(`https://graph.facebook.com/v18.0/me/messages`, {
          recipient: { id: staff.messenger_psid },
          messaging_type: "RESPONSE",
          message: { text: messageText }
        }, {
          params: { access_token: process.env.FB_ACCESS_TOKEN }
        });

        if (imageUrl) {
          await axios.post(`https://graph.facebook.com/v18.0/me/messages`, {
            recipient: { id: staff.messenger_psid },
            messaging_type: "RESPONSE",
            message: {
              attachment: {
                type: "image",
                payload: {
                  url: imageUrl,
                  is_reusable: true
                }
              }
            }
          }, {
            params: { access_token: process.env.FB_ACCESS_TOKEN }
          });
        }

        console.log(`Messenger notification sent to ${staff.name}`);
      }
    } catch (fbErr) {
      console.error('Facebook Messenger API Error:', JSON.stringify(fbErr.response?.data || fbErr.message, null, 2));
    }

    res.json({ success: true, message: `${actionType} recorded successfully for ${staff.name} at ${time}!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== TIME RECORDS API ====================
app.get('/api/records', async (req, res) => {
  try {
    const { period } = req.query;
    let query = 'SELECT * FROM time_records';
    
    if (period === 'week') {
      query += ` WHERE record_date >= CURRENT_DATE - INTERVAL '7 days'`;
    } else if (period === 'month') {
      query += ` WHERE record_date >= CURRENT_DATE - INTERVAL '1 month'`;
    } else if (period === 'year') {
      query += ` WHERE record_date >= CURRENT_DATE - INTERVAL '1 year'`;
    }
    
    query += ' ORDER BY record_date DESC';
    const records = await pool.query(query);
    res.json(records.rows);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/records/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { time_in, lunch_out, lunch_in, time_out } = req.body;

    const cleanTime = (val) => (!val || val.trim() === '' || val === 'null' || val === '-') ? null : val.trim();

    const query = `
      UPDATE time_records 
      SET time_in = $1, lunch_out = $2, lunch_in = $3, time_out = $4 
      WHERE id = $5 RETURNING *;
    `;
    const values = [
      cleanTime(time_in), 
      cleanTime(lunch_out), 
      cleanTime(lunch_in), 
      cleanTime(time_out), 
      id
    ];

    const updated = await pool.query(query, values);
    if (updated.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Time record not found.' });
    }
    res.json({ success: true, data: updated.rows[0] });
  } catch (err) {
    console.error('Update Record Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/records/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM time_records WHERE id = $1', [id]);
    res.json({ success: true, message: 'Time record deleted successfully.' });
  } catch (err) {
    console.error('Delete Record Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== WEBHOOK FOR PSID CAPTURE ====================
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = "famy_secure_token";
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      if (entry.messaging) {
        for (const event of entry.messaging) {
          if (event.sender && event.sender.id && event.message && !event.message.is_echo) {
            const senderPsid = event.sender.id;

            try {
              if (process.env.FB_ACCESS_TOKEN) {
                const autoReplyText = `[MDRRMO Time Management System]\n\nHello! Your Messenger PSID is:\n\n${senderPsid}\n\nPlease copy this ID and submit it to your administrator for system registration.`;

                await axios.post(
                  `https://graph.facebook.com/v18.0/me/messages`,
                  {
                    recipient: { id: senderPsid },
                    messaging_type: "RESPONSE",
                    message: { text: autoReplyText }
                  },
                  {
                    params: { access_token: process.env.FB_ACCESS_TOKEN }
                  }
                );
              }
            } catch (err) {
              console.error('Webhook reply error:', err.response?.data || err.message);
            }
          }
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));