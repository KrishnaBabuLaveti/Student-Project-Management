const express = require('express');
const router = express.Router();
const { ensureAuthenticated, ensureFaculty } = require('../middleware/auth');
const Faculty = require('../models/Faculty');
const Student = require('../models/Student');
const Batch = require('../models/Batch');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');

// Faculty Dashboard
router.get('/dashboard', ensureAuthenticated, ensureFaculty, async (req, res) => {
    try {
        console.log('Faculty user in session:', {
            id: req.user._id,
            name: req.user.name,
            role: req.user.role,
            assignedBatches: req.user.assignedBatches
        });

        // Directly use the authenticated faculty user object
        const faculty = req.user;
        
        // Ensure assignedBatches is an array
        if (!faculty.assignedBatches) {
            faculty.assignedBatches = [];
            await faculty.save();
        }
        
        // Fetch complete batch data
        const batches = await Batch.find({ faculty: faculty._id })
            .populate({
                path: 'students',
                select: 'name jntuNumber department branch cgpa'
            });
        
        console.log(`Found ${batches.length} batches assigned to faculty ${faculty.name}`);

        // Calculate average CGPA for each batch
        const batchesWithStats = batches.map(batch => {
            const totalCGPA = batch.students.reduce((sum, student) => sum + (student.cgpa || 0), 0);
            const averageCGPA = batch.students.length > 0 ? totalCGPA / batch.students.length : 0;
            
            return {
                ...batch.toObject(),
                averageCGPA: averageCGPA.toFixed(2),
                studentCount: batch.students.length,
                projectTitle: batch.projectTitle || 'Not assigned',
                projectDescription: batch.projectDescription || 'Not provided',
                status: batch.status || 'active'
            };
        });

        res.render('faculty/dashboard', {
            user: faculty,
            assignedBatches: batchesWithStats,
            layout: 'layouts/main'
        });
    } catch (err) {
        console.error('Faculty Dashboard Error:', err);
        req.flash('error_msg', 'Error loading dashboard: ' + err.message);
        res.redirect('/');
    }
});

// View Specific Batch
router.get('/batch/:batchId', ensureAuthenticated, ensureFaculty, async (req, res) => {
    try {
        const batch = await Batch.findOne({
            _id: req.params.batchId,
            faculty: req.user._id
        }).populate('students');

        if (!batch) {
            req.flash('error_msg', 'Batch not found or access denied');
            return res.redirect('/faculty/dashboard');
        }

        // Load all submissions from this batch's students
        const students = await Student.find({ 
            _id: { $in: batch.students } 
        }).populate({
            path: 'submissions.feedback.from',
            select: 'name role'
        });

        // Gather all submissions from the batch students
        const allSubmissions = [];
        students.forEach(student => {
            if (student.submissions && student.submissions.length > 0) {
                student.submissions.forEach(submission => {
                    allSubmissions.push({
                        ...submission.toObject(),
                        studentName: student.name,
                        studentId: student._id,
                        jntuNumber: student.jntuNumber
                    });
                });
            }
        });

        // Sort submissions by date (newest first)
        allSubmissions.sort((a, b) => b.submittedAt - a.submittedAt);

        res.render('faculty/batch-details', {
            user: req.user,
            batch: batch,
            submissions: allSubmissions,
            layout: 'layouts/main'
        });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error loading batch details');
        res.redirect('/faculty/dashboard');
    }
});

