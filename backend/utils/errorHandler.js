const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', err.stack);

  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large. Single uploads max 50MB; bulk uploads max 25MB per file.' });
  if (err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Unexpected file field.' });
  if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
  if (err.name === 'JsonWebTokenError') return res.status(401).json({ error: 'Invalid token' });
  if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
  if (err.name === 'CastError') return res.status(400).json({ error: 'Invalid ID format' });

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
};

module.exports = errorHandler;