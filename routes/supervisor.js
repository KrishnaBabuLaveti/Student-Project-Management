const express = require('express');
const router = express.Router();
const { ensureAuthenticated, ensureSupervisor } = require('../middleware/auth');
const upload = require('../middleware/upload');
const Student = require('../models/Student');
const Faculty = require('../models/Faculty');
const Batch = require('../models/Batch');
const csv = require('csv-parse');
const fs = require('fs');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const bcrypt = require('bcryptjs');
const Notification = require('../models/Notification');
const { sendBatchNotification } = require('../utils/emailService');
const User = require('../models/User');
const mongoose = require('mongoose');

// Inspect the Batch model schema to understand the reviewDates.scheduledBy field requirements
console.log('Batch Model Review Schema:', 
  Batch.schema.path('reviewDates').schema.path('scheduledBy') 
  ? Batch.schema.path('reviewDates').schema.path('scheduledBy').options 
  : 'scheduledBy path not found');

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'uploads/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const uploadMulter = multer({ storage: storage });

// Helper function to parse CSV file
async function parseCSV(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
}

// Helper function to parse XLSX file
function parseXLSX(filePath) {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json(worksheet);
}

// Helper function to create batches in snake order
async function createBatchesInSnakeOrder(students, batchSize, academicYear) {
    // Sort students by CGPA in descending order
    students.sort((a, b) => parseFloat(b.cgpa) - parseFloat(a.cgpa));

    // Group students by department
    const departmentGroups = {};
    students.forEach(student => {
        if (!departmentGroups[student.department]) {
            departmentGroups[student.department] = [];
        }
        departmentGroups[student.department].push(student);
    });

    const batches = [];
    
    // Process each department separately
    for (const [department, deptStudents] of Object.entries(departmentGroups)) {
        const numBatches = Math.ceil(deptStudents.length / batchSize);
        const batchStudents = Array(numBatches).fill().map(() => []);
        
        // Distribute students in snake order
        let forward = true;
        let currentBatch = 0;
        
        deptStudents.forEach((student, index) => {
            batchStudents[currentBatch].push(student);
            
            if (forward) {
                if (currentBatch === numBatches - 1) {
                    forward = false;
                    currentBatch--;
                } else {
                    currentBatch++;
                }
            } else {
                if (currentBatch === 0) {
                    forward = true;
                    currentBatch++;
                } else {
                    currentBatch--;
                }
            }
        });

        // Create batch objects
        for (let i = 0; i < batchStudents.length; i++) {
            if (batchStudents[i].length > 0) {
                const batchName = `${department}-${academicYear}-${String.fromCharCode(65 + i)}`;
                const averageCGPA = batchStudents[i].reduce((sum, student) => 
                    sum + parseFloat(student.cgpa), 0) / batchStudents[i].length;

                batches.push({
                    name: batchName,
                    department: department,
                    academicYear: academicYear,
                    students: batchStudents[i].map(s => s._id), // Ensure we're only storing student IDs
                    averageCGPA: averageCGPA,
                    status: 'active',
                    projectTitle: `${department} Project - ${batchName}`,
                    projectDescription: `Project for batch ${batchName} in ${department} department`
                });
            }
        }
    }

    return batches;
}

// Helper function to assign faculty guides based on workload
async function assignFacultyGuides(batches) {
    try {
        // Get the proper Faculty model
        const facultyModel = mongoose.model('faculty');
        
        // Get all faculty members
        const faculty = await facultyModel.find().lean();
        
        // Group faculty by department for easier access
        const facultyByDepartment = {};
        faculty.forEach(f => {
            if (!facultyByDepartment[f.department]) {
                facultyByDepartment[f.department] = [];
            }
            facultyByDepartment[f.department].push(f);
        });

        // Assign faculty to batches
        for (const batch of batches) {
            const departmentFaculty = facultyByDepartment[batch.department];
            
            if (departmentFaculty && departmentFaculty.length > 0) {
                // Get a random faculty member from the same department
                const randomIndex = Math.floor(Math.random() * departmentFaculty.length);
                batch.faculty = departmentFaculty[randomIndex]._id;
                
                // Update faculty's assignedBatches
                await facultyModel.findByIdAndUpdate(
                    departmentFaculty[randomIndex]._id,
                    { $addToSet: { assignedBatches: batch._id } }
                );
            }
        }

        return batches;
    } catch (error) {
        console.error('Error assigning faculty guides:', error);
        throw error;
    }
}

