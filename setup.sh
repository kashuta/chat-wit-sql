#!/bin/bash

echo "Setting up Dante AI Data Agent with WebSocket support..."

# Install root dependencies
npm install

# Install backend dependencies
cd backend
npm install
cd ..

# Install frontend dependencies
cd frontend
npm install
cd ..

echo "Setup complete! You can now run 'npm run dev' to start the application." 