// Compatibility shim: keep the historical require('../models') path pointing
// to the canonical schema definitions in backend/models/index.js.
module.exports = require('./models/index.js');
