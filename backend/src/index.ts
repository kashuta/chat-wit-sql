import dotenv from 'dotenv';
import { startServer } from './server';

// Load environment variables
dotenv.config();

// Start the server
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
startServer(port)
  .then(() => console.log(`Server running on port ${port}`))
  .catch((err: Error) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  }); 