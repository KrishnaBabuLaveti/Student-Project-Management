const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    recipients: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        read: {
            type: Boolean,
            default: false
        },
        readAt: Date
    }],
    batch: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Batch'
    },
    type: {
        type: String,
        enum: ['direct', 'group', 'announcement'],
        required: true
    },
    subject: {
        type: String,
        required: true
    },
    content: {
        type: String,
        required: true
    },
    attachments: [{
        filename: String,
        path: String,
        mimetype: String,
        size: Number
    }],
    parentMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message'
    },
    isAnnouncement: {
        type: Boolean,
        default: false
    },
    priority: {
        type: String,
        enum: ['low', 'normal', 'high'],
        default: 'normal'
    }
}, { timestamps: true });

// Indexes for better query performance
messageSchema.index({ sender: 1, 'recipients.user': 1 });
messageSchema.index({ batch: 1, createdAt: -1 });
messageSchema.index({ type: 1, createdAt: -1 });

// Method to mark message as read for a user
messageSchema.methods.markAsRead = async function(userId) {
    const recipient = this.recipients.find(r => r.user.toString() === userId.toString());
    if (recipient && !recipient.read) {
        recipient.read = true;
        recipient.readAt = new Date();
        await this.save();
    }
};

// Static method to get unread count for a user
messageSchema.statics.getUnreadCount = async function(userId) {
    return this.countDocuments({
        'recipients.user': userId,
        'recipients.read': false
    });
};

// Static method to get conversation between users
messageSchema.statics.getConversation = async function(user1Id, user2Id, limit = 20, skip = 0) {
    return this.find({
        type: 'direct',
        $or: [
            { sender: user1Id, 'recipients.user': user2Id },
            { sender: user2Id, 'recipients.user': user1Id }
        ]
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('sender', 'name role')
    .exec();
};

// Static method to get batch messages
messageSchema.statics.getBatchMessages = async function(batchId, limit = 20, skip = 0) {
    return this.find({
        batch: batchId,
        type: 'group'
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('sender', 'name role')
    .exec();
};

// Static method to get announcements
messageSchema.statics.getAnnouncements = async function(filters = {}, limit = 10) {
    const query = { 
        type: 'announcement',
        isAnnouncement: true,
        ...filters
    };
    
    return this.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('sender', 'name role')
        .exec();
};

// Pre-save middleware to handle notifications
messageSchema.pre('save', async function(next) {
    if (this.isNew) {
        try {
            // Create notifications for recipients
            const Notification = mongoose.model('Notification');
            const notifications = this.recipients.map(recipient => ({
                recipient: recipient.user,
                type: this.isAnnouncement ? 'announcement' : 'message',
                title: this.isAnnouncement ? 'New Announcement' : 'New Message',
                message: this.subject,
                relatedTo: {
                    model: 'Message',
                    id: this._id
                },
                from: this.sender,
                priority: this.priority
            }));

            await Notification.insertMany(notifications);
        } catch (err) {
            console.error('Error creating message notifications:', err);
        }
    }
    next();
});

const Message = mongoose.model('Message', messageSchema);

module.exports = Message; 