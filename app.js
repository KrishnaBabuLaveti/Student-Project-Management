const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
require('dotenv').config();

const app = express();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/project_management', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    family: 4
})
.then(() => {
    console.log('MongoDB Connected Successfully');
    
    // Register models in correct order
    require('./models/User');
    require('./models/Faculty');
    require('./models/Student');
    require('./models/Batch');
    require('./models/Notification');
    
    const registeredModels = mongoose.modelNames();
    console.log('Registered Models:', registeredModels);
    console.log('All models registered successfully');
})
.catch(err => {
    console.error('MongoDB Connection Error:', err);
    process.exit(1);
});

// Passport config
require('./config/passport')(passport);

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');
app.set("layout extractScripts", true);
app.set("layout extractStyles", true);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Flash messages
app.use(flash());

// Global variables
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.error = req.flash('error');
    res.locals.user = req.user || null;
    next();
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/student', require('./routes/student'));
app.use('/faculty', require('./routes/faculty'));
app.use('/supervisor', require('./routes/supervisor'));

// Home route
app.get('/', (req, res) => {
    if (req.user) {
        // User is logged in, redirect to appropriate dashboard
        if (req.user.jntuNumber) {
            return res.redirect('/student/dashboard');
        }

        // For other users, check role
        switch (req.user.role) {
            case 'faculty':
                return res.redirect('/faculty/dashboard');
            case 'supervisor':
                return res.redirect('/supervisor/dashboard');
            default:
                return res.redirect('/dashboard');
        }
    }
    
    // User is not logged in, render the index page with registration forms
    res.render('index', { 
        title: 'Welcome to Project Management System',
        user: req.user 
    });
});

// Dashboard route
app.get('/dashboard', (req, res) => {
    if (!req.user) {
        req.flash('error_msg', 'Please log in to access the dashboard');
        return res.redirect('/');
    }

    // Check if user is a student (has jntuNumber)
    if (req.user.jntuNumber) {
        return res.redirect('/student/dashboard');
    }

    // For other users, check role
    switch (req.user.role) {
        case 'faculty':
            res.redirect('/faculty/dashboard');
            break;
        case 'supervisor':
            res.redirect('/supervisor/dashboard');
            break;
        default:
            res.redirect('/');
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', {
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('404');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 