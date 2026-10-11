-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Admin Users Table (For unique admin accounts & verification codes)[cite: 9]
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    age INT NOT NULL,
    contact VARCHAR(50) NOT NULL,
    address TEXT NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    verification_code VARCHAR(10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Staff Members Table (Stores personal info, delta code, face descriptor, Facebook link, and Messenger PSID)[cite: 9]
CREATE TABLE IF NOT EXISTS staff_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delta_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    contact VARCHAR(50) NOT NULL,
    address TEXT NOT NULL,
    age INT NOT NULL,
    birthday DATE NOT NULL,
    date_hired DATE NOT NULL,
    facebook_link TEXT NOT NULL,
    messenger_psid VARCHAR(100), -- Page-Scoped ID for Messenger delivery
    display_photo TEXT NOT NULL, 
    face_descriptor TEXT NOT NULL, -- JSON serialized array for face-api.js comparison
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Time Records Table (Tracks Time In, Lunch Out, Lunch In, and Time Out per day)[cite: 9]
CREATE TABLE IF NOT EXISTS time_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delta_code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    record_date DATE NOT NULL,
    time_in TIME,
    lunch_out TIME,
    lunch_in TIME,
    time_out TIME,
    CONSTRAINT fk_staff FOREIGN KEY (delta_code) REFERENCES staff_members(delta_code) ON DELETE CASCADE
);