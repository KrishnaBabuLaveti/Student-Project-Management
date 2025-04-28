const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    mustChangePassword: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true,
    discriminatorKey: 'role'
});

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (this.isModified('password')) {
        try {
            const salt = await bcrypt.genSalt(10);
            this.password = await bcrypt.hash(this.password, salt);
            next();
        } catch (error) {
            next(error);
        }
    } else {
        next();
    }
});

// Method to compare password
userSchema.methods.matchPassword = async function(enteredPassword) {
    try {
        return await bcrypt.compare(enteredPassword, this.password);
    } catch (error) {
        throw error;
    }
};

// Add verifyPassword as an alias for matchPassword for backward compatibility
userSchema.methods.verifyPassword = function(enteredPassword) {
    return this.matchPassword(enteredPassword);
};

const User = mongoose.model('User', userSchema);
module.exports = User; 