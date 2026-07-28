const { body, validationResult } = require('express-validator');

const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(validation => validation.run(req)));
    
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }
    
    res.status(400).json({ 
      error: errors.array().map(e => e.msg).join(', ') 
    });
  };
};

// Validation rules
const signupValidation = [
  body('email').isEmail().withMessage('Invalid email address'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('name').notEmpty().withMessage('Name is required')
];

const loginValidation = [
  body('email').isEmail().withMessage('Invalid email address'),
  body('password').notEmpty().withMessage('Password is required')
];

const presetValidation = [
  body('name').notEmpty().withMessage('Preset name is required'),
  body('price').isNumeric().withMessage('Price must be a number'),
  body('price').custom(value => value >= 0).withMessage('Price cannot be negative')
];

module.exports = {
  validate,
  signupValidation,
  loginValidation,
  presetValidation
};