// Supervisor Dashboard
router.get('/dashboard', ensureAuthenticated, ensureSupervisor, async (req, res) => {
    try {
        // Make sure Faculty model is available
        const facultyModel = mongoose.model('faculty');
        console.log('Using Faculty model with name:', facultyModel.modelName);
        
        // Get batches with populated data
        const batches = await Batch.find()
            .populate('faculty', 'name department')
            .populate('students', 'name jntuNumber cgpa')
            .sort({ createdAt: -1 })
            .lean();
        
        // Get faculty with their workload
        const faculty = await facultyModel.find()
            .select('name department email')
            .lean();

        // Calculate faculty workload and batch statistics
        for (const f of faculty) {
            const assignedBatches = await Batch.find({ faculty: f._id });
            f.assignedBatches = assignedBatches.length;
            
            // Calculate total students under this faculty
            const studentCount = await Student.countDocuments({
                batch: { $in: assignedBatches.map(b => b._id) }
            });
            f.totalStudents = studentCount;
        }

        // Calculate average CGPA for each batch if not already set
        for (const batch of batches) {
            if (!batch.averageCGPA && batch.students && batch.students.length > 0) {
                batch.averageCGPA = batch.students.reduce((sum, student) => 
                    sum + (student.cgpa || 0), 0) / batch.students.length;
            }
        }
        
        return res.render('supervisor/dashboard', {
            title: 'Supervisor Dashboard',
            user: req.user,
            batches: batches || [],
            faculty: faculty || [],
            layout: 'layouts/main',
            scripts: [
                '/js/deleteItem.js'
            ]
        });
    } catch (err) {
        console.error('Dashboard Error:', err);
        req.flash('error_msg', 'Error loading dashboard: ' + err.message);
        return res.redirect('/');
    }
});

