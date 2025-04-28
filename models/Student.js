const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./User');

// Submission Schema
const submissionSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        enum: ['report', 'presentation', 'documentation']
    },
    fileUrl: {
        type: String,
        required: true
    },
    submittedAt: {
        type: Date,
        default: Date.now
    },
    feedback: [{
        from: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        rating: {
            type: Number,
            min: 0,
            max: 10
        },
        comment: String,
        createdAt: {
            type: Date,
            default: Date.now
        }
    }]
});

// Milestone Schema
const milestoneSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    description: String,
    dueDate: Date,
    completed: {
        type: Boolean,
        default: false
    },
    completedAt: Date
});

const studentSchema = new mongoose.Schema({
    jntuNumber: {
        type: String,
        required: true,
        unique: true
    },
    department: {
        type: String,
        required: true,
        enum: ['CSE', 'CSE-AIML', 'CSE-AIDS', 'IT', 'ECE', 'MECH', 'CIVIL']
    },
    branch: {
        type: String,
        required: true
    },
    cgpa: {
        type: Number,
        required: true,
        min: 0,
        max: 10
    },
    batch: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Batch'
    },
    submissions: [submissionSchema],
    milestones: [milestoneSchema]
}, {
    timestamps: true
});

// Create the Student model using User's discriminator
const Student = User.discriminator('Student', studentSchema);
module.exports = Student; 