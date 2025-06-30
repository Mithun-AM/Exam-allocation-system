const mongoose = require('mongoose');

const allocationSchema = new mongoose.Schema({
    examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    facultyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Invigilator
    facultyName: { type: String, required: true },
    date: { type: Date, required: true },
    startTime: { type: String, required: true }, //Stores Exam Start Time (e.g., "10:00 AM") in UTC format
    endTime: { type: String, required: true } 
}, { timestamps: true });

module.exports = mongoose.model("Allocation", allocationSchema);
