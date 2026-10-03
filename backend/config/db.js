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
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 20),
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 2),
    maxIdleTimeMS: 30000,
    retryWrites: true,
    retryReads: true,
    heartbeatFrequencyMS: 10000,
  }).then(async () => {
    isConnected = true;
    console.log('✅ MongoDB connected:', mongoose.connection.host);
    mongoose.connection.on('error', err => console.error('❌ MongoDB runtime error:', err.message));
    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      console.warn('⚠️ MongoDB disconnected; Mongoose will retry.');
    });
    mongoose.connection.on('reconnected', () => {
      isConnected = true;
      console.log('✅ MongoDB reconnected');
    });
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