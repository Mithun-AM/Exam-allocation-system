const queryAnalyzer = require('../services/queryAnalyzerService');
const dbService = require('../services/chatbotDatabaseService');
const axios = require('axios');

/**
 * Controller to handle chatbot interactions
 */
class ChatbotController {
  constructor() {
    this.LM_STUDIO_API_URL = process.env.LM_STUDIO_API_URL || 'http://localhost:1234/v1';
    this.CONVERSATION_HISTORY_LENGTH = 5; // Number of messages to keep in context
    this.MODEL_NAME = process.env.LLM_MODEL_NAME || 'local-model';
  }

  /**
   * Process a user query and generate a response
   * @param {string} query - User's query
   * @param {Array} conversationHistory - Previous messages in the conversation
   * @param {Object} user - User information (optional)
   * @returns {Promise<string>} - Response to the user
   */
  async processQuery(query, conversationHistory = [], user = null) {
    try {
      // Step 1: Analyze the query to extract entities and intent
      const analysisResult = await queryAnalyzer.analyzeQuery(query);
      console.log('Query analysis:', analysisResult);
      
      // Step 2: Fetch relevant data based on the analysis
      const contextData = await this.fetchRelevantData(analysisResult, user);
      
      // Step 3: Format the context data into a string
      const formattedContext = this.formatContextData(contextData);
      
      // Step 4: Generate a response using the LLM with the context data
      const response = await this.generateResponse(query, formattedContext, conversationHistory, user);
      
      return response;
    } catch (error) {
      console.error('Error processing query:', error);
      return "I'm sorry, I encountered an error while processing your query. Please try again.";
    }
  }

