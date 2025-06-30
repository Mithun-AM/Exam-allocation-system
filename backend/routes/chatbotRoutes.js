const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const axios = require("axios");
const { DataAPIClient } = require("@datastax/astra-db-ts");

// Models
const Allocation = require("../models/Allocation");
const Exam = require("../models/Exam");
const Room = require("../models/Room");
const Subject = require("../models/Subject");
const User = require("../models/User");
const RoomAllocation = require("../models/RoomAllocation");

// Configuration
const LLAMA_API_URL = "http://localhost:1234/v1";
const EMBEDDING_MODEL = "text-embedding-nomic-embed-text-v1.5";
const CHAT_MODEL = "llama-3.2-1b-instruct";
const ASTRA_DB_ID = process.env.ASTRA_DB_ID;
const ASTRA_DB_REGION = process.env.ASTRA_DB_REGION;
const ASTRA_DB_TOKEN = process.env.ASTRA_DB_TOKEN;
const ASTRA_DB_NAMESPACE = process.env.ASTRA_DB_NAMESPACE || "default_keyspace";

// Service Initialization
let astraCollection;

async function initializeServices() {
  try {
    const astraClient = new DataAPIClient(ASTRA_DB_TOKEN);
    const db = astraClient.db(`https://${ASTRA_DB_ID}-${ASTRA_DB_REGION}.apps.astra.datastax.com`, {
      namespace: ASTRA_DB_NAMESPACE
    });

    try {
      await db.dropCollection("exam_embeddings");
      console.log("Old collection dropped");
    } catch (err) {
      if (!err.message.includes("not found")) {
        console.warn("Drop collection warning:", err.message);
      }
    }

    astraCollection = await db.createCollection("exam_embeddings", {
      vector: {
        dimension: 768,
        metric: "cosine"
      }
    });
    console.log("✅ Vector collection ready");
  } catch (err) {
    console.error("🔴 Initialization failed:", err);
    throw err;
  }
}

// Embedding generation
async function getEmbedding(text) {
  try {
    const response = await axios.post(`${LLAMA_API_URL}/embeddings`, {
      input: text,
      model: EMBEDDING_MODEL
    });
    return response.data.data[0].embedding;
  } catch (err) {
    console.error("Embedding error:", err.message);
    throw new Error("Failed to generate embeddings");
  }
}

