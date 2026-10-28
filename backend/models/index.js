const mongoose = require('mongoose');
const { Schema } = mongoose;

// ========== NOTIFICATION ==========
const NotificationSchema = new Schema({
  type: { type: String, required: true, maxlength: 60 },
  message: { type: String, required: true, maxlength: 500 },
  read: { type: Boolean, default: false },
  link: { type: String, default: '/', maxlength: 500 },
  tick: { type: String, enum: ['', 'green', 'blue', 'gold'], default: '' },
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
  streakCurrent: { type: Number, default: 0 },
  streakBest: { type: Number, default: 0 },
  streakLastDay: { type: String, default: '' },
  tipsTotal: { type: Number, default: 0 },
  phone: { type: String, default: '', maxlength: 10 },
  payoutMethod: { type: String, enum: ['', 'upi', 'bank'], default: '' },
  payoutMasked: { type: String, default: '', maxlength: 120 },
  payoutEnc: { type: String, default: '', select: false },
  payoutUpdatedAt: { type: Date, default: null },
  proTheme: { type: String, enum: ['gold', 'rose', 'ocean', 'emerald', 'classic'], default: 'gold' },
  boostUntil: { type: Date, default: null, index: true },
  following: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  wishlist: [{ type: Schema.Types.ObjectId, ref: 'Preset' }],
  notifications: { type: [NotificationSchema], default: [], validate: v => Array.isArray(v) && v.length <= 200 },
  achievements: [{ key: { type: String }, label: String, icon: String, unlockedAt: { type: Date, default: Date.now } }],
  pushSubscriptions: [{ endpoint: { type: String }, expirationTime: { type: Number, default: null }, keys: { p256dh: String, auth: String }, createdAt: { type: Date, default: Date.now } }],
  subscription: {
    tier: { type: String, default: 'free' },
    plan: { type: String, default: '' },
    since: { type: Date, default: null },
    lastOrderId: { type: String, default: '' },
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
  passwordResetTokenHash: { type: String, default: '' },
  passwordResetExpires: { type: Date, default: null },
  lastActive: { type: Date, default: Date.now },
  commandsCount: { type: Number, default: 0 },
  lastLogin: { type: Date },
  status: { type: String, enum: ['active', 'blocked', 'deactivated'], default: 'active' },
  sessionVersion: { type: Number, default: 0 },
  location: {
    lat: { type: Number, min: -90, max: 90, default: null },
    lng: { type: Number, min: -180, max: 180, default: null },
    updatedAt: { type: Date, default: null },
  },
}, { timestamps: true });

// ========== PRESET ==========
const ReviewSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  userName: { type: String, required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String, required: true, maxlength: 500 },
  helpful: { type: Number, default: 0 },
  helpfulBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
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
  status: { type: String, enum: ['approved', 'rejected'], default: 'approved', index: true },
  fileUrl: { type: String, default: '' },
  fileStorageKey: { type: String, default: '' },
  previewImage: { type: String, default: '' },
  previewStorageKey: { type: String, default: '' },
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
  viralNotifiedAt: { type: Date, default: null },
  boostUntil: { type: Date, default: null, index: true },
  bulkUploadBatch: { type: Number },
  uploadId: { type: String, unique: true, sparse: true, index: true },
}, { timestamps: true });

PresetSchema.index({ name: 'text', description: 'text', tags: 'text', author: 'text' });
PresetSchema.index({ createdAt: -1 });
PresetSchema.index({ downloads: -1 });
PresetSchema.index({ status: 1, createdAt: -1 });
PresetSchema.index({ status: 1, category: 1, downloads: -1 });
PresetSchema.index({ status: 1, createdAt: -1, _id: -1 });
PresetSchema.index({ status: 1, downloads: -1, _id: -1 });
PresetSchema.index({ status: 1, avgRating: -1, _id: -1 });


// ========== COMMENT ==========
const CommentSchema = new Schema({
  presetId: { type: Schema.Types.ObjectId, ref: 'Preset', default: null, index: true },
  textId: { type: Schema.Types.ObjectId, ref: 'TextPost', default: null, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userName: { type: String, required: true, maxlength: 80 },
  text: { type: String, required: true, maxlength: 500, trim: true },
  parentId: { type: Schema.Types.ObjectId, default: null },
  likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });
CommentSchema.index({ presetId: 1, createdAt: -1 });
CommentSchema.index({ textId: 1, createdAt: -1 });

// ========== ORDER ==========
const OrderSchema = new Schema({
  _id: { type: String },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  presetId: { type: Schema.Types.ObjectId, ref: 'Preset', default: null, index: true },
  kind: { type: String, enum: ['preset', 'subscription', 'tip', 'boost'], default: 'preset', index: true },
  boostTargetType: { type: String, enum: ['', 'profile', 'preset', 'text'], default: '' },
  boostTargetId: { type: String, default: '' },
  boostDays: { type: Number, default: 0 },
  recipientId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  note: { type: String, default: '', maxlength: 140 },
  plan: { type: String, enum: ['', 'monthly', 'quarterly', 'yearly'], default: '' },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: ['created', 'paid', 'refunded', 'cancelled', 'failed', 'expired', 'suspicious'], default: 'created', index: true },
  provider: { type: String, enum: ['youpi', 'cashfree', 'legacy'], default: 'youpi', index: true },
  paymentSessionId: { type: String, default: '' },
  listAmount: { type: Number, default: null },
  refundReference: { type: String, default: '', maxlength: 60 },
  refundedAt: { type: Date, default: null },
  couponCode: { type: String, default: '', maxlength: 32 },
  paymentId: { type: String },
  gatewayPaymentId: { type: String },
  checkoutUrl: { type: String },
  utr: { type: String },
  failureReason: { type: String, maxlength: 400 },
  paidAt: { type: Date },
}, { timestamps: true, _id: false });
OrderSchema.index({ userId: 1, presetId: 1, status: 1, createdAt: -1 });

