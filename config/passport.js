const LocalStrategy = require('passport-local').Strategy;
const mongoose = require('mongoose');
const User = require('../models/User');
const Faculty = require('../models/Faculty');
const Student = require('../models/Student');

module.exports = function(passport) {
    passport.use(
        new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
            try {
                console.log('Login attempt:', { email, password });
                
                // First try to find a student
                const student = await Student.findOne({ email: email });
                console.log('Student search result:', student ? {
                    found: true,
                    id: student._id,
                    email: student.email,
                    jntuNumber: student.jntuNumber
                } : 'Not found');
                
                if (student) {
                    // For students, check if password matches JNTU number
                    console.log('Checking student password match:', {
                        providedPassword: password,
                        studentJntuNumber: student.jntuNumber,
                        matches: password === student.jntuNumber
                    });
                    
                    if (password === student.jntuNumber) {
                        console.log('Student authentication successful');
                        return done(null, student);
                    }
                    console.log('Student authentication failed: Invalid JNTU Number');
                    return done(null, false, { message: 'Invalid JNTU Number' });
                }

                // If not a student, try to find a regular user or faculty
                let user = await User.findOne({ email: email });
                console.log('Regular user search result:', user ? 'Found' : 'Not found');
                
                if (!user) {
                    console.log('Authentication failed: Email not registered');
                    return done(null, false, { message: 'That email is not registered' });
                }

                // For regular users, match password
                const isMatch = await user.matchPassword(password);
                console.log('Regular user password match:', isMatch);
                
                if (!isMatch) {
                    return done(null, false, { message: 'Password incorrect' });
                }

                return done(null, user);
            } catch (err) {
                console.error('Passport Authentication Error:', err);
                return done(err);
            }
        })
    );

    passport.serializeUser((user, done) => {
        console.log('Serializing user:', {
            id: user._id,
            type: user.jntuNumber ? 'student' : 'user',
            jntuNumber: user.jntuNumber || 'N/A'
        });
        done(null, { 
            id: user._id,
            type: user.jntuNumber ? 'student' : 'user'
        });
    });

    passport.deserializeUser(async ({ id, type }, done) => {
        try {
            console.log('Deserializing user:', { id, type });
            
            if (type === 'student') {
                const student = await Student.findById(id);
                if (student) {
                    console.log('Loaded student document:', {
                        id: student._id,
                        email: student.email,
                        jntuNumber: student.jntuNumber
                    });
                    return done(null, student);
                }
                console.log('Failed to load student document');
            } else {
                // First try to find the user in the regular User model
                const user = await User.findById(id);
                console.log('Regular user lookup result:', user ? {
                    id: user._id,
                    role: user.role
                } : 'Not found');
                
                // If found and it's a faculty, get the faculty document
                if (user && user.role === 'faculty') {
                    const faculty = await Faculty.findById(id);
                    if (faculty) {
                        console.log('Loaded faculty document');
                        return done(null, faculty);
                    }
                }

                // Otherwise just return the user
                if (user) {
                    return done(null, user);
                }
            }
            
            console.error('Failed to deserialize user:', { id, type });
            done(null, false);
        } catch (err) {
            console.error('Deserialize Error:', err);
            done(err);
        }
    });
}; 