  /**
   * Fetch relevant data from the database based on the query analysis
   * @param {Object} analysisResult - Query analysis results
   * @param {Object} user - User information (optional)
   * @returns {Promise<Object>} - Relevant data for response generation
   */
  async fetchRelevantData(analysisResult, user = null) {
    const contextData = {
      intent: analysisResult.intent || 'general_query',
      data: {},
      userRole: user ? user.role : null,
      userName: user ? user.name : null
    };

    // Convert time period to query parameters
    const timeParams = {};
    if (analysisResult.time_period === 'past') {
      timeParams.past = true;
    } else if (analysisResult.time_period === 'future') {
      timeParams.future = true;
    } else if (analysisResult.time_period === 'present') {
      timeParams.present = true;
    }

    try {
      // If user is a faculty, we'll prioritize their own information
      const facultyId = user && user.role === 'Faculty' ? user._id : null;
      const facultyName = user && user.role === 'Faculty' ? user.name : analysisResult.faculty_name;
      
      // Fetch data based on the detected intent
      switch (contextData.intent) {
        case 'exam_info':
          contextData.data.exams = await dbService.findExams({
            name: analysisResult.exam_name,
            year: analysisResult.exam_year,
            semester: analysisResult.semester
          });
          
          // If a specific subject was mentioned, also fetch subject data
          if (analysisResult.subject_name || analysisResult.subject_code) {
            contextData.data.subjects = await dbService.findSubjects({
              name: analysisResult.subject_name,
              subjectCode: analysisResult.subject_code,
              semester: analysisResult.semester,
              date: analysisResult.date
            });
          }
          
          // For faculty users, fetch their own exam allocations
          if (facultyId) {
            contextData.data.facultyExams = await dbService.findFacultyAllocations({
              facultyId: facultyId,
              ...timeParams
            });
          }
          break;
          
        case 'faculty_allocation':
          contextData.data.allocations = await dbService.findFacultyAllocations({
            facultyName: facultyName,
            facultyId: facultyId || analysisResult.faculty_id,
            roomId: analysisResult.room_id,
            date: analysisResult.date,
            ...timeParams
          });
          
          // Also fetch faculty details if a name was mentioned
          if (facultyName) {
            contextData.data.faculty = await dbService.findFaculty({
              name: facultyName
            });
          }
          break;
          
        case 'room_info':
          contextData.data.rooms = await dbService.findRooms({
            building: analysisResult.building,
            roomNumber: analysisResult.room_number,
            floor: analysisResult.floor
          });
          
          // If we have a specific room, also fetch allocations for that room
          if (analysisResult.room_number) {
            contextData.data.roomAllocations = await dbService.findStudentAllocations({
              roomNumber: analysisResult.room_number,
              date: analysisResult.date,
              ...timeParams
            });
            
            // Get faculty allocations for the room as well
            contextData.data.facultyRoomAllocations = await dbService.findFacultyAllocations({
              roomNumber: analysisResult.room_number,
              date: analysisResult.date,
              ...timeParams
            });
          }
          
          // For faculty users, focus on rooms they're allocated to
          if (facultyId) {
            contextData.data.facultyRooms = await dbService.findFacultyAllocations({
              facultyId: facultyId,
              ...timeParams
            });
          }
          break;
          
        case 'student_allocation':
          contextData.data.studentAllocations = await dbService.findStudentAllocations({
            roomNumber: analysisResult.room_number,
            semester: analysisResult.semester,
            student: analysisResult.student,
            date: analysisResult.date,
            ...timeParams
          });
          
          // If faculty is asking about their room's student allocations
          if (facultyId && !analysisResult.room_number) {
            const facultyAllocations = await dbService.findFacultyAllocations({
              facultyId: facultyId,
              date: analysisResult.date,
              ...timeParams
            });
            
            if (facultyAllocations && facultyAllocations.length > 0) {
              // Get room numbers from allocations
              const roomIds = facultyAllocations.map(alloc => 
                alloc.roomId ? alloc.roomId._id || alloc.roomId : null
              ).filter(Boolean);
              
              const roomNumbers = facultyAllocations.map(alloc => 
                alloc.roomId ? alloc.roomId.roomNumber : null
              ).filter(Boolean);
              
              // Fetch student allocations for these rooms
              contextData.data.facultyRoomStudents = await dbService.findStudentAllocations({
                roomIds: roomIds,
                roomNumbers: roomNumbers,
                date: analysisResult.date,
                ...timeParams
              });
            }
          }
          break;
          
        case 'faculty_info':
          // If faculty user is asking about themselves
          if (facultyId && (!analysisResult.faculty_name || 
              (analysisResult.faculty_name && facultyName.toLowerCase().includes(analysisResult.faculty_name.toLowerCase())))) {
            contextData.data.faculty = [user];
          } else {
            contextData.data.faculty = await dbService.findFaculty({
              name: analysisResult.faculty_name,
              email: analysisResult.email,
              designation: analysisResult.designation
            });
          }
          break;
          
        case 'system_stats':
          // Only admin should be able to access overall stats
          if (!user || user.role === 'Admin') {
            contextData.data.stats = await dbService.getSystemStats();
          } else {
            // For faculty, provide their personal stats
            contextData.data.facultyStats = {
              totalAllocations: (await dbService.findFacultyAllocations({facultyId: facultyId})).length,
              upcomingAllocations: (await dbService.findFacultyAllocations({facultyId: facultyId, future: true})).length,
              pastAllocations: (await dbService.findFacultyAllocations({facultyId: facultyId, past: true})).length
            };
          }
          break;
          
        default:
          // For general queries or unidentified intent, perform a broader search
          contextData.data.searchResults = await dbService.searchAll(query);
          
          // If user is faculty, also include their allocations
          if (facultyId) {
            contextData.data.facultyData = await dbService.findFacultyAllocations({
              facultyId: facultyId,
              ...timeParams
            });
          }
          break;
      }
      
      return contextData;
    } catch (error) {
      console.error('Error fetching relevant data:', error);
      return contextData; // Return what we have even if there was an error
    }
  }

