# Automated Exam Allocation System

A robust, full-stack web application built using the **MERN Stack** and **Tailwind CSS**. This system is designed to automate and streamline the complex process of allocating exam halls, assigning invigilators, and seating students, thereby minimizing manual effort and eliminating scheduling conflicts.

## Demo

[![Watch the Demo Video](https://img.youtube.com/vi/3LtOTduAXm4/0.jpg)](https://youtu.be/3LtOTduAXm4)
---

## ✨ Key Features

This system is packed with features to ensure a smooth and fair examination process:

-   **Role-Based Access Control**:
    -   **Admin**: Full control over the system, including managing users (faculty), exam rooms, and viewing final allocations.
    -   **Faculty**: Can view their assigned invigilation duties and schedules.

-   **Intelligent Room & Student Allocation**:
    -   The core algorithm automatically assigns students to available exam rooms based on capacity.
    -   **Collision Prevention**: Ensures a student or faculty member is not assigned to multiple places at the same time.
    -   Handles multiple exams occurring in the same session by allocating them to different rooms.

-   **Fair Invigilator Assignment**:
    -   **Faculty Load Balancing**: The system distributes invigilation duties evenly among available faculty members to ensure fairness.
    -   Assigns invigilators to exam rooms based on their availability and current load.

-   **Resource Management**:
    -   **CRUD Operations**: Admins can easily Create, Read, Update, and Delete records for exams, rooms, and faculty members.

-   **Secure Authentication**:
    -   Uses **JSON Web Tokens (JWT)** for secure, stateless user login and session management.
    -   Passwords are encrypted using **bcrypt.js** before being stored in the database.

---

## 🛠️ Tech Stack

The project leverages a modern technology stack for a high-performance, scalable application.

| Category | Technology / Library |
| :--- | :--- |
| **Frontend** | React.js, React Router, Tailwind CSS, Axios |
| **Backend** | Node.js, Express.js, Mongoose |
| **Database** | MongoDB |
| **Authentication** | JSON Web Tokens (JWT), bcrypt.js |
| **Environment** | `dotenv` for environment variable management |

---

## 🚀 Getting Started

Follow these instructions to set up and run the project on your local machine.

### Prerequisites

-   [Node.js](https://nodejs.org/) (v16 or later)
-   [MongoDB](https://www.mongodb.com/try/download/community) (or a MongoDB Atlas account)
-   NPM or Yarn

### Installation & Setup

1.  **Clone the Repository**
    ```sh
    git clone [https://github.com/Mithun-AM/Exam-allocation-system.git](https://github.com/Mithun-AM/Exam-allocation-system.git)
    cd Exam-allocation-system
    ```

2.  **Setup the Backend (Server)**
    ```sh
    # Navigate to the server directory
    cd server

    # Install dependencies
    npm install

    # Create a .env file in the 'server' directory
    # and add the variables from the .env.example file
    touch .env
    ```
    Your `server/.env` file should look like this:
    ```env
    MONGO_URL=your_mongodb_connection_string
    PORT=8000
    SECRET_KEY=your_super_secret_key_for_jwt
    ```

3.  **Setup the Frontend (Client)**
    ```sh
    # Navigate to the client directory from the root
    cd ../client

    # Install dependencies
    npm install
    ```

4.  **Run the Application**
    ```sh
    # Run the backend server (from the /server directory)
    npm start

    # Run the frontend client (from the /client directory) in a separate terminal
    npm start
    ```

The application will be available at `http://localhost:3000`.

---