// View Batch Submissions (new route)
router.get('/batch/:batchId/submissions', ensureAuthenticated, ensureFaculty, async (req, res) => {
    try {
        const batch = await Batch.findOne({
            _id: req.params.batchId,
            faculty: req.user._id
        }).populate('students');

        if (!batch) {
            req.flash('error_msg', 'Batch not found or access denied');
            return res.redirect('/faculty/dashboard');
        }

        // Load all submissions from students in this batch
        const students = await Student.find({ 
            _id: { $in: batch.students } 
        }).populate({
            path: 'submissions.feedback.from',
            select: 'name role'
        });

        // Group submissions by type
        const submissionsByType = {};
        
        students.forEach(student => {
            if (student.submissions && student.submissions.length > 0) {
                student.submissions.forEach(submission => {
                    if (!submissionsByType[submission.type]) {
                        submissionsByType[submission.type] = [];
                    }
                    
                    submissionsByType[submission.type].push({
                        ...submission.toObject(),
                        studentName: student.name,
                        studentId: student._id,
                        jntuNumber: student.jntuNumber
                    });
                });
            }
        });

        // Sort each type's submissions by date
        Object.keys(submissionsByType).forEach(type => {
            submissionsByType[type].sort((a, b) => b.submittedAt - a.submittedAt);
        });

        res.render('faculty/batch-submissions', {
            user: req.user,
            batch: batch,
            submissionsByType: submissionsByType,
            layout: 'layouts/main'
        });
    } catch (err) {
        console.error('Error loading batch submissions:', err);
        req.flash('error_msg', 'Error loading batch submissions');
        res.redirect('/faculty/dashboard');
    }
});

// View Student Submissions
router.get('/submissions/:studentId', ensureAuthenticated, ensureFaculty, async (req, res) => {
    try {
        console.log('Faculty checking submissions for student:', req.params.studentId);
        
        // Check if faculty has access to this student
        const batch = await Batch.findOne({
            faculty: req.user._id,
            students: req.params.studentId
        });

        if (!batch) {
            console.log('Faculty access denied - no matching batch found');
            req.flash('error_msg', 'Access denied - you are not assigned to this student\'s batch');
            return res.redirect('/faculty/dashboard');
        }

        console.log('Faculty access granted - found batch:', batch.name);

        const student = await Student.findById(req.params.studentId)
            .populate({
                path: 'submissions.feedback.from',
                select: 'name role'
            });

        console.log('Found student with', student.submissions ? student.submissions.length : 0, 'submissions');

        res.render('faculty/student-submissions', {
            student: student,
            batchId: batch._id,
            layout: 'layouts/main'
        });
    } catch (err) {
        console.error('Error loading student submissions:', err);
        req.flash('error_msg', 'Error loading student submissions');
        res.redirect('/faculty/dashboard');
    }
});

// Provide Feedback
router.post('/feedback/:studentId/:submissionId', ensureAuthenticated, ensureFaculty, async (req, res) => {
    try {
        const { comment, rating, origin } = req.body;
        
        // Verify faculty has access to this student
        const batch = await Batch.findOne({
            faculty: req.user._id,
            students: req.params.studentId
        });

        if (!batch) {
            req.flash('error_msg', 'Access denied');
            return res.redirect('/faculty/dashboard');
        }

        const student = await Student.findById(req.params.studentId);
        if (!student) {
            req.flash('error_msg', 'Student not found');
            return res.redirect(`/faculty/batch/${batch._id}/submissions`);
        }

        // Find the specific submission by ID
        const submission = student.submissions.id(req.params.submissionId);
        if (!submission) {
            req.flash('error_msg', 'Submission not found');
            return res.redirect(`/faculty/batch/${batch._id}/submissions`);
        }

        // Initialize feedback array if it doesn't exist
        if (!submission.feedback) {
            submission.feedback = [];
        }

        // Add feedback to this specific submission
        submission.feedback.push({
            from: req.user._id,
            comment,
            rating: parseInt(rating, 10) || 0,
            createdAt: new Date()
        });

        // Save the student document
        await student.save();

        req.flash('success_msg', 'Feedback submitted successfully');
        
        // Determine the return URL based on origin or default to submissions page
        let returnUrl = `/faculty/batch/${batch._id}/submissions`;
        
        // If we know which page to go back to (from origin field), use that
        if (origin && (origin.includes('/batch/') || origin.includes('/submissions'))) {
            returnUrl = origin;
        }
        
        return res.redirect(303, returnUrl);
    } catch (err) {
        console.error('Feedback submission error:', err);
        req.flash('error_msg', 'Error submitting feedback: ' + err.message);
        return res.redirect('/faculty/dashboard');
    }
});

