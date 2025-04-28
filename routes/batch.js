const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const Batch = require('../models/Batch');

// View batch remarks
router.get('/:batchId/remarks', ensureAuthenticated, async (req, res) => {
    try {
        const batch = await Batch.findById(req.params.batchId)
            .populate('faculty')
            .populate('students')
            .populate({
                path: 'remarks.from',
                select: 'name role'
            });

        if (!batch) {
            req.flash('error_msg', 'Batch not found');
            return res.redirect('/dashboard');
        }

        // Check if user has permission to view remarks
        const isAuthorized = req.user.role === 'supervisor' || 
            (req.user.role === 'faculty' && batch.faculty._id.toString() === req.user._id.toString()) ||
            (req.user.role === 'student' && batch.students.some(s => s._id.toString() === req.user._id.toString()));

        if (!isAuthorized) {
            req.flash('error_msg', 'Not authorized to view batch remarks');
            return res.redirect('/dashboard');
        }

        res.render('batch/remarks', {
            batch,
            user: req.user
        });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error loading batch remarks');
        res.redirect('/dashboard');
    }
});

// Add remark
router.post('/:batchId/remark', ensureAuthenticated, async (req, res) => {
    try {
        const batch = await Batch.findById(req.params.batchId);
        if (!batch) {
            req.flash('error_msg', 'Batch not found');
            return res.redirect('back');
        }

        // Check if user has permission to add remarks
        const isAuthorized = req.user.role === 'supervisor' || 
            (req.user.role === 'faculty' && batch.faculty._id.toString() === req.user._id.toString());

        if (!isAuthorized) {
            req.flash('error_msg', 'Not authorized to add remarks');
            return res.redirect('back');
        }

        // Validate remark type based on user role
        const { type, content } = req.body;
        if (type === 'warning' && req.user.role !== 'supervisor') {
            req.flash('error_msg', 'Only supervisors can add warning remarks');
            return res.redirect('back');
        }

        batch.remarks.push({
            from: req.user._id,
            content,
            type
        });

        await batch.save();

        // If it's a warning, we might want to notify relevant users
        if (type === 'warning') {
            // TODO: Implement notification system
            // notifyUsers(batch, 'warning', content);
        }

        req.flash('success_msg', 'Remark added successfully');
        res.redirect(`/batch/${batch._id}/remarks`);
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error adding remark');
        res.redirect('back');
    }
});

// Delete remark
router.delete('/:batchId/remark/:remarkId', ensureAuthenticated, async (req, res) => {
    try {
        const batch = await Batch.findById(req.params.batchId);
        if (!batch) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        const remark = batch.remarks.id(req.params.remarkId);
        if (!remark) {
            return res.status(404).json({ error: 'Remark not found' });
        }

        // Check if user has permission to delete remark
        const isAuthorized = req.user.role === 'supervisor' || 
            (req.user.role === 'faculty' && 
             batch.faculty._id.toString() === req.user._id.toString() && 
             remark.from.toString() === req.user._id.toString());

        if (!isAuthorized) {
            return res.status(403).json({ error: 'Not authorized to delete this remark' });
        }

        remark.remove();
        await batch.save();

        res.json({ message: 'Remark deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error deleting remark' });
    }
});

// Get batch remarks (API endpoint)
router.get('/:batchId/remarks/api', ensureAuthenticated, async (req, res) => {
    try {
        const batch = await Batch.findById(req.params.batchId)
            .populate({
                path: 'remarks.from',
                select: 'name role'
            });

        if (!batch) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        // Check if user has permission to view remarks
        const isAuthorized = req.user.role === 'supervisor' || 
            (req.user.role === 'faculty' && batch.faculty._id.toString() === req.user._id.toString()) ||
            (req.user.role === 'student' && batch.students.some(s => s._id.toString() === req.user._id.toString()));

        if (!isAuthorized) {
            return res.status(403).json({ error: 'Not authorized to view remarks' });
        }

        res.json({ remarks: batch.remarks });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error loading remarks' });
    }
});

module.exports = router; 