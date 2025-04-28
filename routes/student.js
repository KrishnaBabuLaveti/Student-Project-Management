const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ensureAuthenticated, ensureStudent } = require('../middleware/auth');
const Student = require('../models/Student');
const mongoose = require('mongoose');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'uploads/submissions';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['.pdf', '.doc', '.docx', '.ppt', '.pptx'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only PDF, DOC, DOCX, PPT, and PPTX files are allowed.'));
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Student Dashboard
router.get('/dashboard', ensureAuthenticated, ensureStudent, async (req, res) => {
    try {
        console.log('Loading student dashboard for student ID:', req.user._id, 'JNTU:', req.user.jntuNumber);
        
        // First check if student has a batch assigned directly
        let student = await Student.findById(req.user._id);
        
        // If student doesn't have a batch assigned, look for batches that include this student
        if (!student.batch) {
            console.log('Student has no batch assigned directly, checking batch collections');
            const batch = await mongoose.model('Batch').findOne({ students: student._id });
            
            if (batch) {
                console.log('Found batch that includes this student:', batch.name);
                // Update the student to reference this batch
                student.batch = batch._id;
                await student.save();
                console.log('Updated student to reference batch:', batch.name);
            } else {
                console.log('No batch found that includes this student');
            }
        }
        
        // Reload student with complete populated data
        student = await Student.findById(req.user._id)
            .populate({
                path: 'batch',
                populate: [
                    { 
                        path: 'faculty',
                        select: 'name email department' 
                    },
                    { 
                        path: 'students',
                        select: 'name jntuNumber cgpa' 
                    },
                    {
                        path: 'reviewDates'
                    }
                ]
            })
            .populate({
                path: 'submissions.feedback.from',
                select: 'name role'
            });
            
        console.log('Student batch after population:', student.batch ? student.batch.name : 'No batch assigned');
        
        if (student.batch) {
            console.log('Faculty assigned:', student.batch.faculty ? student.batch.faculty.name : 'None');
            console.log('Number of students in batch:', student.batch.students ? student.batch.students.length : 0);
        }
        
        res.render('student/dashboard', {
            user: student,
            layout: 'layouts/main'
        });
    } catch (err) {
        console.error('Error loading student dashboard:', err);
        req.flash('error_msg', 'Error loading dashboard');
        res.redirect('/');
    }
});

// View Batch Details
router.get('/batch', ensureAuthenticated, ensureStudent, async (req, res) => {
    try {
        const batch = await Batch.findOne({ students: req.user.id })
            .populate('students')
            .populate('faculty');
        
        if (!batch) {
            req.flash('error_msg', 'No batch assigned yet');
            return res.redirect('/student/dashboard');
        }

        res.render('student/batch', {
            batch: batch
        });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error loading batch details');
        res.redirect('/student/dashboard');
    }
});

// Handle File Submission
router.post('/submit', ensureAuthenticated, ensureStudent, upload.single('file'), async (req, res) => {
    try {
        const { type } = req.body;
        if (!req.file) {
            req.flash('error_msg', 'Please select a file to upload');
            return res.redirect('/student/dashboard');
        }

        console.log('File uploaded:', req.file);
        console.log('Submission type:', type);

        // First, ensure the student has a batch assigned
        const student = await Student.findById(req.user._id);
        
        // If student doesn't have a batch assigned, look for batches that include this student
        if (!student.batch) {
            console.log('Student has no batch assigned directly, checking batch collections...');
            const batch = await mongoose.model('Batch').findOne({ students: student._id });
            
            if (batch) {
                console.log('Found batch that includes this student:', batch.name);
                // Update the student to reference this batch
                student.batch = batch._id;
                await student.save();
                console.log('Updated student to reference batch:', batch.name);
            } else {
                console.log('No batch found for student');
                req.flash('error_msg', 'You must be assigned to a batch before submitting files');
                return res.redirect('/student/dashboard');
            }
        }
        
        // Create new submission
        student.submissions.push({
            type: type,
            fileUrl: `uploads/submissions/${req.file.filename}`,
            submittedAt: Date.now()
        });

        await student.save();
        console.log('Submission saved successfully');

        req.flash('success_msg', 'File submitted successfully');
        res.redirect('/student/dashboard');
    } catch (err) {
        console.error('Error submitting file:', err);
        if (req.file) {
            // Clean up uploaded file if there was an error
            fs.unlinkSync(path.join(__dirname, '..', 'uploads/submissions', req.file.filename));
        }
        req.flash('error_msg', err.message || 'Error submitting file');
        res.redirect('/student/dashboard');
    }
});

// Download Submission
router.get('/download/:submissionId', ensureAuthenticated, ensureStudent, async (req, res) => {
    try {
        const student = await Student.findById(req.user._id);
        const submission = student.submissions.id(req.params.submissionId);

        if (!submission) {
            req.flash('error_msg', 'Submission not found');
            return res.redirect('/student/dashboard');
        }

        const filePath = path.join(__dirname, '..', submission.fileUrl);
        res.download(filePath);
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error downloading file');
        res.redirect('/student/dashboard');
    }
});

// Error handler for multer
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            req.flash('error_msg', 'File size must be less than 10MB');
        } else {
            req.flash('error_msg', 'Error uploading file');
        }
    } else {
        req.flash('error_msg', err.message);
    }
    res.redirect('/student/dashboard');
});

