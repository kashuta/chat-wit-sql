# Dante AI Data Agent

An intelligent agent that automatically extracts and combines data from PostgreSQL databases in the Dante project, answers analytical queries with high accuracy, and provides transparent decision-making through a clean React interface.

## Project Overview

The Dante AI Data Agent leverages LangChain.js and LangGraph to create a modular AI system capable of:

- Automated data extraction and combination from multiple PostgreSQL databases
- Precise answers to analytical queries about gaming and financial activity
- Transparent SQL query generation and explanation
- Interactive data visualization through tables and charts

## Project Status

✅ **Development Status**: 92% Complete (77/84 tasks)

The project is nearly complete with most core features implemented:
- ✅ Backend API with modular architecture
- ✅ Database integrations (wallet, bets-history, user-activities, financial-history)
- ✅ SQL generation and execution
- ✅ Frontend visualization components
- ✅ Interactive query interface

## Architecture

The project follows a modular architecture with three main components:

1. **Perception Module**: Analyzes user queries to determine intent and required data sources
2. **Planning Module**: Creates a plan for executing SQL queries across different services
3. **Execution Module**: Runs the queries and formats the results for visualization

## Tech Stack

### Backend
- Node.js with TypeScript (functional programming style)
- LangChain.js for AI integrations
- PostgreSQL database access with Prisma ORM
- OpenAI 4o-mini models for natural language processing

### Frontend
- React with TypeScript
- Vite for fast development experience
- Custom UI components for data visualization

## Setup and Installation

### Prerequisites
- Node.js 16+
- npm 7+
- PostgreSQL 15+ (or Docker)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/kashuta/chat-wit-sql.git
cd chat-wit-sql
```

2. Install dependencies:
```bash
npm install
```

3. Setup database connections:
```bash
# If using Docker
docker-compose up -d db

# Generate Prisma clients
cd backend
npm run prisma:generate
```

4. Update the `.env` file with your OpenAI API key:
```bash
# OpenAI API key is required for production use
# In development mode, mock data is used if API key is invalid
OPENAI_API_KEY=your_openai_api_key
```

### Running the Project

Start both frontend and backend in development mode:

```bash
npm run dev
```

Or run them separately:

```bash
# Backend only
npm run dev:backend

# Frontend only
npm run dev:frontend
```

The services will be available at:
- Backend: http://localhost:3000
- Frontend: http://localhost:3004

## Project Structure

```
├── backend/                # Backend codebase
│   ├── packages/           # Core modules
│   │   ├── common/         # Shared utilities and types
│   │   ├── perception/     # Query analysis module
│   │   ├── planning/       # SQL planning module
│   │   └── execution/      # Query execution module
│   ├── prisma/             # Prisma schema and database configuration
│   │   └── services/       # Service-specific Prisma schemas
│   ├── scripts/            # Utility scripts for setup
│   └── src/                # Backend entry point
├── frontend/               # Frontend codebase
│   └── src/                # React application
└── package.json            # Root package for monorepo setup
```

## Features

- Natural language query understanding
- SQL generation for multiple database services
- Confidence scoring for answers
- Error handling with fallback strategies
- Data visualization capabilities
- Mock data for development without live databases

## Database Services

The system connects to four main database services:
- **wallet**: User balances and transactions
- **bets-history**: Casino and sports betting history
- **user-activities**: User activity logs
- **financial-history**: Financial transaction records

## License

ISC 