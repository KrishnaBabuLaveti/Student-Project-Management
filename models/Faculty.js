const mongoose = require('mongoose');
const User = require('./User');

const facultySchema = new mongoose.Schema({
    department: {
        type: String,
        required: true,
        enum: ['CSE', 'CSE-AIML', 'CSE-AIDS', 'IT', 'ECE', 'MECH', 'CIVIL']
    },
    assignedBatches: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Batch'
    }]
}, {
    timestamps: true
});

// Create and export the Faculty model using User's discriminator
// Note: Using 'faculty' (lowercase) to match what's used in the auth middleware
const Faculty = User.discriminator('faculty', facultySchema);
module.exports = Faculty; 