// Schedule Review for a Batch
router.post('/batch/:batchId/schedule-review', ensureAuthenticated, ensureFaculty, async (req, res) => {
    try {
        const { title, date, description } = req.body;
        const batch = await Batch.findById(req.params.batchId);
        
        if (!batch) {
            req.flash('error_msg', 'Batch not found');
            return res.redirect('/faculty/dashboard');
        }
        
        // Ensure faculty is assigned to this batch
        if (batch.faculty.toString() !== req.user.id) {
            req.flash('error_msg', 'You are not authorized to schedule reviews for this batch');
            return res.redirect('/faculty/dashboard');
        }
        
        // Create the review object
        const reviewData = {
            title,
            date,
            description,
            isGlobal: false, // Faculty reviews are not global
            scheduledBy: new mongoose.Types.ObjectId(req.user.id),
            completed: false
        };
        
        batch.reviewDates.push(reviewData);
        await batch.save();
        
        // Notify students in the batch
        try {
            const students = await Student.find({ batch: batch._id });
            const notifications = students.map(student => ({
                recipient: student._id,
                type: 'review',
                title: 'Review Scheduled',
                message: `A new review "${title}" has been scheduled for your batch`,
                relatedTo: {
                    model: 'Batch',
                    id: batch._id
                },
                from: new mongoose.Types.ObjectId(req.user.id)
            }));
            
            await Notification.insertMany(notifications);
        } catch (notifyErr) {
            console.error('Error creating notifications:', notifyErr);
        }
        
        req.flash('success_msg', 'Review scheduled successfully');
        res.redirect(`/faculty/batch/${batch._id}`);
    } catch (err) {
        console.error('Error scheduling review:', err);
        req.flash('error_msg', 'Error scheduling review');
        res.redirect('/faculty/dashboard');
    }
});

// Complete a Review
router.post('/batch/:batchId/review/:reviewId/complete', ensureAuthenticated, ensureFaculty, async (req, res) => {
    try {
        const { feedback } = req.body;
        const batch = await Batch.findById(req.params.batchId);
        
        if (!batch) {
            req.flash('error_msg', 'Batch not found');
            return res.redirect('/faculty/dashboard');
        }
        
        // Ensure faculty is assigned to this batch
        if (batch.faculty.toString() !== req.user.id) {
            req.flash('error_msg', 'You are not authorized to complete reviews for this batch');
            return res.redirect('/faculty/dashboard');
        }
        
        const review = batch.reviewDates.id(req.params.reviewId);
        if (!review) {
            req.flash('error_msg', 'Review not found');
            return res.redirect(`/faculty/batch/${req.params.batchId}`);
        }
        
        // Faculty can only complete their own batch-specific reviews, not global reviews
        if (review.isGlobal) {
            req.flash('error_msg', 'Faculty cannot complete global reviews scheduled by supervisors');
            return res.redirect(`/faculty/batch/${req.params.batchId}`);
        }

        // Find the review and update it atomically
        const result = await Batch.findOneAndUpdate(
            {
                _id: req.params.batchId,
                'reviewDates._id': req.params.reviewId
            },
            {
                $set: {
                    'reviewDates.$.completed': true
                },
                $push: {
                    'reviewDates.$.feedback': {
                        from: req.user._id,
                        comment: feedback,
                        createdAt: new Date()
                    }
                }
            },
            { new: true }
        );

        if (!result) {
            req.flash('error_msg', 'Unable to update review');
            return res.redirect(`/faculty/batch/${req.params.batchId}`);
        }

        // Notify students about the completed review
        try {
            const students = await Student.find({ batch: batch._id });
            const notifications = students.map(student => ({
                recipient: student._id,
                type: 'review',
                title: 'Review Completed',
                message: `The review "${review.title}" has been completed with feedback`,
                relatedTo: {
                    model: 'Batch',
                    id: batch._id
                },
                from: req.user._id
            }));
            
            await Notification.insertMany(notifications);
        } catch (notifyErr) {
            console.error('Error creating notifications:', notifyErr);
            // Continue even if notification creation fails
        }
        
        req.flash('success_msg', 'Review completed successfully');
        return res.redirect(`/faculty/batch/${req.params.batchId}`);
    } catch (err) {
        console.error('Error completing review:', err);
        req.flash('error_msg', 'Error completing review');
        return res.redirect(`/faculty/batch/${req.params.batchId}`);
    }
});

module.exports = router; 