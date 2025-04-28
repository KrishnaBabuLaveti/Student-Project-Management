const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    req.flash('error_msg', 'Please log in to view this resource');
    res.redirect('/');
};

const ensureStudent = (req, res, next) => {
    if (!req.isAuthenticated()) {
        console.log('Student access denied: Not authenticated');
        req.flash('error_msg', 'Please log in to access this resource');
        return res.redirect('/');
    }

    if (!req.user) {
        console.log('Student access denied: No user object');
        req.flash('error_msg', 'User session invalid');
        return res.redirect('/');
    }

    console.log('Student auth check:', {
        userId: req.user._id,
        jntuNumber: req.user.jntuNumber,
        path: req.path
    });

    // Check if user is a student by checking for jntuNumber
    if (req.user.jntuNumber) {
        return next();
    }

    console.log('Student access denied: Not a student user');
    req.flash('error_msg', 'You must be a student to access this resource');
    res.redirect('/');
};

const ensureFaculty = (req, res, next) => {
    if (!req.isAuthenticated()) {
        console.log('Faculty access denied: Not authenticated');
        req.flash('error_msg', 'Please log in to access this resource');
        return res.redirect('/');
    }

    if (!req.user) {
        console.log('Faculty access denied: No user object');
        req.flash('error_msg', 'User session invalid');
        return res.redirect('/');
    }

    console.log('Faculty auth check:', {
        userId: req.user._id,
        role: req.user.role,
        path: req.path
    });

    // Check for lowercase 'faculty' as per the discriminator
    if (req.user.role === 'faculty') {
        return next();
    }

    console.log('Faculty access denied: Invalid role -', req.user.role);
    req.flash('error_msg', 'You must be a faculty member to access this resource');
    res.redirect('/');
};

const ensureSupervisor = (req, res, next) => {
    if (req.user && req.user.role === 'supervisor') {
        return next();
    }
    req.flash('error_msg', 'Not authorized');
    res.redirect('/');
};

// Middleware to check if password change is required
const checkPasswordChange = (req, res, next) => {
    if (req.user && req.user.mustChangePassword && 
        req.path !== '/change-password' && 
        req.path !== '/logout') {
        req.flash('warning_msg', 'You must change your password before continuing');
        return res.redirect('/change-password');
    }
    next();
};

const forwardAuthenticated = (req, res, next) => {
    if (!req.isAuthenticated()) {
        return next();
    }
    res.redirect('/dashboard');
};

module.exports = {
    ensureAuthenticated,
    ensureStudent,
    ensureFaculty,
    ensureSupervisor,
    checkPasswordChange,
    forwardAuthenticated
}; 