// ========== DOWNLOAD ==========
const DownloadSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  presetId: { type: Schema.Types.ObjectId, ref: 'Preset', required: true, index: true },
  downloadedAt: { type: Date, default: Date.now, index: true },
});
DownloadSchema.index({ userId: 1, presetId: 1 });

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



// ========== HOME AD / PROMOTION ==========
const HomeAdSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: '', trim: true, maxlength: 500 },
  imageUrl: { type: String, default: '', trim: true, maxlength: 1000 },
  linkUrl: { type: String, default: '/', trim: true, maxlength: 500 },
  productName: { type: String, default: '', trim: true, maxlength: 120 },
  originalPrice: { type: Number, default: 0, min: 0, max: 99999999 },
  salePrice: { type: Number, default: 0, min: 0, max: 99999999 },
  discountPercent: { type: Number, default: 0, min: 0, max: 100 },
  badge: { type: String, default: 'Featured', trim: true, maxlength: 40 },
  adType: { type: String, enum: ['personal', 'sponsor'], default: 'personal', index: true },
  active: { type: Boolean, default: true, index: true },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  impressions: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
HomeAdSchema.index({ active: 1, startsAt: 1, endsAt: 1, createdAt: -1 });

// ========== MESSAGE ==========
const MessageSchema = new Schema({
  senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  text: { type: String, required: true, maxlength: 1000, trim: true },
  readAt: { type: Date, default: null, index: true },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
MessageSchema.index({ senderId: 1, receiverId: 1, createdAt: 1 });
MessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
UserSchema.index({ 'pushSubscriptions.endpoint': 1 }, { sparse: true });


// ========== SUPPORT REQUEST ==========
const SupportRequestSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  telegramId: { type: String, default: '' },
  name: { type: String, default: '', maxlength: 120 },
  email: { type: String, default: '', maxlength: 200 },
  type: { type: String, enum: ['password_reset', 'delete_account', 'account_access', 'block_review', 'other'], default: 'other' },
  message: { type: String, required: true, maxlength: 1000 },
  status: { type: String, enum: ['open', 'in_progress', 'resolved', 'rejected'], default: 'open', index: true },
  adminNote: { type: String, default: '', maxlength: 1000 },
  resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });
SupportRequestSchema.index({ status: 1, createdAt: -1 });

// ========== TEXT POST (Shayari / Quotes / Text Prompts) ==========
const TEXT_CATEGORIES = ['sad', 'true-lines', 'love', 'attitude', 'motivation', 'friendship', 'life', 'good-morning', 'good-night', 'funny', 'romantic', 'breakup', 'ai-prompt', 'caption', 'other'];
const TextPostSchema = new Schema({
  title: { type: String, default: '', trim: true, maxlength: 120 },
  text: { type: String, required: true, trim: true, maxlength: 2000 },
  category: { type: String, enum: TEXT_CATEGORIES, default: 'other', index: true },
  language: { type: String, enum: ['hindi', 'hinglish', 'english', 'urdu', 'other'], default: 'hindi' },
  tags: [{ type: String, lowercase: true, trim: true }],
  slug: { type: String, default: '', index: true },
  author: { type: String, required: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['approved', 'rejected'], default: 'approved', index: true },
  likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  views: { type: Number, default: 0 },
  copies: { type: Number, default: 0 },
  shares: { type: Number, default: 0 },
  commentsCount: { type: Number, default: 0 },
  shareStats: { type: Map, of: Number, default: {} },
  viralNotifiedAt: { type: Date, default: null },
  boostUntil: { type: Date, default: null, index: true },
}, { timestamps: true });
TextPostSchema.index({ title: 'text', text: 'text', tags: 'text' });
TextPostSchema.index({ status: 1, createdAt: -1 });
TextPostSchema.index({ status: 1, category: 1, createdAt: -1 });
TextPostSchema.index({ status: 1, copies: -1 });

// ========== ADMIN ALERT LOG ==========
const AlertLogSchema = new Schema({
  type: { type: String, enum: ['new_user', 'security', 'error', 'database', 'payment', 'subscription', 'system', 'viral'], required: true, index: true },
  severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info', index: true },
  title: { type: String, required: true, maxlength: 200 },
  details: { type: Schema.Types.Mixed, default: {} },
  fingerprint: { type: String, default: '', index: true },
  count: { type: Number, default: 1 },
  read: { type: Boolean, default: false, index: true },
  lastAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });
