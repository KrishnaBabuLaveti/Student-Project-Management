/**
 * This script fixes any student records that don't have proper batch references
 * by checking the batch collections and updating the student records accordingly.
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import models
const Student = require('../models/Student');
const Batch = require('../models/Batch');

async function fixStudentBatchReferences() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/project_management', {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            family: 4
        });
        
        console.log('Connected to MongoDB');
        
        // Get all batches
        const batches = await Batch.find();
        console.log(`Found ${batches.length} batches`);
        
        // Process each batch
        for (const batch of batches) {
            if (!batch.students || batch.students.length === 0) {
                console.log(`Batch ${batch.name} has no students assigned`);
                continue;
            }
            
            console.log(`Processing batch ${batch.name} with ${batch.students.length} students`);
            
            // Update all students in this batch
            const result = await Student.updateMany(
                { _id: { $in: batch.students }, batch: { $exists: false } },
                { $set: { batch: batch._id } }
            );
            
            console.log(`Updated ${result.modifiedCount} students to reference batch ${batch.name}`);
        }
        
        // Find students that don't have a batch assigned
        const studentsWithoutBatch = await Student.find({ batch: { $exists: false } });
        console.log(`Found ${studentsWithoutBatch.length} students without a batch assigned`);
        
        // Look for batches that include these students
        for (const student of studentsWithoutBatch) {
            const batch = await Batch.findOne({ students: student._id });
            
            if (batch) {
                console.log(`Found batch ${batch.name} for student ${student.name} (${student.jntuNumber})`);
                
                // Update student to reference this batch
                student.batch = batch._id;
                await student.save();
                
                console.log(`Updated student ${student.name} to reference batch ${batch.name}`);
            } else {
                console.log(`No batch found for student ${student.name} (${student.jntuNumber})`);
            }
        }
        
        console.log('Script completed successfully');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

// Run the script
fixStudentBatchReferences(); 