// Upload Student Data
router.post('/upload-students', ensureAuthenticated, ensureSupervisor, uploadMulter.single('studentData'), async (req, res) => {
    try {
        if (!req.file) {
            req.flash('error_msg', 'No file uploaded');
            return res.redirect('/supervisor/dashboard');
        }

        const filePath = req.file.path;
        const fileExt = path.extname(req.file.originalname).toLowerCase();
        let batchSize = parseInt(req.body.batchSize) || 4;
        const academicYear = req.body.academicYear;

        // Validate batch size
        if (isNaN(batchSize) || batchSize < 1) {
            batchSize = 10; // Default to 4 if invalid
        } else if (batchSize > 10) {
            batchSize = 10; // Cap at 4 if larger
        }

        let studentData;
        try {
            if (fileExt === '.csv') {
                studentData = await parseCSV(filePath);
            } else if (fileExt === '.xlsx') {
                studentData = parseXLSX(filePath);
            } else {
                req.flash('error_msg', 'Invalid file format. Please upload a CSV or XLSX file.');
                return res.redirect('/supervisor/dashboard');
            }
        } catch (error) {
            console.error('Error parsing file:', error);
            req.flash('error_msg', 'Error parsing file. Please check the file format.');
            return res.redirect('/supervisor/dashboard');
        }

        // Validate student data
        const validDepartments = ['CSE', 'CSE-AIML', 'CSE-AIDS', 'IT', 'ECE', 'MECH', 'CIVIL'];
        
        for (const student of studentData) {
            // Check required fields with exact column names
            if (!student.name || !student.department || !student.cgpa || 
                !student.email || !student.jntuNumber) {
                req.flash('error_msg', 'Invalid data format. Required columns: name, email, jntuNumber, department, cgpa');
                return res.redirect('/supervisor/dashboard');
            }

            // Validate department/branch
            const upperDepartment = student.department.toUpperCase();
            if (!validDepartments.includes(upperDepartment)) {
                req.flash('error_msg', `Invalid department for student ${student.name}. Department must be one of: ${validDepartments.join(', ')}`);
                return res.redirect('/supervisor/dashboard');
            }

            // Validate CGPA
            const cgpa = parseFloat(student.cgpa);
            if (isNaN(cgpa) || cgpa < 0 || cgpa > 10) {
                req.flash('error_msg', `Invalid CGPA for student ${student.name}. CGPA must be between 0 and 10`);
                return res.redirect('/supervisor/dashboard');
            }

            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(student.email)) {
                req.flash('error_msg', `Invalid email format for student ${student.name}`);
                return res.redirect('/supervisor/dashboard');
            }
        }

        // Create or update students
        const students = await Promise.all(studentData.map(async student => {
            try {
                // Check if student exists in either User or Student collection
                const existingUser = await User.findOne({ email: student.email });
                const existingStudent = await Student.findOne({ email: student.email });
                
                // Use JNTU number as default password
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(student.jntuNumber, salt);

                if (existingStudent || existingUser) {
                    // Update existing student
                    const studentToUpdate = existingStudent || existingUser;
                    studentToUpdate.name = student.name;
                    studentToUpdate.jntuNumber = student.jntuNumber;
                    studentToUpdate.department = student.department.toUpperCase();
                    studentToUpdate.branch = student.department.toUpperCase();
                    studentToUpdate.cgpa = parseFloat(student.cgpa);
                    // Only update password if it hasn't been changed from the default
                    if (studentToUpdate.mustChangePassword) {
                        studentToUpdate.password = hashedPassword;
                    }
                    await studentToUpdate.save();
                    return studentToUpdate;
                } else {
                    // Create new student
                    const studentData = {
                        name: student.name,
                        email: student.email,
                        jntuNumber: student.jntuNumber,
                        department: student.department.toUpperCase(),
                        branch: student.department.toUpperCase(),
                        cgpa: parseFloat(student.cgpa),
                        password: hashedPassword,
                        mustChangePassword: true
                    };

                    const newStudent = new Student(studentData);
                    await newStudent.save();
                    return newStudent;
                }
            } catch (error) {
                console.error(`Error processing student ${student.name}:`, error);
                throw error;
            }
        }));

        // Create batches in snake order
        let batches = await createBatchesInSnakeOrder(students, batchSize, academicYear);
        
        // Assign faculty guides
        batches = await assignFacultyGuides(batches);

        // Add required fields to each batch
        batches = batches.map(batch => ({
            ...batch,
            createdBy: req.user._id
        }));

        // Save batches to database
        const savedBatches = await Batch.create(batches);

        // Update student batch references
        for (const batch of savedBatches) {
            // Update all students in this batch to refer back to the batch
            await Student.updateMany(
                { _id: { $in: batch.students } },
                { $set: { batch: batch._id } }
            );
            console.log(`Updated ${batch.students.length} students to reference batch ${batch.name}`);
        }

        // Update faculty assignments
        await Promise.all(savedBatches.map(batch => {
            if (batch.faculty) {
                return Faculty.findByIdAndUpdate(
                    batch.faculty,
                    { $push: { assignedBatches: batch._id } },
                    { new: true }
                );
            }
            return Promise.resolve();
        }));

        // Clean up uploaded file
        fs.unlinkSync(filePath);

        const newStudentsCount = students.filter(s => s.isNew).length;
        const updatedStudentsCount = students.length - newStudentsCount;

        req.flash('success_msg', 
            `Upload successful: ${newStudentsCount} new students created, ${updatedStudentsCount} students updated. ` +
            `${savedBatches.length} batches created with ${batchSize} students per batch. ` +
            `Default password for new students is their JNTU number.`
        );
        return res.redirect('/supervisor/dashboard');
    } catch (error) {
        console.error('Error processing file:', error);
        req.flash('error_msg', 'Error processing file: ' + error.message);
        return res.redirect('/supervisor/dashboard');
    }
});

