module.exports = {
    email: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER || 'your-email@gmail.com',
            pass: process.env.EMAIL_PASS || 'your-app-specific-password'
        },
        fromName: 'Project Management System',
        fromAddress: process.env.EMAIL_USER || 'your-email@gmail.com'
    }
}; 