AlertLogSchema.index({ createdAt: -1 });
AlertLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 60 }); // keep 60 days


// ========== COLLECTIONS (user playlists of presets) ==========
const CollectionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  description: { type: String, default: '', maxlength: 300 },
  isPublic: { type: Boolean, default: false, index: true },
  presetIds: [{ type: Schema.Types.ObjectId, ref: 'Preset' }],
}, { timestamps: true });

// ========== REPORTS (community moderation) ==========
const ReportSchema = new Schema({
  reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  targetType: { type: String, enum: ['preset', 'text', 'user', 'comment'], required: true, index: true },
  targetId: { type: Schema.Types.ObjectId, required: true, index: true },
  reason: { type: String, enum: ['spam', 'copyright', 'abuse', 'hate', 'adult', 'scam', 'other'], default: 'other' },
  details: { type: String, default: '', maxlength: 500 },
  status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open', index: true },
  resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });
ReportSchema.index({ reporterId: 1, targetType: 1, targetId: 1 }, { unique: true });


// ========== PAYOUTS (creator withdrawals; admin pays manually and records the reference) ==========
const PayoutSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amountPaise: { type: Number, required: true, min: 1 },
  method: { type: String, enum: ['upi', 'bank'], required: true },
  destinationMasked: { type: String, default: '', maxlength: 120 },
  destinationEnc: { type: String, default: '', select: false },
  status: { type: String, enum: ['requested', 'approved', 'paid', 'rejected'], default: 'requested', index: true },
  reference: { type: String, default: '', maxlength: 60 },
  adminNote: { type: String, default: '', maxlength: 300 },
  processedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  processedAt: { type: Date, default: null },
}, { timestamps: true });
PayoutSchema.index({ userId: 1, status: 1 });


// ========== COUPONS (admin-created discounts) ==========
const CouponSchema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 32 },
  type: { type: String, enum: ['percent', 'fixed'], default: 'percent' },
  value: { type: Number, required: true, min: 0 },
  appliesTo: { type: String, enum: ['preset', 'subscription', 'tip', 'all'], default: 'all' },
  presetId: { type: Schema.Types.ObjectId, ref: 'Preset', default: null },
  maxUses: { type: Number, default: 0, min: 0 },
  usedCount: { type: Number, default: 0, min: 0 },
  validFrom: { type: Date, default: null },
  validUntil: { type: Date, default: null },
  active: { type: Boolean, default: true, index: true },
  note: { type: String, default: '', maxlength: 200 },
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);
const Preset = mongoose.model('Preset', PresetSchema);
const Order = mongoose.model('Order', OrderSchema);
const Download = mongoose.model('Download', DownloadSchema);
const Share = mongoose.model('Share', ShareSchema);
const ShortLink = mongoose.model('ShortLink', ShortLinkSchema);
const ShareClick = mongoose.model('ShareClick', ShareClickSchema);
const Comment = mongoose.model('Comment', CommentSchema);

const Message = mongoose.model('Message', MessageSchema);
const HomeAd = mongoose.model('HomeAd', HomeAdSchema);
const SupportRequest = mongoose.model('SupportRequest', SupportRequestSchema);
const TextPost = mongoose.model('TextPost', TextPostSchema);
const AlertLog = mongoose.model('AlertLog', AlertLogSchema);
const Collection = mongoose.model('Collection', CollectionSchema);
const Report = mongoose.model('Report', ReportSchema);
const Payout = mongoose.model('Payout', PayoutSchema);
const Coupon = mongoose.model('Coupon', CouponSchema);

const BoostSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  targetType: { type: String, enum: ['profile', 'preset', 'text'], required: true },
  targetId: { type: String, required: true, index: true },
  days: { type: Number, required: true },
  amount: { type: Number, required: true },
  orderId: { type: String, default: '' },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true, index: true },
  revokedAt: { type: Date, default: null },
}, { timestamps: true });
const Boost = mongoose.model('Boost', BoostSchema);
// ========== AUDIT LOG (every admin change: who, when, what route; body VALUES are never stored) ==========
const AuditLogEntrySchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  actorEmail: { type: String, default: '', maxlength: 200 },
  method: { type: String, required: true, maxlength: 10 },
  path: { type: String, required: true, maxlength: 200 },
  status: { type: Number, default: 0 },
  ip: { type: String, default: '', maxlength: 64 },
  userAgent: { type: String, default: '', maxlength: 160 },
  fields: [{ type: String, maxlength: 60 }],
  createdAt: { type: Date, default: Date.now, index: true },
});
AuditLogEntrySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 }); // keep one year
const AuditLogEntry = mongoose.model('AuditLogEntry', AuditLogEntrySchema);


module.exports = { User, Preset, Order, Download, Share, ShortLink, ShareClick, Comment, Message, HomeAd, SupportRequest, TextPost, AlertLog, Collection, Report, Payout, Coupon, Boost, AuditLogEntry, TEXT_CATEGORIES };