// Helper functions
function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function formatTime(time) {
  return new Date(`1970-01-01T${time}`).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Enhanced text builders for each entity type
function buildExamText(exam, subjects = [], faculties = [], rooms = []) {
  const subjectList = subjects.map(s => 
    `${s.name} (${s.subjectCode}) on ${formatDate(s.date)} ${s.startTime}-${s.endTime}`
  ).join('\n  - ');
  
  const facultyList = faculties.map(f => 
    `${f.name} (${f.designation})`
  ).join('\n  - ');
  
  const roomList = rooms.map(r => 
    `${r.building} Room ${r.roomNumber} (Capacity: ${r.capacity})`
  ).join('\n  - ');

  return `Exam: ${exam.name} (Year: ${exam.year})
- Semesters: ${exam.semesters.map(s => `Sem ${s.semester} (${s.totalStudents} students)`).join(', ')}
- Subjects:
  - ${subjectList}
- Faculties:
  - ${facultyList}
- Rooms:
  - ${roomList}`;
}

function buildAllocationText(alloc, exam, subject, room, faculty) {
  return `Allocation for ${exam.name}:
- Faculty: ${faculty.name} (${faculty.designation})
- Subject: ${subject.name} (Sem ${subject.semester})
- Room: ${room.building} Room ${room.roomNumber}
- Date: ${formatDate(alloc.date)}
- Time: ${alloc.startTime} to ${alloc.endTime}`;
}

function buildRoomAllocationText(roomAlloc, exam, room, subjects = []) {
  const subjectList = subjects.length > 0 
    ? subjects.map(s => `${s.name} (Sem ${s.semester})`).join(' and ')
    : 'No subjects specified';

  return `Room Allocation for ${exam.name}:
- Room: ${room.building} Room ${room.roomNumber} (Capacity: ${room.capacity})
- Subjects: ${subjectList}
- Students: ${roomAlloc.students.length} students
- Date: ${formatDate(roomAlloc.date)}
- Time: ${roomAlloc.startTime} to ${roomAlloc.endTime}`;
}

// Cache Data Endpoint - Now with proper relationships
router.post('/cache-data', authMiddleware.auth, authMiddleware.isAdmin, async (req, res) => {
  try {
    if (!astraCollection) throw new Error("Database not ready");
    await astraCollection.deleteAll();

    // Fetch all data with proper population
    const [exams, rooms, subjects, allocations, roomAllocations, faculties] = await Promise.all([
      Exam.find().lean(),
      Room.find().lean(),
      Subject.find().populate('exam').lean(),
      Allocation.find()
        .populate('examId subjectId roomId facultyId')
        .lean(),
      RoomAllocation.find()
        .populate('examId roomId subjectId subjectIds')
        .lean(),
      User.find({ role: 'Faculty' }).lean()
    ]);

    // Create lookup maps for quick reference
    const examMap = new Map(exams.map(e => [e._id.toString(), e]));
    const roomMap = new Map(rooms.map(r => [r._id.toString(), r]));
    const subjectMap = new Map(subjects.map(s => [s._id.toString(), s]));
    const facultyMap = new Map(faculties.map(f => [f._id.toString(), f]));

    // Process Exams with all related data
    const examInserts = exams.map(async exam => {
      const examSubjects = subjects.filter(s => s.exam._id.toString() === exam._id.toString());
      const examFaculties = exam.faculty.map(fId => facultyMap.get(fId.toString())).filter(Boolean);
      const examRooms = exam.rooms.map(rId => roomMap.get(rId.toString())).filter(Boolean);

      const content = buildExamText(exam, examSubjects, examFaculties, examRooms);
      
      return astraCollection.insertOne({
        _id: `exam_${exam._id}`,
        content,
        embedding: await getEmbedding(content),
        metadata: {
          type: 'exam',
          examId: exam._id.toString(),
          name: exam.name,
          year: exam.year,
          semesters: exam.semesters.map(s => s.semester)
        }
      });
    });

    // Process Allocations
    const allocInserts = allocations.map(async alloc => {
      const exam = examMap.get(alloc.examId._id.toString());
      const subject = subjectMap.get(alloc.subjectId._id.toString());
      const room = roomMap.get(alloc.roomId._id.toString());
      const faculty = facultyMap.get(alloc.facultyId._id.toString());

      if (!exam || !subject || !room || !faculty) return null;

      const content = buildAllocationText(alloc, exam, subject, room, faculty);
      
      return astraCollection.insertOne({
        _id: `alloc_${alloc._id}`,
        content,
        embedding: await getEmbedding(content),
        metadata: {
          type: 'allocation',
          allocationId: alloc._id.toString(),
          examId: exam._id.toString(),
          subjectId: subject._id.toString(),
          roomId: room._id.toString(),
          facultyId: faculty._id.toString(),
          date: alloc.date,
          time: `${alloc.startTime}-${alloc.endTime}`
        }
      });
    }).filter(Boolean);

    // Process Room Allocations
    const roomAllocInserts = roomAllocations.map(async roomAlloc => {
      const exam = examMap.get(roomAlloc.examId._id.toString());
      const room = roomMap.get(roomAlloc.roomId._id.toString());
      
      // Handle both single subject and multiple subjects cases
      const subjectIds = roomAlloc.subjectId 
        ? [roomAlloc.subjectId._id.toString()]
        : roomAlloc.subjectIds.map(s => s._id.toString());
      
      const roomSubjects = subjectIds.map(id => subjectMap.get(id)).filter(Boolean);

      if (!exam || !room || roomSubjects.length === 0) return null;

      const content = buildRoomAllocationText(roomAlloc, exam, room, roomSubjects);
      
      return astraCollection.insertOne({
        _id: `roomalloc_${roomAlloc._id}`,
        content,
        embedding: await getEmbedding(content),
        metadata: {
          type: 'room_allocation',
          roomAllocationId: roomAlloc._id.toString(),
          examId: exam._id.toString(),
          roomId: room._id.toString(),
          subjectIds: roomSubjects.map(s => s._id.toString()),
          studentCount: roomAlloc.students.length,
          date: roomAlloc.date,
          time: `${roomAlloc.startTime}-${roomAlloc.endTime}`
        }
      });
    }).filter(Boolean);

    // Execute all inserts in parallel
    await Promise.all([...examInserts, ...allocInserts, ...roomAllocInserts]);

    res.json({
      success: true,
      message: `Data cached successfully: ${exams.length} exams, ${allocations.length} allocations, ${roomAllocations.length} room allocations`
    });
  } catch (err) {
    console.error("Cache error:", err);
    res.status(500).json({
      success: false,
      error: `Cache failed: ${err.message}`
    });
  }
});

// Enhanced Admin Chatbot with proper context building
router.post("/admin", authMiddleware.auth, authMiddleware.isAdmin, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) throw new Error("Query is required");

    // 1. Get query embedding
    const queryEmbedding = await getEmbedding(query);

    // 2. Search vector database for relevant information
    const vectorResults = await astraCollection.find(
      {},
      {
        sort: { $vector: queryEmbedding },
        limit: 7, // Get more context for complex exam structures
        includeSimilarity: true,
        minSimilarity: 0.25 // Lower threshold to catch more potential matches
      }
    );

    const results = await vectorResults.toArray();
    
    // 3. Filter results by similarity and group by type
    const relevantResults = results.filter(r => r.$similarity >= 0.3);
    
    if (relevantResults.length === 0) {
      return res.json({ 
        success: true, 
        answer: "No relevant exam data available for this query." 
      });
    }

    // 4. Build organized context
    let context = "Exam System Information:\n\n";
    
    // Group results by type for better organization
    const examContexts = [];
    const allocationContexts = [];
    const roomAllocationContexts = [];
    
    relevantResults.forEach(result => {
      switch (result.metadata.type) {
        case 'exam':
          examContexts.push(result.content);
          break;
        case 'allocation':
          allocationContexts.push(result.content);
          break;
        case 'room_allocation':
          roomAllocationContexts.push(result.content);
          break;
      }
    });

    if (examContexts.length > 0) {
      context += "EXAMS:\n" + examContexts.join('\n\n') + '\n\n';
    }
    
    if (allocationContexts.length > 0) {
      context += "FACULTY ALLOCATIONS:\n" + allocationContexts.join('\n\n') + '\n\n';
    }
    
    if (roomAllocationContexts.length > 0) {
      context += "ROOM ALLOCATIONS:\n" + roomAllocationContexts.join('\n\n') + '\n\n';
    }

    // 5. Query LLM with structured context
    const response = await axios.post(`${LLAMA_API_URL}/chat/completions`, {
      model: CHAT_MODEL,
      messages: [{
        role: "system",
        content: `You are an exam administration assistant. Strictly use ONLY the following information.
If data is missing, respond with "No data available".

RULES:
1. Be specific about dates, times, rooms, and faculty
2. For student counts, provide exact numbers
3. For room allocations, mention building and room number
4. Never invent information

${context}`
      }, {
        role: "user",
        content: query
      }],
      temperature: 0.1, // Lower temperature for more factual responses
      max_tokens: 600
    });

    res.json({
      success: true,
      answer: response.data.choices[0].message.content,
      // Include metadata for debugging (optional)
      _debug: {
        matchedResults: relevantResults.map(r => r.metadata.type),
        topSimilarity: relevantResults[0]?.$similarity
      }
    });

  } catch (err) {
    console.error("Chatbot error:", err);
    res.status(500).json({
      success: false,
      error: `Chatbot failed: ${err.message}`
    });
  }
});

// Initialize services
initializeServices().catch(err => {
  console.error("🛑 Critical failure:", err);
});

module.exports = router;