// Create Batch
router.post('/batch/create', ensureAuthenticated, ensureSupervisor, async (req, res) => {
    try {
        const { name, department, academicYear, facultyId, projectTitle, projectDescription } = req.body;

        console.log('Creating batch with faculty:', facultyId);

        // Get the proper Faculty model
        const facultyModel = mongoose.model('faculty');

        // Verify the faculty exists first
        const faculty = await facultyModel.findById(facultyId);
        if (!faculty) {
            req.flash('error_msg', 'Faculty not found');
            return res.redirect('/supervisor/dashboard');
        }

        const newBatch = new Batch({
            name,
            department,
            academicYear,
            faculty: facultyId,
            projectTitle,
            projectDescription,
            createdBy: req.user.id
        });

        // Save the batch first
        await newBatch.save();

        // Then update the faculty
        if (!faculty.assignedBatches) {
            faculty.assignedBatches = [];
        }
        faculty.assignedBatches.push(newBatch._id);
        await faculty.save();

        console.log(`Batch ${name} created and assigned to faculty ${faculty.name}`);

        req.flash('success_msg', 'Batch created successfully');
        res.redirect('/supervisor/dashboard');
    } catch (err) {
        console.error('Batch creation error:', err);
        req.flash('error_msg', 'Error creating batch: ' + err.message);
        res.redirect('/supervisor/dashboard');
    }
});

// Assign Students to Batch
router.post('/batch/:batchId/assign-students', ensureAuthenticated, ensureSupervisor, async (req, res) => {
    try {
        const { studentIds } = req.body;
        const batch = await Batch.findById(req.params.batchId);

        if (!batch) {
            req.flash('error_msg', 'Batch not found');
            return res.redirect('/supervisor/dashboard');
        }

        if (batch.isFull()) {
            req.flash('error_msg', 'Batch is already full');
            return res.redirect('/supervisor/dashboard');
        }

        // Update batch with students
        batch.students = studentIds;
        await batch.save();

        // Update all assigned students with the batch reference
        await Student.updateMany(
            { _id: { $in: studentIds } },
            { $set: { batch: batch._id } }
        );

        console.log(`Assigned ${studentIds.length} students to batch ${batch.name}`);

        req.flash('success_msg', 'Students assigned successfully');
        res.redirect('/supervisor/dashboard');
    } catch (err) {
        console.error('Error assigning students to batch:', err);
        req.flash('error_msg', 'Error assigning students');
        res.redirect('/supervisor/dashboard');
    }
});

// Reassign Faculty
router.post('/batch/:batchId/reassign-faculty', ensureAuthenticated, ensureSupervisor, async (req, res) => {
    try {
        const { batchId } = req.params;
        const { newFacultyId } = req.body;

        if (!newFacultyId) {
            req.flash('error_msg', 'Please select a faculty member');
            return res.redirect('/supervisor/dashboard');
        }

        const facultyModel = mongoose.model('faculty');
        
        // First, update the faculty assignments in the Faculty model
        const oldFaculty = await facultyModel.findOneAndUpdate(
            { assignedBatches: batchId },
            { $pull: { assignedBatches: batchId } }
        );

        await facultyModel.findByIdAndUpdate(
            newFacultyId,
            { $addToSet: { assignedBatches: batchId } }
        );

        // Then update the batch's faculty using direct MongoDB operation to bypass Mongoose validation
        await mongoose.connection.db.collection('batches').updateOne(
            { _id: new mongoose.Types.ObjectId(batchId) },
            { $set: { faculty: new mongoose.Types.ObjectId(newFacultyId) } }
        );

        req.flash('success_msg', 'Guide changed successfully');
        return res.redirect('/supervisor/dashboard');
    } catch (error) {
        console.error('Error reassigning faculty:', error);
        req.flash('error_msg', 'Error reassigning faculty: ' + error.message);
        return res.redirect('/supervisor/dashboard');
    }
});

// Delete Batch
router.delete('/batch/:id', ensureAuthenticated, ensureSupervisor, async (req, res) => {
    try {
        const facultyModel = mongoose.model('faculty');
        
        const batch = await Batch.findById(req.params.id);
        if (!batch) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        // Remove batch from faculty's assignments
        if (batch.faculty) {
            await facultyModel.findByIdAndUpdate(
                batch.faculty,
                { $pull: { assignedBatches: batch._id } }
            );
        }

        await batch.remove();
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting batch:', error);
        res.status(500).json({ error: 'Error deleting batch' });
    }
});

