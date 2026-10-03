module.exports = function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  if (res.headersSent) return next(err);
  const status = Number(err.status || err.statusCode) || 500;
  res.status(status).json({ error: status >= 500 ? 'Server error. Please try again later.' : (err.message || 'Request failed') });
};
