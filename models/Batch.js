const mongoose = require('mongoose');

// Import Faculty model to ensure it's loaded first
require('./Faculty');

const reviewSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    description: String,
    completed: {
        type: Boolean,
        default: false
    },
    isGlobal: {
        type: Boolean,
        default: false
    },
    scheduledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    panelMembers: [{
        member: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'faculty'
        },
        score: {
            type: Number,
            min: 0,
            max: 100,
            default: null
        },
        feedback: String
    }],
    supervisorScore: {
        type: Number,
        min: 0,
        max: 100,
        default: null
    },
    aggregateScore: {
        type: Number,
        min: 0,
        max: 100,
        default: null
    },
    feedback: [{
        from: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        comment: {
            type: String,
            required: true
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }]
});

const batchSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    department: {
        type: String,
        required: true,
        enum: ['CSE', 'CSE-AIML', 'CSE-AIDS', 'IT', 'ECE', 'MECH', 'CIVIL']
    },
    academicYear: {
        type: String,
        required: true
    },
    faculty: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'faculty',
        required: false
    },
    students: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student'
    }],
    status: {
        type: String,
        enum: ['active', 'completed', 'pending'],
        default: 'active'
    },
    projectTitle: {
        type: String,
        default: ''
    },
    projectDescription: {
        type: String,
        default: ''
    },
    averageCGPA: {
        type: Number,
        min: 0,
        max: 10
    },
    reviewDates: [reviewSchema],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

// Method to check if batch is full
batchSchema.methods.isFull = function() {
    return this.students.length >= 4;
};

// Pre-save middleware to update faculty's assignedBatches
batchSchema.pre('save', async function(next) {
    try {
        if (this.isModified('faculty')) {
            const FacultyModel = mongoose.model('faculty');
            
            // If there was a previous faculty, remove this batch from their assignments
            if (this._oldFaculty) {
                await FacultyModel.findByIdAndUpdate(
                    this._oldFaculty,
                    { $pull: { assignedBatches: this._id } }
                );
            }
            
            // Add this batch to the new faculty's assignments
            if (this.faculty) {
                await FacultyModel.findByIdAndUpdate(
                    this.faculty,
                    { $addToSet: { assignedBatches: this._id } }
                );
            }
        }
        next();
    } catch (error) {
        next(error);
    }
});

// Store the old faculty ID before updating
batchSchema.pre('save', function(next) {
    if (this.isModified('faculty')) {
        this._oldFaculty = this.get('faculty');
    }
    next();
});

const Batch = mongoose.model('Batch', batchSchema);
module.exports = Batch; 