  /**
   * Format context data into a string that can be used by the LLM
   * @param {Object} contextData - Data retrieved from the database
   * @returns {string} - Formatted context string
   */
  formatContextData(contextData) {
    let formattedContext = `CONTEXT INFORMATION FOR QUERY:\n`;
    
    // Add intent information
    formattedContext += `Intent: ${contextData.intent}\n`;
    
    // Add user role information if available
    if (contextData.userRole) {
      formattedContext += `User Role: ${contextData.userRole}\n`;
      if (contextData.userName) {
        formattedContext += `User Name: ${contextData.userName}\n`;
      }
    }
    
    formattedContext += `\n`;
    
    // Format each type of data accordingly
    Object.keys(contextData.data).forEach(dataType => {
      const data = contextData.data[dataType];
      
      if (!data || (Array.isArray(data) && data.length === 0) || 
          (typeof data === 'object' && Object.keys(data).length === 0)) {
        return; // Skip empty data
      }
      
      formattedContext += `${dataType.toUpperCase()}:\n`;
      
      if (dataType === 'exams') {
        data.forEach((exam, index) => {
          formattedContext += `Exam ${index + 1}: ${exam.name} (${exam.year})\n`;
          if (exam.semesters && exam.semesters.length > 0) {
            formattedContext += `  Semesters: ${exam.semesters.map(s => s.semester).join(', ')}\n`;
          }
          if (exam.subjects && exam.subjects.length > 0) {
            formattedContext += `  Subjects: ${exam.subjects.length} subjects\n`;
            // Include a few subject names as examples
            const sampleSubjects = exam.subjects.slice(0, 3);
            formattedContext += `  Sample Subjects: ${sampleSubjects.map(s => s.name || s).join(', ')}${exam.subjects.length > 3 ? '...' : ''}\n`;
          }
          formattedContext += '\n';
        });
      } else if (dataType === 'subjects') {
        data.forEach((subject, index) => {
          formattedContext += `Subject ${index + 1}: ${subject.name} (${subject.subjectCode})\n`;
          formattedContext += `  Semester: ${subject.semester}\n`;
          if (subject.date) {
            formattedContext += `  Date: ${new Date(subject.date).toLocaleDateString()}\n`;
            formattedContext += `  Time: ${subject.startTime || 'N/A'} - ${subject.endTime || 'N/A'}\n`;
          }
          if (subject.exam) {
            formattedContext += `  Exam: ${typeof subject.exam === 'object' ? subject.exam.name : subject.exam}\n`;
          }
          formattedContext += '\n';
        });
      } else if (dataType === 'rooms') {
        data.forEach((room, index) => {
          formattedContext += `Room ${index + 1}: ${room.building} - ${room.roomNumber}\n`;
          formattedContext += `  Floor: ${room.floor}, Capacity: ${room.capacity}\n`;
          formattedContext += '\n';
        });
      } else if (dataType === 'allocations' || dataType === 'facultyExams' || dataType === 'facultyRooms') {
        data.forEach((allocation, index) => {
          formattedContext += `Allocation ${index + 1}:\n`;
          
          // Handle different ways facultyName might be stored
          const facultyName = allocation.facultyName || 
                             (allocation.facultyId && typeof allocation.facultyId === 'object' ? 
                              allocation.facultyId.name : 'Unknown');
          
          formattedContext += `  Faculty: ${facultyName}\n`;
          
          // Handle different ways exam might be stored
          if (allocation.examId) {
            const examName = typeof allocation.examId === 'object' ? 
                            allocation.examId.name : allocation.examId;
            formattedContext += `  Exam: ${examName}\n`;
          }
          
          // Handle different ways subject might be stored
          if (allocation.subjectId) {
            const subjectName = typeof allocation.subjectId === 'object' ? 
                               allocation.subjectId.name : allocation.subjectId;
            const subjectCode = typeof allocation.subjectId === 'object' && allocation.subjectId.subjectCode ? 
                               allocation.subjectId.subjectCode : '';
            
            formattedContext += `  Subject: ${subjectName}${subjectCode ? ' (' + subjectCode + ')' : ''}\n`;
          }
          
          // Handle different ways room might be stored
          if (allocation.roomId) {
            const building = typeof allocation.roomId === 'object' ? 
                            allocation.roomId.building : '';
            const roomNumber = typeof allocation.roomId === 'object' ? 
                              allocation.roomId.roomNumber : allocation.roomId;
            
            formattedContext += `  Room: ${building ? building + ' - ' : ''}${roomNumber}\n`;
          }
          
          if (allocation.date) {
            formattedContext += `  Date: ${new Date(allocation.date).toLocaleDateString()}\n`;
            formattedContext += `  Time: ${allocation.startTime || 'N/A'} - ${allocation.endTime || 'N/A'}\n`;
          }
          
          formattedContext += '\n';
        });
      } else if (dataType === 'studentAllocations' || dataType === 'roomAllocations' || dataType === 'facultyRoomStudents') {
        data.forEach((allocation, index) => {
          formattedContext += `Student Allocation ${index + 1}:\n`;
          formattedContext += `  Room: ${allocation.roomNumber || (allocation.roomId && allocation.roomId.roomNumber) || 'Unknown'}\n`;
          
          if (allocation.examId) {
            const examName = typeof allocation.examId === 'object' ? 
                            allocation.examId.name : allocation.examId;
            formattedContext += `  Exam: ${examName}\n`;
          }
          
          if (allocation.subjectId) {
            const subjectName = typeof allocation.subjectId === 'object' ? 
                               allocation.subjectId.name : allocation.subjectId;
            formattedContext += `  Subject: ${subjectName}\n`;
          } else if (allocation.subjectIds && allocation.subjectIds.length > 0) {
            const subjectNames = allocation.subjectIds.map(sub => 
              typeof sub === 'object' ? sub.name : sub
            );
            formattedContext += `  Subjects: ${subjectNames.join(', ')}\n`;
          }
          
          if (allocation.date) {
            formattedContext += `  Date: ${new Date(allocation.date).toLocaleDateString()}\n`;
          }
          
          formattedContext += `  Students Count: ${allocation.students ? allocation.students.length : 0}\n`;
          
          // Only include a sample of students if there are many
          if (allocation.students && allocation.students.length > 0) {
            const sampleStudents = allocation.students.slice(0, 5);
            formattedContext += `  Sample Students: ${sampleStudents.join(', ')}${allocation.students.length > 5 ? '...' : ''}\n`;
          }
          
          formattedContext += '\n';
        });
      } else if (dataType === 'faculty') {
        data.forEach((faculty, index) => {
          formattedContext += `Faculty ${index + 1}: ${faculty.name}\n`;
          formattedContext += `  Email: ${faculty.email || 'Not provided'}\n`;
          formattedContext += `  Designation: ${faculty.designation || 'Not specified'}\n`;
          formattedContext += `  Available: ${faculty.available ? 'Yes' : 'No'}\n`;
          formattedContext += '\n';
        });
      } else if (dataType === 'stats') {
        formattedContext += `  Total Exams: ${data.totalExams}\n`;
        formattedContext += `  Total Rooms: ${data.totalRooms}\n`;
        formattedContext += `  Total Faculty: ${data.totalFaculty}\n`;
        formattedContext += `  Total Subjects: ${data.totalSubjects}\n`;
        formattedContext += `  Current Allocations: ${data.currentAllocations}\n`;
        formattedContext += `  Upcoming Exams: ${data.upcomingExams}\n`;
        formattedContext += '\n';
      } else if (dataType === 'facultyStats') {
        formattedContext += `  Total Allocations: ${data.totalAllocations}\n`;
        formattedContext += `  Upcoming Allocations: ${data.upcomingAllocations}\n`;
        formattedContext += `  Past Allocations: ${data.pastAllocations}\n`;
        formattedContext += '\n';
      } else if (dataType === 'searchResults') {
        // Format general search results
        if (data.exams && data.exams.length > 0) {
          formattedContext += `  Exams found: ${data.exams.length}\n`;
          // List a few examples
          data.exams.slice(0, 3).forEach(exam => {
            formattedContext += `    - ${exam.name} (${exam.year})\n`;
          });
        }
        if (data.subjects && data.subjects.length > 0) {
          formattedContext += `  Subjects found: ${data.subjects.length}\n`;
          // List a few examples
          data.subjects.slice(0, 3).forEach(subject => {
            formattedContext += `    - ${subject.name} (${subject.subjectCode})\n`;
          });
        }
        if (data.rooms && data.rooms.length > 0) {
          formattedContext += `  Rooms found: ${data.rooms.length}\n`;
          // List a few examples
          data.rooms.slice(0, 3).forEach(room => {
            formattedContext += `    - ${room.building} - ${room.roomNumber}\n`;
          });
        }
        if (data.faculty && data.faculty.length > 0) {
          formattedContext += `  Faculty found: ${data.faculty.length}\n`;
          // List a few examples
          data.faculty.slice(0, 3).forEach(faculty => {
            formattedContext += `    - ${faculty.name} (${faculty.email})\n`;
          });
        }
        formattedContext += '\n';
      }
    });
    
    return formattedContext;
  }