// Manage Reviews Page
router.get('/manage-reviews', ensureAuthenticated, ensureSupervisor, async (req, res) => {
    try {
        const batches = await Batch.find()
            .populate('faculty')
            .populate('students')
            .populate({
                path: 'reviewDates.panelMembers.member',
                select: 'name department'
            });

        const faculty = await Faculty.find()
            .select('name department')
            .sort('name');

        res.render('supervisor/manage-reviews', {
            title: 'Manage Reviews',
            user: req.user,
            batches,
            faculty,
            layout: 'layouts/main'
        });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error loading reviews');
        res.redirect('/supervisor/dashboard');
    }
});

// Schedule New Review (Global)
router.post('/schedule-review', ensureAuthenticated, ensureSupervisor, async (req, res) => {
    try {
        const { title, date, description } = req.body;
        
        // Get panel members from form data
        const panelMembers = Array.isArray(req.body.panelMembers) ? 
            req.body.panelMembers : 
            req.body.panelMembers ? [req.body.panelMembers] : [];

        // Get batch IDs from form data
        const batchIds = Array.isArray(req.body.batchIds) ? 
            req.body.batchIds : 
            req.body.batchIds ? [req.body.batchIds] : [];

        // Validate required fields
        if (!title || !date) {
            req.flash('error_msg', 'Title and date are required');
            return res.redirect('/supervisor/manage-reviews');
        }

        // Validate panel members
        if (panelMembers.length !== 3) {
            req.flash('error_msg', 'Exactly 3 panel members are required');
            return res.redirect('/supervisor/manage-reviews');
        }

        // Validate batch selection
        if (batchIds.length === 0) {
            req.flash('error_msg', 'Please select at least one batch');
            return res.redirect('/supervisor/manage-reviews');
        }

        // Get selected batches
        const batches = await Batch.find({ _id: { $in: batchIds } });
        if (!batches || batches.length === 0) {
            req.flash('error_msg', 'No valid batches found');
            return res.redirect('/supervisor/manage-reviews');
        }

        // Create the review object with proper ObjectId values and required fields
        const review = {
            title,
            date: new Date(date),
            description,
            isGlobal: true,
            scheduledBy: req.user._id, // Explicitly set scheduledBy
            completed: false,
            panelMembers: panelMembers.map(memberId => ({
                member: new mongoose.Types.ObjectId(memberId),
                score: null
            })),
            feedback: []
        };

        // Update batches using updateMany
        const updateResult = await Batch.updateMany(
            { _id: { $in: batchIds } },
            { 
                $push: { 
                    reviewDates: {
                        ...review,
                        scheduledBy: req.user._id // Ensure scheduledBy is set in the update
                    } 
                } 
            }
        );

        if (updateResult.modifiedCount === 0) {
            req.flash('error_msg', 'Failed to schedule review for any batches');
            return res.redirect('/supervisor/manage-reviews');
        }

        // Create notifications for panel members
        try {
            const notifications = panelMembers.map(memberId => ({
                recipient: new mongoose.Types.ObjectId(memberId),
                type: 'review',
                title: 'Panel Member Assignment',
                message: `You have been assigned as a panel member for the global review: ${title}`,
                relatedTo: {
                    model: 'Batch',
                    id: batches[0]._id
                },
                from: req.user._id
            }));

            await Notification.insertMany(notifications);
        } catch (notifyErr) {
            console.error('Error creating notifications:', notifyErr);
            // Continue even if notifications fail
        }

        req.flash('success_msg', `Global review scheduled successfully for ${updateResult.modifiedCount} batches`);
        return res.redirect('/supervisor/manage-reviews');
    } catch (err) {
        console.error('Error scheduling global review:', err);
        req.flash('error_msg', 'Error scheduling global review: ' + err.message);
        return res.redirect('/supervisor/manage-reviews');
    }
});

