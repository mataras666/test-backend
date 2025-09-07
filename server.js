const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');

const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Configure multer for file uploads (both image and PDF)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = 'uploads/';
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath);
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Generate a unique filename with timestamp
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        
        if (file.fieldname === 'image') {
            cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
        } else if (file.fieldname === 'cv') {
            cb(null, 'cv-' + uniqueSuffix + path.extname(file.originalname));
        } else {
            cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
        }
    }
});

const fileFilter = function (req, file, cb) {
    // Check if the file is an image or PDF
    if (file.fieldname === 'image' && file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else if (file.fieldname === 'cv' && file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type'), false);
    }
};

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit for both files
    },
    fileFilter: fileFilter
});

// Database connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'user_registration'
});

// Connect to MySQL
db.connect((err) => {
    if (err) {
        console.error('Database connection failed: ', err);
        return;
    }
    console.log('Connected to MySQL database');
    
    // Create database if it doesn't exist
    db.query('CREATE DATABASE IF NOT EXISTS user_registration', (err) => {
        if (err) {
            console.error('Error creating database: ', err);
            return;
        }
        
        // Use the database
        db.query('USE user_registration', (err) => {
            if (err) {
                console.error('Error using database: ', err);
                return;
            }
            
            // Create users table if it doesn't exist
            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    fullname VARCHAR(255) NOT NULL,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    age INT,
                    gender ENUM('male', 'female', 'other'),
                    profile_image VARCHAR(255),
                    cv_filename VARCHAR(255),
                    reg_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `;
            
            db.query(createTableQuery, (err) => {
                if (err) {
                    console.error('Error creating table: ', err);
                } else {
                    console.log('Users table ready');
                    
                    // Check if profile_image and cv_filename columns exist, if not add them
                    checkAndAddColumns();
                }
            });
        });
    });
});

// Function to check and add columns if they don't exist
function checkAndAddColumns() {
    const columnsToCheck = ['profile_image', 'cv_filename'];
    
    columnsToCheck.forEach(column => {
        const checkColumnQuery = `
            SELECT COUNT(*) as count 
            FROM information_schema.columns 
            WHERE table_schema = 'user_registration' 
            AND table_name = 'users' 
            AND column_name = '${column}'
        `;
        
        db.query(checkColumnQuery, (err, results) => {
            if (err) {
                console.error(`Error checking for ${column} column: `, err);
                return;
            }
            
            if (results[0].count === 0) {
                // Column doesn't exist, so add it
                const dataType = column === 'cv_filename' ? 'VARCHAR(255)' : 'VARCHAR(255)';
                const addColumnQuery = `ALTER TABLE users ADD COLUMN ${column} ${dataType}`;
                
                db.query(addColumnQuery, (err) => {
                    if (err) {
                        console.error(`Error adding ${column} column: `, err);
                    } else {
                        console.log(`Added ${column} column to users table`);
                    }
                });
            } else {
                console.log(`${column} column already exists`);
            }
        });
    });
}

// Registration endpoint with image and CV upload
app.post('/register', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'cv', maxCount: 1 }]), async (req, res) => {
    const { fullname, email, password, age, gender } = req.body;
    
    // Basic validation
    if (!fullname || !email || !password) {
        return res.status(400).json({ error: 'Full name, email, and password are required' });
    }
    
    try {
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Get the uploaded files
        const profileImage = req.files['image'] ? req.files['image'][0].filename : null;
        const cvFile = req.files['cv'] ? req.files['cv'][0].filename : null;
        
        // Insert user into database
        const query = 'INSERT INTO users (fullname, email, password, age, gender, profile_image, cv_filename) VALUES (?, ?, ?, ?, ?, ?, ?)';
        db.query(query, [fullname, email, hashedPassword, age, gender, profileImage, cvFile], (err, results) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ error: 'Email already registered' });
                }
                console.error('Database error: ', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            res.status(201).json({ 
                message: 'User registered successfully', 
                userId: results.insertId 
            });
        });
    } catch (error) {
        console.error('Error in registration: ', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    
    try {
        // Find user by email
        const query = 'SELECT * FROM users WHERE email = ?';
        db.query(query, [email], async (err, results) => {
            if (err) {
                console.error('Database error: ', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (results.length === 0) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }
            
            const user = results[0];
            
            // Compare passwords
            const passwordMatch = await bcrypt.compare(password, user.password);
            
            if (!passwordMatch) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }
            
            // Return success (without password)
            const { password: _, ...userWithoutPassword } = user;
            res.json({ 
                message: 'Login successful', 
                user: userWithoutPassword 
            });
        });
    } catch (error) {
        console.error('Login error: ', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Dashboard endpoint (protected route)
app.get('/dashboard', (req, res) => {
    // This would normally check for authentication
    // For simplicity, we'll assume the user ID is passed as a query parameter
    const userId = req.query.userId;
    
    if (!userId) {
        return res.status(401).json({ error: 'User ID required' });
    }
    
    // Fetch user data
    const query = 'SELECT id, fullname, email, age, gender, profile_image, cv_filename, reg_date FROM users WHERE id = ?';
    db.query(query, [userId], (err, results) => {
        if (err) {
            console.error('Database error: ', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (results.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ user: results[0] });
    });
});

// Start server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});