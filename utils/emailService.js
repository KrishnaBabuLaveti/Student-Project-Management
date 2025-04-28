const nodemailer = require('nodemailer');
const config = require('../config/config');

// Create reusable transporter object using SMTP transport
const transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: {
        user: config.email.user,
        pass: config.email.password
    }
});

// Email templates for different notification types
const emailTemplates = {
    review: (data) => ({
        subject: `Review Scheduled: ${data.title}`,
        html: `
            <h2>Project Review Scheduled</h2>
            <p>Hello ${data.recipientName},</p>
            <p>A new project review has been scheduled:</p>
            <ul>
                <li><strong>Title:</strong> ${data.title}</li>
                <li><strong>Date:</strong> ${new Date(data.date).toLocaleString()}</li>
                <li><strong>Batch:</strong> ${data.batchName}</li>
                ${data.description ? `<li><strong>Description:</strong> ${data.description}</li>` : ''}
            </ul>
            <p>Please be prepared for the review.</p>
        `
    }),
    feedback: (data) => ({
        subject: `New Feedback Received: ${data.title}`,
        html: `
            <h2>New Feedback Received</h2>
            <p>Hello ${data.recipientName},</p>
            <p>You have received new feedback:</p>
            <div style="padding: 15px; background-color: #f8f9fa; border-radius: 5px;">
                <p><strong>From:</strong> ${data.senderName}</p>
                <p><strong>Regarding:</strong> ${data.title}</p>
                <p><strong>Feedback:</strong> ${data.message}</p>
            </div>
        `
    }),
    warning: (data) => ({
        subject: `Important Warning: ${data.title}`,
        html: `
            <h2 style="color: #dc3545;">Warning Notice</h2>
            <p>Hello ${data.recipientName},</p>
            <p>A warning has been issued:</p>
            <div style="padding: 15px; background-color: #fff3cd; border-radius: 5px;">
                <p><strong>Warning:</strong> ${data.message}</p>
                <p><strong>Issued by:</strong> ${data.senderName}</p>
            </div>
            <p>Please take necessary action immediately.</p>
        `
    }),
    submission: (data) => ({
        subject: `Submission Update: ${data.title}`,
        html: `
            <h2>Project Submission Update</h2>
            <p>Hello ${data.recipientName},</p>
            <p>${data.message}</p>
            <p><strong>Submission Details:</strong></p>
            <ul>
                <li>Type: ${data.submissionType}</li>
                <li>Date: ${new Date(data.submissionDate).toLocaleString()}</li>
                ${data.feedback ? `<li>Feedback: ${data.feedback}</li>` : ''}
            </ul>
        `
    }),
    announcement: (data) => ({
        subject: `Announcement: ${data.title}`,
        html: `
            <h2>New Announcement</h2>
            <p>Hello ${data.recipientName},</p>
            <div style="padding: 15px; background-color: #f8f9fa; border-radius: 5px;">
                <h3>${data.title}</h3>
                <p>${data.message}</p>
            </div>
            <p><small>Posted by: ${data.senderName}</small></p>
        `
    })
};

// Function to generate email content based on notification type
const generateEmailTemplate = (data) => {
    const template = emailTemplates[data.type];
    if (!template) {
        throw new Error(`Email template not found for type: ${data.type}`);
    }
    return template(data);
};

// Function to send email
const sendEmail = async (options) => {
    try {
        const info = await transporter.sendMail({
            from: `"${config.email.fromName}" <${config.email.fromAddress}>`,
            to: options.to,
            subject: options.subject,
            text: options.text,
            html: options.html
        });

        console.log('Email sent:', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
};

// Function to send batch notification
const sendBatchNotification = async (batch, type, data) => {
    try {
        const recipients = await getBatchRecipients(batch);
        const emailPromises = recipients.map(recipient => {
            const emailData = {
                ...data,
                recipientName: recipient.name,
                recipientEmail: recipient.email
            };
            const template = generateEmailTemplate({
                type,
                ...emailData
            });
            
            return sendEmail({
                to: recipient.email,
                subject: template.subject,
                html: template.html
            });
        });

        await Promise.all(emailPromises);
    } catch (error) {
        console.error('Error sending batch notification:', error);
        throw error;
    }
};

// Helper function to get batch recipients
const getBatchRecipients = async (batch) => {
    await batch.populate('students faculty').execPopulate();
    const recipients = [...batch.students];
    if (batch.faculty) {
        recipients.push(batch.faculty);
    }
    return recipients;
};

module.exports = {
    sendEmail,
    generateEmailTemplate,
    sendBatchNotification
}; 