  /**
   * Generate a response using the LLM with context information
   * @param {string} query - User's query
   * @param {string} context - Formatted context information
   * @param {Array} conversationHistory - Previous messages in the conversation
   * @param {Object} user - User information (optional)
   * @returns {Promise<string>} - Generated response
   */
  async generateResponse(query, context, conversationHistory, user = null) {
    try {
      // Build a system prompt that's tailored to the user role
      let systemPrompt = 'You are an intelligent assistant for a university exam management system.';
      
      if (user) {
        if (user.role === 'Admin') {
          systemPrompt += ' You are speaking with an administrator who manages the exam system.';
          systemPrompt += ' You should provide comprehensive information about exams, rooms, faculty allocations, and student seating arrangements.';
        } else if (user.role === 'Faculty') {
          systemPrompt += ` You are speaking with a faculty member named ${user.name}.`;
          systemPrompt += ' You should focus on information relevant to their exam duties, assigned rooms, and student allocations for their supervision.';
          systemPrompt += ' For faculty, prioritize information about their own allocations and duties.';
        }
      }
      
      systemPrompt += `\n\nRespond in a helpful, concise manner. Use the provided context information to answer the user's query accurately. If the context doesn't contain enough information to answer the query, politely indicate that you don't have that specific information.

Important guidelines:
1. Only provide information that's supported by the context data.
2. Don't make up information that's not in the context.
3. For dates and times, use the exact format provided in the context.
4. Keep responses clear and structured for easy understanding.
5. When listing multiple items, use numbered or bulleted lists for clarity.
6. If context shows no relevant data was found, politely tell the user that information isn't available.

${context}`;

      // Prepare the conversation history for the LLM
      const messages = [
        {
          role: "system",
          content: systemPrompt
        }
      ];
      
      // Add conversation history (limited to the most recent messages)
      const limitedHistory = conversationHistory.slice(-this.CONVERSATION_HISTORY_LENGTH);
      messages.push(...limitedHistory);
      
      // Add the current user query
      messages.push({ role: "user", content: query });
      
      // Call the LLM for response generation
      const response = await axios.post(`${this.LM_STUDIO_API_URL}/chat/completions`, {
        model: this.MODEL_NAME,
        messages: messages,
        temperature: 0.7,
        max_tokens: 800
      }, {
        timeout: 30000 // 30 second timeout
      });
      
      const responseText = response.data.choices[0].message.content.trim();
      
      return responseText;
    } catch (error) {
      console.error('Error generating response:', error);
      return "I'm sorry, I encountered an error while generating a response. Please try again.";
    }
  }
}

module.exports = new ChatbotController();