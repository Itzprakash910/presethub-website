const { body, validationResult } = require('express-validator');

const validate = (validations) => async (req, res, next) => {
  await Promise.all(validations.map(v => v.run(req)));
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  res.status(400).json({ error: errors.array().map(e => e.msg).join(', ') });
};

const signupValidation = [
  body('email').isEmail().withMessage('Invalid email').normalizeEmail().trim(),
  body('password').isLength({ min: 10, max: 128 }).withMessage('Password must be 10–128 characters')
    .matches(/\d/).withMessage('Password needs a number')
    .matches(/[A-Z]/).withMessage('Password needs uppercase')
    .matches(/[a-z]/).withMessage('Password needs lowercase'),
  body('name').optional().trim().isLength({ min: 1, max: 50 }),
  body('username').optional().trim().isLength({ min: 3, max: 30 })
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username: letters, numbers, underscores only')
];

const loginValidation = [
  body('email').isEmail().withMessage('Invalid email').normalizeEmail().trim(),
  body('password').notEmpty().withMessage('Password required')
];

const presetValidation = [
  body('name').notEmpty().withMessage('Name required').trim().isLength({ min: 1, max: 100 }),
  body('price').isNumeric().withMessage('Price must be number')
    .custom(v => v >= 0).withMessage('Price cannot be negative')
    .custom(v => v <= 999999.99).withMessage('Price too high'),
  body('description').optional().trim().isLength({ max: 500 }),
  body('category').optional().trim().isLength({ min: 1, max: 50 }),
  body('tags').optional()
];

const profileValidation = [
  body('name').optional().trim().isLength({ min: 1, max: 50 }),
  body('username').optional().trim().isLength({ min: 3, max: 30 })
    .matches(/^[a-zA-Z0-9_]+$/),
  body('bio').optional().trim().isLength({ max: 500 })
];

const changePasswordValidation = [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 10, max: 128 })
    .matches(/\d/).matches(/[A-Z]/).matches(/[a-z]/)
];

module.exports = {
  validate, signupValidation, loginValidation, presetValidation,
  profileValidation, changePasswordValidation
};