const mongoose = require('mongoose');

let isConnected = false;
let connectionPromise = null;

async function connectDB() {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  if (connectionPromise) return connectionPromise;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI not set in .env');
    if (process.env.NODE_ENV === 'production') process.exit(1);
    return null;
  }

  connectionPromise = mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    retryWrites: true,
  }).then(() => {
    isConnected = true;
    console.log('✅ MongoDB connected:', mongoose.connection.host);
    return mongoose.connection;
  }).catch(err => {
    connectionPromise = null;
    console.error('❌ MongoDB connection failed:', err.message);
    throw err;
  });

  return connectionPromise;
}

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  process.exit(0);
});

module.exports = { connectDB, mongoose };