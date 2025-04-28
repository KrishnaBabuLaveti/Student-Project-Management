const express = require('express');
const router = express.Router();
const passport = require('passport');
const { forwardAuthenticated, ensureAuthenticated } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

const Student = require('../models/Student');
const Faculty = require('../models/Faculty');
const User = require('../models/User');

// Login Page
router.get('/login', forwardAuthenticated, (req, res) => {
    res.render('login', {
        title: 'Login - Project Management System',
        layout: 'layouts/main',
        messages: {
            error: req.flash('error')
        }
    });
});

// Register Page
router.get('/register', forwardAuthenticated, (req, res) => {
    const role = req.query.role;
    
    // If no role is specified or invalid, redirect to the landing page
    if (!role || (role !== 'faculty' && role !== 'supervisor')) {
        return res.redirect('/');
    }
    
    res.render('register', { 
        title: `${role.charAt(0).toUpperCase() + role.slice(1)} Registration`,
        role,
        errors: [],
        name: '',
        email: '',
        employeeId: '',
        department: '',
        designation: '',
        specialization: '',
        layout: 'layouts/main'
    });
});

// Login Handle
router.post('/login', (req, res, next) => {
    passport.authenticate('local', {
        successRedirect: '/dashboard',
        failureRedirect: '/auth/login',
        failureFlash: true
    })(req, res, next);
});

// Register Handle
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, password2, role, department } = req.body;
        console.log('Registration attempt:', { name, email, role, department }); // Debug log

        // Validation
        const errors = [];
        
        if (!name || !email || !password || !password2 || !role) {
            errors.push({ msg: 'Please fill in all required fields' });
        }

        if (password !== password2) {
            errors.push({ msg: 'Passwords do not match' });
        }

        if (password.length < 6) {
            errors.push({ msg: 'Password should be at least 6 characters' });
        }

        if (role === 'faculty') {
            if (!department) {
                errors.push({ msg: 'Please select a department' });
            } else {
                const validDepartments = ['CSE', 'CSE-AIML', 'CSE-AIDS', 'IT', 'ECE', 'MECH', 'CIVIL'];
                if (!validDepartments.includes(department)) {
                    errors.push({ msg: 'Invalid department selected' });
                }
            }
        }

        if (role !== 'faculty' && role !== 'supervisor') {
            errors.push({ msg: 'Invalid registration type' });
        }

        if (errors.length > 0) {
            return res.render('register', {
                errors,
                name,
                email,
                department,
                role,
                layout: 'layouts/main'
            });
        }

        // Check if user exists
        const existingUser = await User.findOne({ email });

        if (existingUser) {
            errors.push({ msg: 'Email is already registered' });
            return res.render('register', {
                errors,
                name,
                email,
                department,
                role,
                layout: 'layouts/main'
            });
        }

        let newUser;
        
        if (role === 'faculty') {
            newUser = new Faculty({
                name,
                email,
                password,
                department,
                assignedBatches: [],
                mustChangePassword: true
            });
        } else {
            newUser = new User({
                name,
                email,
                password,
                role: 'supervisor',
                mustChangePassword: true
            });
        }

        await newUser.save();
        console.log('User registered successfully:', { role, email });
        
        req.flash('success_msg', 'You are now registered and can log in');
        return res.redirect('/auth/login');

    } catch (error) {
        console.error('Registration Error:', error);
        return res.render('register', {
            errors: [{ msg: 'Registration failed: ' + error.message }],
            name: req.body.name,
            email: req.body.email,
            department: req.body.department,
            role: req.body.role,
            layout: 'layouts/main'
        });
    }
});

// Logout Handle
router.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) {
            console.error(err);
            return next(err);
        }
        req.flash('success_msg', 'You are logged out');
        res.redirect('/');
    });
});

// Change Password Page
router.get('/change-password', ensureAuthenticated, (req, res) => {
    res.render('change-password', {
        user: req.user,
        layout: 'layouts/main'
    });
});

// Handle Password Change
router.post('/change-password', ensureAuthenticated, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        // Validate password match
        if (newPassword !== confirmPassword) {
            req.flash('error_msg', 'New passwords do not match');
            return res.redirect('/auth/change-password');
        }

        // Validate current password
        const isMatch = await bcrypt.compare(currentPassword, req.user.password);
        if (!isMatch) {
            req.flash('error_msg', 'Current password is incorrect');
            return res.redirect('/auth/change-password');
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update user password
        await Student.findByIdAndUpdate(req.user.id, {
            password: hashedPassword,
            mustChangePassword: false
        });

        req.flash('success_msg', 'Password updated successfully');
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Error changing password:', error);
        req.flash('error_msg', 'Error changing password');
        res.redirect('/auth/change-password');
    }
});

module.exports = router; 