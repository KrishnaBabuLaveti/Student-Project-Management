const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config/config');

let io;

const initializeSocket = (server) => {
    io = socketIO(server);
    
    // Middleware to authenticate socket connections
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error('Authentication error'));
            }

            const decoded = jwt.verify(token, config.jwt.secret);
            socket.userId = decoded.id;
            socket.userRole = decoded.role;
            next();
        } catch (err) {
            next(new Error('Authentication error'));
        }
    });

    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.userId}`);
        
        // Join user's personal room
        socket.join(socket.userId.toString());
        
        // Join role-based room
        if (socket.userRole) {
            socket.join(`role_${socket.userRole}`);
        }

        // Handle joining batch room
        socket.on('join_batch', (batchId) => {
            socket.join(`batch_${batchId}`);
            console.log(`User ${socket.userId} joined batch ${batchId}`);
        });

        // Handle leaving batch room
        socket.on('leave_batch', (batchId) => {
            socket.leave(`batch_${batchId}`);
            console.log(`User ${socket.userId} left batch ${batchId}`);
        });

        // Handle direct messages
        socket.on('direct_message', async (data) => {
            try {
                const Message = require('../models/Message');
                const message = await Message.create({
                    sender: socket.userId,
                    recipients: [{ user: data.recipientId }],
                    type: 'direct',
                    subject: data.subject,
                    content: data.content
                });

                io.to(data.recipientId.toString()).emit('new_message', {
                    message: {
                        _id: message._id,
                        sender: socket.userId,
                        subject: message.subject,
                        content: message.content,
                        createdAt: message.createdAt
                    }
                });
            } catch (err) {
                console.error('Error sending direct message:', err);
                socket.emit('error', { message: 'Error sending message' });
            }
        });

        // Handle batch messages
        socket.on('batch_message', async (data) => {
            try {
                const Message = require('../models/Message');
                const message = await Message.create({
                    sender: socket.userId,
                    batch: data.batchId,
                    type: 'group',
                    subject: data.subject,
                    content: data.content
                });

                io.to(`batch_${data.batchId}`).emit('new_batch_message', {
                    message: {
                        _id: message._id,
                        sender: socket.userId,
                        subject: message.subject,
                        content: message.content,
                        createdAt: message.createdAt
                    }
                });
            } catch (err) {
                console.error('Error sending batch message:', err);
                socket.emit('error', { message: 'Error sending message' });
            }
        });

        // Handle typing indicators
        socket.on('typing_start', (data) => {
            if (data.type === 'direct') {
                socket.to(data.recipientId.toString()).emit('typing_indicator', {
                    userId: socket.userId,
                    type: 'start'
                });
            } else if (data.type === 'batch') {
                socket.to(`batch_${data.batchId}`).emit('typing_indicator', {
                    userId: socket.userId,
                    type: 'start'
                });
            }
        });

        socket.on('typing_end', (data) => {
            if (data.type === 'direct') {
                socket.to(data.recipientId.toString()).emit('typing_indicator', {
                    userId: socket.userId,
                    type: 'end'
                });
            } else if (data.type === 'batch') {
                socket.to(`batch_${data.batchId}`).emit('typing_indicator', {
                    userId: socket.userId,
                    type: 'end'
                });
            }
        });

        // Handle disconnection
        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.userId}`);
        });
    });

    // Make io instance globally available
    global.io = io;
    return io;
};

// Function to emit notification to specific users
const emitNotification = (recipients, notification) => {
    if (!io) {
        console.error('Socket.io not initialized');
        return;
    }

    recipients.forEach(recipientId => {
        io.to(recipientId.toString()).emit('notification', notification);
    });
};

// Function to emit batch notification
const emitBatchNotification = (batchId, notification) => {
    if (!io) {
        console.error('Socket.io not initialized');
        return;
    }

    io.to(`batch_${batchId}`).emit('batch_notification', notification);
};

// Function to emit role-based notification
const emitRoleNotification = (role, notification) => {
    if (!io) {
        console.error('Socket.io not initialized');
        return;
    }

    io.to(`role_${role}`).emit('role_notification', notification);
};

module.exports = {
    initializeSocket,
    emitNotification,
    emitBatchNotification,
    emitRoleNotification
}; 