// View Submissions
router.get('/submissions', ensureAuthenticated, ensureStudent, async (req, res) => {
    try {
        const student = await Student.findById(req.user.id);
        res.render('student/submissions', {
            submissions: student.submissions
        });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error loading submissions');
        res.redirect('/student/dashboard');
    }
});

// View Feedback
router.get('/feedback', ensureAuthenticated, ensureStudent, async (req, res) => {
    try {
        const student = await Student.findById(req.user.id)
            .populate({
                path: 'submissions.feedback.from',
                select: 'name role'
            });
            
        res.render('student/feedback', {
            submissions: student.submissions
        });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error loading feedback');
        res.redirect('/student/dashboard');
    }
});

// Progress Tracking Routes
router.get('/progress', ensureAuthenticated, ensureStudent, async (req, res) => {
    try {
        const student = await Student.findById(req.user._id)
            .populate('batch')
            .populate('milestones');
        
        res.render('student/progress', {
            milestones: student.milestones || []
        });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error loading progress');
        res.redirect('/student/dashboard');
    }
});

router.post('/milestone/add', ensureAuthenticated, ensureStudent, async (req, res) => {
    try {
        const { title, description, dueDate } = req.body;
        const student = await Student.findById(req.user._id);

        student.milestones.push({
            title,
            description,
            dueDate,
            completed: false
        });

        await student.save();
        req.flash('success_msg', 'Milestone added successfully');
        res.redirect('/student/progress');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error adding milestone');
        res.redirect('/student/progress');
    }
});

router.post('/milestone/edit/:id', ensureAuthenticated, ensureStudent, async (req, res) => {
    try {
        const { title, description, dueDate } = req.body;
        const student = await Student.findById(req.user._id);
        const milestone = student.milestones.id(req.params.id);

        if (!milestone) {
            req.flash('error_msg', 'Milestone not found');
            return res.redirect('/student/progress');
        }

        milestone.title = title;
        milestone.description = description;
        milestone.dueDate = dueDate;

        await student.save();
        req.flash('success_msg', 'Milestone updated successfully');
        res.redirect('/student/progress');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error updating milestone');
        res.redirect('/student/progress');
    }
});

router.post('/milestone/complete/:id', ensureAuthenticated, ensureStudent, async (req, res) => {
    try {
        const student = await Student.findById(req.user._id);
        const milestone = student.milestones.id(req.params.id);

        if (!milestone) {
            req.flash('error_msg', 'Milestone not found');
            return res.redirect('/student/progress');
        }

        milestone.completed = true;
        milestone.completedAt = Date.now();

        await student.save();
        req.flash('success_msg', 'Milestone marked as complete');
        res.redirect('/student/progress');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error completing milestone');
        res.redirect('/student/progress');
    }
});

// Analytics Dashboard
router.get('/analytics', ensureAuthenticated, ensureStudent, async (req, res) => {
    try {
        const student = await Student.findById(req.user._id)
            .populate({
                path: 'submissions.feedback.from',
                select: 'name role'
            });
        
        res.render('student/analytics', {
            submissions: student.submissions || []
        });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error loading analytics');
        res.redirect('/student/dashboard');
    }
});

// Calendar View
router.get('/calendar', ensureAuthenticated, ensureStudent, async (req, res) => {
    try {
        const student = await Student.findById(req.user._id)
            .populate({
                path: 'batch',
                populate: {
                    path: 'reviewDates'
                }
            });
        
        res.render('student/calendar', {
            user: student,
            milestones: student.milestones || []
        });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error loading calendar');
        res.redirect('/student/dashboard');
    }
});

module.exports = router; 