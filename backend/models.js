const mongoose = require('mongoose');
const { Schema } = mongoose;

// ========== NOTIFICATION ==========
const NotificationSchema = new Schema({
  type: { type: String, required: true },
  message: { type: String, required: true },
  read: { type: Boolean, default: false },
  link: { type: String, default: '/' },
  createdAt: { type: Date, default: Date.now },
});

// ========== USER ==========
const UserSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  password: { type: String, default: '' },
  name: { type: String, default: '' },
  username: { type: String, lowercase: true, trim: true, index: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  verified: { type: Boolean, default: true },
  bio: { type: String, default: '', maxlength: 500 },
  avatar: { type: String, default: '' },
  socialLinks: {
    instagram: { type: String, default: '' },
    youtube: { type: String, default: '' },
    twitter: { type: String, default: '' },
    website: { type: String, default: '' },
  },
  followers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  following: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  wishlist: [{ type: Schema.Types.ObjectId, ref: 'Preset' }],
  notifications: [NotificationSchema],
  subscription: {
    tier: { type: String, default: 'free' },
    expiry: { type: Date, default: null },
    adWatchCount: { type: Number, default: 0 },
    adRewardDays: { type: Number, default: 0 },
    lastAdWatch: { type: Date, default: null },
  },
  referral: {
    code: { type: String, default: null, index: true, sparse: true },
    referredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    referralCount: { type: Number, default: 0 },
    referralRewardDays: { type: Number, default: 0 },
  },
  telegramId: { type: String, index: true, sparse: true },
  telegram: {
    firstName: String, lastName: String, username: String, languageCode: String,
  },
  token: { type: String, default: '' },
  lastActive: { type: Date, default: Date.now },
  commandsCount: { type: Number, default: 0 },
  lastLogin: { type: Date },
  status: { type: String, enum: ['active', 'blocked', 'deactivated'], default: 'active' },
}, { timestamps: true });

// ========== PRESET ==========
const ReviewSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  userName: { type: String, required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String, required: true, maxlength: 500 },
  helpful: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

const PresetSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, default: '', maxlength: 500 },
  category: { type: String, default: 'General', index: true },
  tags: [{ type: String, lowercase: true, trim: true }],
  price: { type: Number, default: 0, min: 0, max: 999999.99 },
  author: { type: String, required: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  fileUrl: { type: String, default: '' },
  previewImage: { type: String, default: '' },
  size: { type: Number, default: 0 },
  originalName: { type: String, default: '' },
  downloads: { type: Number, default: 0 },
  avgRating: { type: Number, default: 0, min: 0, max: 5 },
  reviews: [ReviewSchema],
  views: { type: Number, default: 0 },
  likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  shares: { type: Number, default: 0 },
  shareStats: { type: Map, of: Number, default: {} },
  adImpressions: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },
  bulkUploadBatch: { type: Number },
}, { timestamps: true });

PresetSchema.index({ name: 'text', description: 'text', tags: 'text', author: 'text' });
PresetSchema.index({ createdAt: -1 });
PresetSchema.index({ downloads: -1 });


// ========== COMMENT ==========
const CommentSchema = new Schema({
  presetId: { type: Schema.Types.ObjectId, ref: 'Preset', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userName: { type: String, required: true, maxlength: 80 },
  text: { type: String, required: true, maxlength: 500, trim: true },
  parentId: { type: Schema.Types.ObjectId, default: null },
  likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });
CommentSchema.index({ presetId: 1, createdAt: -1 });

// ========== ORDER ==========
const OrderSchema = new Schema({
  _id: { type: String },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  presetId: { type: Schema.Types.ObjectId, ref: 'Preset', required: true, index: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: ['created', 'paid', 'refunded', 'cancelled'], default: 'created', index: true },
  paymentId: { type: String },
  paidAt: { type: Date },
}, { timestamps: true, _id: false });

// ========== DOWNLOAD ==========
const DownloadSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  presetId: { type: Schema.Types.ObjectId, ref: 'Preset', required: true, index: true },
  downloadedAt: { type: Date, default: Date.now, index: true },
});

// ========== SHARE ==========
const ShareSchema = new Schema({
  presetId: { type: Schema.Types.ObjectId, ref: 'Preset', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  platform: { type: String, default: 'unknown' },
  referrer: { type: String },
  sharedAt: { type: Date, default: Date.now, index: true },
});

// ========== SHORT LINK ==========
const ShortLinkSchema = new Schema({
  code: { type: String, required: true, unique: true, index: true },
  presetId: { type: Schema.Types.ObjectId, ref: 'Preset', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  platform: { type: String, default: 'link' },
  clicks: { type: Number, default: 0 },
  lastClickAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

// ========== SHARE CLICK ==========
const ShareClickSchema = new Schema({
  code: { type: String, index: true },
  presetId: { type: Schema.Types.ObjectId, ref: 'Preset', index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  clickedAt: { type: Date, default: Date.now },
  ip: String,
  userAgent: String,
});

const User = mongoose.model('User', UserSchema);
const Preset = mongoose.model('Preset', PresetSchema);
const Order = mongoose.model('Order', OrderSchema);
const Download = mongoose.model('Download', DownloadSchema);
const Share = mongoose.model('Share', ShareSchema);
const ShortLink = mongoose.model('ShortLink', ShortLinkSchema);
const ShareClick = mongoose.model('ShareClick', ShareClickSchema);
const Comment = mongoose.model('Comment', CommentSchema);

module.exports = { User, Preset, Order, Download, Share, ShortLink, ShareClick, Comment };