// Complete Review (Global)
router.post('/review/:batchId/:reviewId/complete', ensureAuthenticated, ensureSupervisor, async (req, res) => {
    try {
        const { feedback, supervisorScore } = req.body;
        
        // Validate required fields
        if (!feedback || !supervisorScore) {
            req.flash('error_msg', 'Both feedback and score are required');
            return res.redirect('/supervisor/manage-reviews');
        }

        const supervisorScoreNum = parseFloat(supervisorScore);
        
        // Validate supervisor score
        if (isNaN(supervisorScoreNum) || supervisorScoreNum < 0 || supervisorScoreNum > 100) {
            req.flash('error_msg', 'Score must be a number between 0 and 100');
            return res.redirect('/supervisor/manage-reviews');
        }

        // Find batch and ensure it exists
        const batch = await Batch.findById(req.params.batchId);
        if (!batch) {
            req.flash('error_msg', 'Batch not found');
            return res.redirect('/supervisor/manage-reviews');
        }

        // Find review in the batch
        const review = batch.reviewDates.id(req.params.reviewId);
        if (!review) {
            req.flash('error_msg', 'Review not found');
            return res.redirect('/supervisor/manage-reviews');
        }

        if (!review.isGlobal) {
            req.flash('error_msg', 'Not authorized to complete this review');
            return res.redirect('/supervisor/manage-reviews');
        }

        // Calculate panel scores
        const panelScores = review.panelMembers
            .map(pm => pm.score)
            .filter(score => score !== null && !isNaN(parseFloat(score)));

        // Update using atomic operations to preserve scheduledBy
        const result = await Batch.findOneAndUpdate(
            {
                _id: req.params.batchId,
                'reviewDates._id': req.params.reviewId
            },
            {
                $set: {
                    'reviewDates.$.supervisorScore': supervisorScoreNum
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
            return res.redirect('/supervisor/manage-reviews');
        }

        // If all panel scores are in, calculate and update aggregate score
        if (panelScores.length === review.panelMembers.length) {
            const avgPanelScore = panelScores.reduce((a, b) => a + b, 0) / panelScores.length;
            const aggregateScore = (supervisorScoreNum * 0.4) + (avgPanelScore * 0.6);
            
            await Batch.findOneAndUpdate(
                {
                    _id: req.params.batchId,
                    'reviewDates._id': req.params.reviewId
                },
                {
                    $set: {
                        'reviewDates.$.aggregateScore': aggregateScore,
                        'reviewDates.$.completed': true
                    }
                }
            );
        }

        // Create notification
        if (batch.faculty) {
            await Notification.create({
                recipient: batch.faculty,
                type: 'feedback',
                title: 'Review Feedback Added',
                message: `Supervisor has added feedback to the review "${review.title}"`,
                relatedTo: {
                    model: 'Batch',
                    id: batch._id
                },
                from: req.user._id
            });
        }

        req.flash('success_msg', 'Review feedback submitted successfully');
        return res.redirect('/supervisor/manage-reviews');
    } catch (err) {
        console.error('Error completing review:', err);
        req.flash('error_msg', 'Error completing review: ' + err.message);
        return res.redirect('/supervisor/manage-reviews');
    }
});

// Panel Member Score Submission
router.post('/review/:batchId/:reviewId/panel-score', ensureAuthenticated, async (req, res) => {
    try {
        const { score, feedback } = req.body;
        const scoreNum = parseFloat(score);
        
        // Validate score
        if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) {
            return res.status(400).json({ error: 'Score must be a number between 0 and 100' });
        }
        
        const batch = await Batch.findById(req.params.batchId);
        if (!batch) {
            console.error('Batch not found:', req.params.batchId);
            return res.status(404).json({ error: 'Batch not found' });
        }

        const review = batch.reviewDates.id(req.params.reviewId);
        if (!review || !review.isGlobal) {
            console.error('Review not found or not global:', req.params.reviewId);
            return res.status(404).json({ error: 'Review not found or not authorized' });
        }

        // Find the panel member entry for the current user
        const panelMember = review.panelMembers.find(pm => 
            pm.member && pm.member.toString() === req.user._id.toString()
        );

        if (!panelMember) {
            console.error('Not authorized as panel member');
            return res.status(403).json({ error: 'Not authorized as panel member' });
        }

        // Update panel member's score and feedback
        panelMember.score = scoreNum;
        panelMember.feedback = feedback;

        // Check if all panel members have submitted scores
        const allScoresSubmitted = review.panelMembers.every(pm => pm.score !== null);
        
        if (allScoresSubmitted && review.supervisorScore !== null) {
            // Calculate aggregate score
            const avgPanelScore = review.panelMembers.reduce((sum, pm) => sum + parseFloat(pm.score || 0), 0) / review.panelMembers.length;
            review.aggregateScore = (review.supervisorScore * 0.4) + (avgPanelScore * 0.6);
            review.completed = true;
            
            // Create notification for supervisor when all scores are submitted
            try {
                await Notification.create({
                    recipient: review.scheduledBy,
                    type: 'review',
                    title: 'All Panel Scores Submitted',
                    message: `All panel members have submitted scores for review "${review.title}"`,
                    relatedTo: {
                        model: 'Batch',
                        id: batch._id
                    },
                    from: req.user._id
                });
            } catch (notifyErr) {
                console.error('Error creating completion notification:', notifyErr);
            }
        }

        await batch.save();

        res.json({ message: 'Score submitted successfully' });
    } catch (err) {
        console.error('Error submitting panel score:', err);
        res.status(500).json({ error: 'Error submitting score' });
    }
});

// Get Batch Reviews
router.get('/batch-reviews/:batchId', ensureAuthenticated, ensureSupervisor, async (req, res) => {
    try {
        const batch = await Batch.findById(req.params.batchId)
            .populate({
                path: 'reviewDates',
                populate: {
                    path: 'feedback.from',
                    select: 'name role'
                }
            });

        if (!batch) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        res.json({ reviews: batch.reviewDates });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error loading reviews' });
    }
});

// Update Review
router.put('/review/:batchId/:reviewId', ensureAuthenticated, ensureSupervisor, async (req, res) => {
    try {
        const { title, date, description } = req.body;
        const batch = await Batch.findById(req.params.batchId);
        
        if (!batch) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        const review = batch.reviewDates.id(req.params.reviewId);
        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        // Don't allow updating completed reviews
        if (review.completed) {
            return res.status(400).json({ error: 'Cannot update completed reviews' });
        }

        review.title = title;
        review.date = date;
        review.description = description;

        await batch.save();

        // Notify relevant users about the update
        const notifications = [
            {
                recipient: batch.faculty,
                type: 'review',
                title: 'Review Updated',
                message: `Review "${title}" has been updated`,
                relatedTo: {
                    model: 'Batch',
                    id: batch._id
                },
                from: req.user._id
            }
        ];

        await Notification.insertMany(notifications);

        res.json({ message: 'Review updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error updating review' });
    }
});

// Delete Review
router.delete('/review/:batchId/:reviewId', ensureAuthenticated, ensureSupervisor, async (req, res) => {
    try {
        const batch = await Batch.findById(req.params.batchId);
        if (!batch) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        const review = batch.reviewDates.id(req.params.reviewId);
        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        // Don't allow deleting completed reviews
        if (review.completed) {
            return res.status(400).json({ error: 'Cannot delete completed reviews' });
        }

        review.remove();
        await batch.save();

        // Notify relevant users about the deletion
        const notifications = [
            {
                recipient: batch.faculty,
                type: 'review',
                title: 'Review Cancelled',
                message: `Review "${review.title}" has been cancelled`,
                relatedTo: {
                    model: 'Batch',
                    id: batch._id
                },
                from: req.user._id
            }
        ];

        await Notification.insertMany(notifications);

        res.json({ message: 'Review deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error deleting review' });
    }
});

// View Student Details and Submissions
router.get('/student/:studentId', ensureAuthenticated, ensureSupervisor, async (req, res) => {
    try {
        console.log('Supervisor viewing student:', req.params.studentId);
        
        const student = await Student.findById(req.params.studentId)
            .populate({
                path: 'batch',
                populate: { 
                    path: 'faculty',
                    select: 'name email department'
                }
            })
            .populate({
                path: 'submissions.feedback.from',
                select: 'name role'
            });

        if (!student) {
            console.log('Student not found');
            req.flash('error_msg', 'Student not found');
            return res.redirect('/supervisor/dashboard');
        }

        console.log('Found student with', student.submissions ? student.submissions.length : 0, 'submissions');

        res.render('supervisor/student-details', {
            user: req.user,
            student: student,
            layout: 'layouts/main'
        });
    } catch (err) {
        console.error('Error viewing student details:', err);
        req.flash('error_msg', 'Error loading student details');
        res.redirect('/supervisor/dashboard');
    }
});

module.exports = router; 