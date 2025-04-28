const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['review', 'feedback', 'warning', 'submission', 'announcement', 'message'],
        required: true
    },
    title: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    relatedTo: {
        model: {
            type: String,
            enum: ['Batch', 'Review', 'Submission', 'Message'],
            required: true
        },
        id: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        }
    },
    from: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    read: {
        type: Boolean,
        default: false
    },
    emailSent: {
        type: Boolean,
        default: false
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
    }
}, { timestamps: true });

// Method to mark notification as read
notificationSchema.methods.markAsRead = async function() {
    this.read = true;
    return this.save();
};

// Static method to create and send notification
notificationSchema.statics.createAndSend = async function(data) {
    try {
        const notification = await this.create(data);
        
        // Send email if email notifications are enabled for this type
        if (data.sendEmail) {
            await sendEmail({
                to: data.recipientEmail,
                subject: data.title,
                text: data.message,
                html: generateEmailTemplate(data)
            });
            notification.emailSent = true;
            await notification.save();
        }

        // Emit socket event for real-time notification
        global.io.to(data.recipient.toString()).emit('new_notification', {
            notification: {
                _id: notification._id,
                type: notification.type,
                title: notification.title,
                message: notification.message,
                createdAt: notification.createdAt
            }
        });

        return notification;
    } catch (err) {
        console.error('Error creating notification:', err);
        throw err;
    }
};

// Static method to get unread notifications count
notificationSchema.statics.getUnreadCount = async function(userId) {
    return this.countDocuments({ recipient: userId, read: false });
};

// Static method to get recent notifications
notificationSchema.statics.getRecent = async function(userId, limit = 10) {
    return this.find({ recipient: userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('from', 'name role')
        .exec();
};

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification; 