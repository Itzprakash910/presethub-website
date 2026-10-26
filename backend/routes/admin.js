const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const auth = require('../middleware/auth');

const {
  User, Preset, Order, Download, Share, ShortLink, ShareClick, Comment, Message, HomeAd, SupportRequest, TextPost, AlertLog, Report, Payout, Coupon, Boost
} = require('../models');
const C = require('../utils/coupons');
const { broadcast } = require('../utils/viral');
const { decrypt, isKeyConfigured } = require('../utils/crypto');
const { createNotification: notifyUser } = require('../utils/notifications');
const { getDbUsage, adminAlert } = require('../utils/alerts');
const { getPlans, isProUser } = require('../utils/plans');
const { getBotStatus } = require('../bot');
const { deleteFromMongo, uploadToMongo } = require('../config/mongoStorage');
const { uploadAdImage, validateParsedUploads, safeImageContentType } = require('../middleware/upload');
const { createNotification, sendWebPush } = require('../utils/notifications');

const router = express.Router();


// ============================================================
// ADMIN SECURITY
// ============================================================

const isAdmin = (req, res, next) => {

  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Admin access required'
    });
  }

  next();
};

router.use(auth, isAdmin);


// ============================================================
// HELPERS
// ============================================================

function paginate(page, limit) {

  const p = Math.max(
    1,
    parseInt(page, 10) || 1
  );

  const l = Math.min(
    100,
    Math.max(
      1,
      parseInt(limit, 10) || 50
    )
  );

  return {
    skip: (p - 1) * l,
    limit: l,
    page: p
  };
}


function validObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function cleanHttpUrl(value) {
  const v = String(value || '').trim().slice(0, 1000);
  if (!v) return '';
  if (/^\/(?!\/)/.test(v)) return v;
  try {
    const u = new URL(v);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    return u.toString();
  } catch (_) { return ''; }
}

function adPayload(body, existing = {}) {
  const activeValue = body.active === undefined ? (existing.active ?? true) : (body.active === true || body.active === 'true' || body.active === 1 || body.active === '1');
  const title = String(body.title ?? existing.title ?? '').trim().slice(0, 120);
  if (!title) throw new Error('Ad title is required');
  const imageUrl = cleanHttpUrl(body.imageUrl ?? existing.imageUrl);
  const linkUrl = cleanHttpUrl(body.linkUrl ?? existing.linkUrl ?? '/');
  if (body.imageUrl && !imageUrl) throw new Error('Invalid ad image URL');
  if (body.linkUrl && !linkUrl) throw new Error('Invalid ad link URL');
  const originalPrice = Math.max(0, Number(body.originalPrice ?? existing.originalPrice ?? 0) || 0);
  const salePrice = Math.max(0, Number(body.salePrice ?? existing.salePrice ?? 0) || 0);
  let discountPercent = Math.max(0, Math.min(100, Number(body.discountPercent ?? existing.discountPercent ?? 0) || 0));
  if (!discountPercent && originalPrice > 0 && salePrice > 0 && salePrice < originalPrice) {
    discountPercent = Math.round((1 - salePrice / originalPrice) * 100);
  }
  return {
    title,
    description: String(body.description ?? existing.description ?? '').trim().slice(0, 500),
    imageUrl,
    linkUrl: linkUrl || '/',
    productName: String(body.productName ?? existing.productName ?? '').trim().slice(0, 120),
    originalPrice, salePrice, discountPercent,
    badge: String(body.badge ?? existing.badge ?? 'Featured').trim().slice(0, 40) || 'Featured',
    adType: ['personal','sponsor'].includes(String(body.adType ?? existing.adType)) ? String(body.adType ?? existing.adType) : 'personal',
    active: activeValue,
    startsAt: body.startsAt ? new Date(body.startsAt) : (existing.startsAt || null),
    endsAt: body.endsAt ? new Date(body.endsAt) : (existing.endsAt || null),
  };
}


function safeUser(user) {

  if (!user) return null;

  const u = {
    ...user,
    id: user._id
      ? user._id.toString()
      : user.id
  };

  delete u.password;
  delete u.token;

  return u;
}


// ============================================================
// ADMIN DASHBOARD OVERVIEW
// ============================================================

router.get('/dashboard', async (req, res) => {

  try {

    const onlineSince = new Date(
      Date.now() - 5 * 60 * 1000
    );

    const [
      totalUsers,
      onlineUsers,
      newUsersToday,

      totalPresets,
      approvedPresets,
      pendingPresets,
      rejectedPresets,

      freePresets,
      paidPresets,

      totalDownloads,
      totalOrders,

      paidOrders,
      pendingOrders,
      cancelledOrders,
      refundedOrders,

      paidUsers,

      revenueAgg,

      totalViews,
      totalLikes,
      totalShares
    ] = await Promise.all([

      User.countDocuments(),

      User.countDocuments({
        status: 'active',
        lastActive: { $gte: onlineSince }
      }),

      User.countDocuments({
        createdAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }),

      Preset.countDocuments(),

      Preset.countDocuments({
        status: 'approved'
      }),

      Preset.countDocuments({
        status: 'pending'
      }),

      Preset.countDocuments({
        status: 'rejected'
      }),

      Preset.countDocuments({
        price: 0
      }),

      Preset.countDocuments({
        price: { $gt: 0 }
      }),

      Download.countDocuments(),

      Order.countDocuments(),

      Order.countDocuments({
        status: 'paid'
      }),

      Order.countDocuments({
        status: 'created'
      }),

      Order.countDocuments({
        status: 'cancelled'
      }),

      Order.countDocuments({
        status: 'refunded'
      }),

      Order.distinct('userId', {
        status: 'paid'
      }),

      Order.aggregate([
        {
          $match: {
            status: 'paid'
          }
        },
        {
          $group: {
            _id: null,
            total: {
              $sum: '$amount'
            }
          }
        }
      ]),

      Preset.aggregate([
        {
          $group: {
            _id: null,
            total: {
              $sum: '$views'
            }
          }
        }
      ]),

      Preset.aggregate([
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $size: '$likes'
              }
            }
          }
        }
      ]),

      Preset.aggregate([
        {
          $group: {
            _id: null,
            total: {
              $sum: '$shares'
            }
          }
        }
      ])
    ]);


    res.json({

      users: {
        total: totalUsers,
        online: onlineUsers,
        offline: Math.max(
          0,
          totalUsers - onlineUsers
        ),
        newToday: newUsersToday,
        paidUsers: paidUsers.length
      },

      presets: {
        total: totalPresets,
        approved: approvedPresets,
        pending: pendingPresets,
        rejected: rejectedPresets,
        free: freePresets,
        paid: paidPresets
      },

      engagement: {
        downloads: totalDownloads,
        views: totalViews[0]?.total || 0,
        likes: totalLikes[0]?.total || 0,
        shares: totalShares[0]?.total || 0
      },

      payments: {
        totalOrders,
        paidOrders,
        pendingOrders,
        cancelledOrders,
        refundedOrders,
        paidUsers: paidUsers.length,
        totalRevenue: revenueAgg[0]?.total || 0
      }

    });

  } catch (err) {

    console.error(
      'Admin dashboard error:',
      err
    );

    res.status(500).json({
      error: 'Failed to load admin dashboard'
    });
  }
});


// ============================================================
// ALL USERS
// ============================================================

router.get('/users', async (req, res) => {

  try {

    const {
      skip,
      limit,
      page
    } = paginate(
      req.query.page,
      req.query.limit
    );

    const search = String(
      req.query.search || ''
    ).trim();

    const filter = {};

    if (search) {

      const safe = search.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );

      const regex = new RegExp(
        safe,
        'i'
      );

      filter.$or = [
        { name: regex },
        { username: regex },
        { email: regex }
      ];
    }


    const [
      users,
      total
    ] = await Promise.all([

      User.find(filter)
        .select('-password -token -passwordResetTokenHash -passwordResetExpires -pushSubscriptions -sessionVersion')
        .sort({
          createdAt: -1
        })
        .skip(skip)
        .limit(limit)
        .lean(),

      User.countDocuments(filter)
    ]);


    const userIds = users.map(
      u => u._id
    );


    const [
      presetStats,
      paymentStats,
      downloadStats
    ] = await Promise.all([

      Preset.aggregate([
        {
          $match: {
            authorId: {
              $in: userIds
            }
          }
        },
        {
          $group: {
            _id: '$authorId',

            totalPresets: {
              $sum: 1
            },

            approvedPresets: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      '$status',
                      'approved'
                    ]
                  },
                  1,
                  0
                ]
              }
            },

            views: {
              $sum: '$views'
            },

            downloads: {
              $sum: '$downloads'
            },

            likes: {
              $sum: {
                $size: '$likes'
              }
            },

            shares: {
              $sum: '$shares'
            },

            revenue: {
              $sum: '$totalRevenue'
            }
          }
        }
      ]),

      Order.aggregate([
        {
          $match: {
            userId: {
              $in: userIds
            }
          }
        },
        {
          $group: {
            _id: '$userId',

            orders: {
              $sum: 1
            },

            paidOrders: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      '$status',
                      'paid'
                    ]
                  },
                  1,
                  0
                ]
              }
            },

            spent: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      '$status',
                      'paid'
                    ]
                  },
                  '$amount',
                  0
                ]
              }
            }
          }
        }
      ]),

      Download.aggregate([
        {
          $match: {
            userId: {
              $in: userIds
            }
          }
        },
        {
          $group: {
            _id: '$userId',
            downloads: {
              $sum: 1
            }
          }
        }
      ])
    ]);


    const presetMap = new Map(
      presetStats.map(x => [
        x._id.toString(),
        x
      ])
    );

    const paymentMap = new Map(
      paymentStats.map(x => [
        x._id.toString(),
        x
      ])
    );

    const downloadMap = new Map(
      downloadStats.map(x => [
        x._id.toString(),
        x
      ])
    );


    const onlineSince = new Date(
      Date.now() - 5 * 60 * 1000
    );


    const result = users.map(u => {

      const id = u._id.toString();

      const p = presetMap.get(id) || {};
      const pay = paymentMap.get(id) || {};
      const dl = downloadMap.get(id) || {};

      return {

        ...safeUser(u),

        online:
          u.status === 'active' &&
          u.lastActive &&
          new Date(u.lastActive) >= onlineSince,

        stats: {

          totalPresets:
            p.totalPresets || 0,

          approvedPresets:
            p.approvedPresets || 0,

          views:
            p.views || 0,

          downloads:
            p.downloads || 0,

          likes:
            p.likes || 0,

          shares:
            p.shares || 0,

          creatorRevenue:
            p.revenue || 0,

          userDownloads:
            dl.downloads || 0,

          totalOrders:
            pay.orders || 0,

          paidOrders:
            pay.paidOrders || 0,

          totalSpent:
            pay.spent || 0
        }
      };
    });


    res.json({
      items: result,
      total,
      page,
      totalPages: Math.ceil(
        total / limit
      ),
      limit
    });

  } catch (err) {

    console.error(
      'Admin users error:',
      err
    );

    res.status(500).json({
      error: 'Failed to load users'
    });
  }
});


// ============================================================
// SINGLE USER FULL DETAILS
// ============================================================

router.get('/users/:id/details', async (req, res) => {

  try {

    if (!validObjectId(req.params.id)) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    const user = await User.findById(
      req.params.id
    )
      .select('-password -token -passwordResetTokenHash -passwordResetExpires -pushSubscriptions -sessionVersion')
      .lean();

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }


    const [
      presets,
      orders,
      downloads
    ] = await Promise.all([

      Preset.find({
        authorId: user._id
      })
        .sort({
          createdAt: -1
        })
        .lean(),

      Order.find({
        userId: user._id
      })
        .populate(
          'presetId',
          'name price author'
        )
        .sort({
          createdAt: -1
        })
        .lean(),

      Download.find({
        userId: user._id
      })
        .populate(
          'presetId',
          'name author previewImage'
        )
        .sort({
          downloadedAt: -1
        })
        .limit(100)
        .lean()
    ]);


    const paidOrders = orders.filter(
      x => x.status === 'paid'
    );


    res.json({

      user: safeUser(user),

      profile: {
        followers:
          (user.followers || []).length,

        following:
          (user.following || []).length,

        wishlist:
          (user.wishlist || []).length,

        notifications:
          (user.notifications || []).length,

        unreadNotifications:
          (user.notifications || [])
            .filter(n => !n.read).length,

        subscription:
          user.subscription || {},

        referral:
          user.referral || {}
      },

      presets: presets.map(p => ({
        id: p._id.toString(),
        name: p.name,
        category: p.category,
        price: p.price,
        status: p.status,
        views: p.views,
        downloads: p.downloads,
        likes:
          (p.likes || []).length,
        shares: p.shares,
        avgRating: p.avgRating,
        revenue: p.totalRevenue,
        createdAt: p.createdAt
      })),

      payments: {

        totalOrders:
          orders.length,

        paidOrders:
          paidOrders.length,

        totalSpent:
          paidOrders.reduce(
            (sum, o) =>
              sum + Number(o.amount || 0),
            0
          ),

        orders: orders.map(o => ({
          id: o._id.toString(),
          amount: o.amount,
          currency: o.currency,
          status: o.status,
          paymentId: o.paymentId || null,
          paidAt: o.paidAt || null,
          createdAt: o.createdAt,

          preset: o.presetId
            ? {
                id: o.presetId._id?.toString(),
                name: o.presetId.name,
                price: o.presetId.price,
                author: o.presetId.author
              }
            : null
        }))
      },

      downloads: downloads.map(d => ({
        id: d._id.toString(),
        downloadedAt: d.downloadedAt,

        preset: d.presetId
          ? {
              id: d.presetId._id?.toString(),
              name: d.presetId.name,
              author: d.presetId.author,
              previewImage:
                d.presetId.previewImage
            }
          : null
      }))
    });

  } catch (err) {

    console.error(
      'Admin user details error:',
      err
    );

    res.status(500).json({
      error: 'Failed to load user details'
    });
  }
});


// ============================================================
// SEND NOTIFICATION TO ONE USER
// ============================================================

router.post('/notifications/user/:id', async (req, res) => {

  try {

    if (!validObjectId(req.params.id)) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    const message = String(
      req.body.message || ''
    ).trim();

    const type = String(
      req.body.type || 'admin'
    ).trim();

    const link = String(
      req.body.link || '/'
    ).trim();

    if (link.length > 500 || !/^\/(?!\/)[^\s]{0,500}$/.test(link)) {
      return res.status(400).json({
        error: 'Notification link must be an internal PresetHub path'
      });
    }

    if (!message) {
      return res.status(400).json({
        error: 'Notification message is required'
      });
    }

    if (message.length > 500) {
      return res.status(400).json({
        error: 'Notification is too long'
      });
    }

    const user = await User.findById(
      req.params.id
    );

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }


    await createNotification(user._id, type, message, link, 'PresetHub');

    res.json({
      success: true,
      message: 'Notification sent'
    });

  } catch (err) {

    console.error(
      'Admin notification error:',
      err
    );

    res.status(500).json({
      error: 'Failed to send notification'
    });
  }
});


// ============================================================
// SEND NOTIFICATION TO ALL USERS
// ============================================================

router.post('/notifications/all', async (req, res) => {

  try {

    const message = String(
      req.body.message || ''
    ).trim();

    const type = String(
      req.body.type || 'announcement'
    ).trim();

    const link = String(
      req.body.link || '/'
    ).trim();

    if (link.length > 500 || !/^\/(?!\/)[^\s]{0,500}$/.test(link)) {
      return res.status(400).json({
        error: 'Notification link must be an internal PresetHub path'
      });
    }

    if (!message) {
      return res.status(400).json({
        error: 'Notification message is required'
      });
    }

    if (message.length > 500) {
      return res.status(400).json({
        error: 'Notification is too long'
      });
    }


    const notification = {
      _id: new mongoose.Types.ObjectId(),
      type,
      message,
      link,
      read: false,
      createdAt: new Date()
    };


    const result = await User.updateMany(
      { status: { $ne: 'deactivated' } },
      { $push: { notifications: { $each: [notification], $slice: -100 } } }
    );

    // Deliver background Web Push where users have enabled it. In-app notifications
    // are already written in one efficient MongoDB update above.
    const pushUsers = await User.find({ status: { $ne: 'deactivated' }, 'pushSubscriptions.0': { $exists: true } }).select('_id').lean();
    const pushPayload = { title: 'PresetHub', message, link };
    for (let i = 0; i < pushUsers.length; i += 10) {
      await Promise.allSettled(pushUsers.slice(i, i + 10).map(u => sendWebPush(u._id, pushPayload)));
    }

    res.json({ success: true, message: 'Notification sent to users', modified: result.modifiedCount, pushEligible: pushUsers.length });

  } catch (err) {

    console.error(
      'Broadcast notification error:',
      err
    );

    res.status(500).json({
      error: 'Failed to broadcast notification'
    });
  }
});


// ============================================================
// ACCOUNT SUPPORT REQUESTS / ADMIN ACCOUNT CONTROL
// ============================================================

router.get('/support-requests', async (req, res) => {
  try {
    const status = String(req.query.status || 'open');
    const filter = ['open','in_progress','resolved','rejected','all'].includes(status) && status !== 'all' ? { status } : {};
    const rows = await SupportRequest.find(filter).sort({ createdAt: -1 }).limit(100).populate('userId', 'name username email status role').lean();
    res.json({ items: rows.map(r => ({ ...r, id: r._id.toString(), userId: r.userId?._id?.toString() || r.userId || null })) });
  } catch (err) { console.error('Support requests error:', err); res.status(500).json({ error: 'Failed to load support requests' }); }
});

router.put('/support-requests/:id', async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid request ID' });
    const request = await SupportRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    const status = String(req.body?.status || '');
    if (!['open','in_progress','resolved','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid request status' });
    request.status = status;
    request.adminNote = String(req.body?.adminNote || '').slice(0, 1000);
    request.resolvedBy = ['resolved','rejected'].includes(status) ? req.user.id : null;
    request.resolvedAt = ['resolved','rejected'].includes(status) ? new Date() : null;
    await request.save();
    if (request.userId) await createNotification(request.userId, 'support', `Your account support request is now ${status.replace('_',' ')}.`, '/');
    res.json({ success: true, request: { ...request.toObject(), id: request._id.toString() } });
  } catch (err) { console.error('Support update error:', err); res.status(500).json({ error: 'Failed to update support request' }); }
});

router.post('/users/:id/reset-password', async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid user ID' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin' && user._id.toString() !== req.user.id) return res.status(403).json({ error: 'Cannot reset another admin password' });
    const tempPassword = crypto.randomBytes(8).toString('base64url').slice(0, 12) + 'aA1';
    user.password = await bcrypt.hash(tempPassword, 12);
    user.passwordResetTokenHash = '';
    user.passwordResetExpires = null;
    user.sessionVersion = Number(user.sessionVersion || 0) + 1;
    await user.save();
    if (user._id.toString() !== req.user.id) await createNotification(user._id, 'security', 'An administrator reset your password. Use the temporary password provided by support and change it immediately.', '/');
    res.json({ success: true, temporaryPassword: tempPassword, message: 'Temporary password generated. It is shown only once.' });
  } catch (err) { console.error('Admin reset password error:', err); res.status(500).json({ error: 'Failed to reset password' }); }
});

// ============================================================
// HOME AD MANAGEMENT
// ============================================================

router.get('/ads', async (req, res) => {
  try {
    const ads = await HomeAd.find({}).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ items: ads.map(a => ({ ...a, id: a._id.toString() })) });
  } catch (err) {
    console.error('Admin ads error:', err);
    res.status(500).json({ error: 'Failed to load ads' });
  }
});

router.post('/ads', uploadAdImage, async (req, res) => {
  try {
    if (req.file) validateParsedUploads(req);
    const payload = adPayload(req.body || {});
    if (req.file) {
      payload.imageUrl = await uploadToMongo(req.file.buffer, `ads/${crypto.randomUUID()}.webp`, safeImageContentType(req.file), { kind: 'ad', userId: req.user.id });
    }
    const ad = await HomeAd.create({ ...payload, createdBy: req.user.id });
    res.status(201).json({ success: true, ad: { ...ad.toObject(), id: ad._id.toString() } });
  } catch (err) {
    console.error('Create ad error:', err);
    res.status(400).json({ error: err.message || 'Failed to create ad' });
  }
});

router.put('/ads/:id', uploadAdImage, async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ad ID' });
    if (req.file) validateParsedUploads(req);
    const ad = await HomeAd.findById(req.params.id);
    if (!ad) return res.status(404).json({ error: 'Ad not found' });
    const oldImage = ad.imageUrl;
    Object.assign(ad, adPayload(req.body || {}, ad.toObject()));
    if (req.file) ad.imageUrl = await uploadToMongo(req.file.buffer, `ads/${crypto.randomUUID()}.webp`, safeImageContentType(req.file), { kind: 'ad', userId: req.user.id });
    await ad.save();
    if (req.file && oldImage && oldImage !== ad.imageUrl) await deleteFromMongo(oldImage);
    res.json({ success: true, ad: { ...ad.toObject(), id: ad._id.toString() } });
  } catch (err) {
    console.error('Update ad error:', err);
    res.status(400).json({ error: err.message || 'Failed to update ad' });
  }
});

router.delete('/ads/:id', async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ad ID' });
    const ad = await HomeAd.findById(req.params.id).select('imageUrl');
    if (!ad) return res.status(404).json({ error: 'Ad not found' });
    await deleteFromMongo(ad.imageUrl);
    await ad.deleteOne();
    res.json({ success: true });
  } catch (err) {
    console.error('Delete ad error:', err);
    res.status(500).json({ error: 'Failed to delete ad' });
  }
});

// ============================================================
// PRESET MANAGEMENT
// ============================================================

router.get('/presets', async (req, res) => {

  try {

    const {
      skip,
      limit,
      page
    } = paginate(
      req.query.page,
      req.query.limit
    );

    const filter = {};

    if (
      ['approved', 'rejected']
        .includes(req.query.status)
    ) {
      filter.status =
        req.query.status;
    }


    const [
      presets,
      total
    ] = await Promise.all([

      Preset.find(filter)
        .sort({
          createdAt: -1
        })
        .skip(skip)
        .limit(limit)
        .lean(),

      Preset.countDocuments(filter)
    ]);


    res.json({
      items: presets.map(p => ({
        ...p,
        id: p._id.toString(),
        authorId:
          p.authorId.toString()
      })),
      total,
      page,
      totalPages:
        Math.ceil(total / limit),
      limit
    });

  } catch (err) {

    console.error(
      'Admin presets error:',
      err
    );

    res.status(500).json({
      error: 'Failed to load presets'
    });
  }
});


// Optional manual moderation.
// This is NO LONGER required for uploads.

router.put('/presets/:id/status', async (req, res) => {

  try {

    if (!validObjectId(req.params.id)) {
      return res.status(400).json({
        error: 'Invalid preset ID'
      });
    }

    const {
      status
    } = req.body;

    if (
      !['approved', 'rejected']
        .includes(status)
    ) {
      return res.status(400).json({
        error: 'Invalid status'
      });
    }


    const preset =
      await Preset.findByIdAndUpdate(
        req.params.id,
        { status },
        {
          new: true
        }
      ).lean();


    if (!preset) {
      return res.status(404).json({
        error: 'Preset not found'
      });
    }


    res.json({
      ...preset,
      id: preset._id.toString()
    });

  } catch (err) {

    console.error(
      'Preset status error:',
      err
    );

    res.status(500).json({
      error: 'Failed to update preset'
    });
  }
});


// ============================================================
// TOP / VIRAL PRESETS
// ============================================================

router.get('/viral-presets', async (req, res) => {

  try {

    const presets =
      await Preset.aggregate([

        {
          $match: {
            status: 'approved'
          }
        },

        {
          $addFields: {

            viralScore: {
              $add: [

                {
                  $multiply: [
                    {
                      $ifNull: [
                        '$views',
                        0
                      ]
                    },
                    1
                  ]
                },

                {
                  $multiply: [
                    {
                      $size: '$likes'
                    },
                    5
                  ]
                },

                {
                  $multiply: [
                    {
                      $ifNull: [
                        '$downloads',
                        0
                      ]
                    },
                    8
                  ]
                },

                {
                  $multiply: [
                    {
                      $ifNull: [
                        '$shares',
                        0
                      ]
                    },
                    10
                  ]
                }
              ]
            }
          }
        },

        {
          $sort: {
            viralScore: -1
          }
        },

        {
          $limit: 50
        }
      ]);


    res.json(
      presets.map(p => ({
        ...p,
        id: p._id.toString(),
        authorId:
          p.authorId.toString()
      }))
    );

  } catch (err) {

    console.error(
      'Viral presets error:',
      err
    );

    res.status(500).json({
      error: 'Failed to load viral presets'
    });
  }
});


// ============================================================
// PAYMENT OVERVIEW
// ============================================================

router.get('/payments', async (req, res) => {

  try {

    const [
      total,
      paid,
      created,
      refunded,
      cancelled,
      revenue,
      paidUsers
    ] = await Promise.all([

      Order.countDocuments(),

      Order.countDocuments({
        status: 'paid'
      }),

      Order.countDocuments({
        status: 'created'
      }),

      Order.countDocuments({
        status: 'refunded'
      }),

      Order.countDocuments({
        status: 'cancelled'
      }),

      Order.aggregate([
        {
          $match: {
            status: 'paid'
          }
        },
        {
          $group: {
            _id: null,
            amount: {
              $sum: '$amount'
            }
          }
        }
      ]),

      Order.distinct(
        'userId',
        {
          status: 'paid'
        }
      )
    ]);


    res.json({

      totalOrders: total,
      paidOrders: paid,
      pendingOrders: created,
      refundedOrders: refunded,
      cancelledOrders: cancelled,

      paidUsers:
        paidUsers.length,

      totalRevenue:
        revenue[0]?.amount || 0

    });

  } catch (err) {

    console.error(
      'Admin payment error:',
      err
    );

    res.status(500).json({
      error: 'Failed to load payment statistics'
    });
  }
});


// ============================================================
// EXISTING ANALYTICS COMPATIBILITY
// ============================================================

router.get('/analytics', async (req, res) => {

  try {

    const [
      totalUsers,
      totalPresets,
      totalDownloads,
      totalOrders,
      revenueAgg,
      freePresets,
      paidPresets,
      ratingAgg
    ] = await Promise.all([

      User.countDocuments(),

      Preset.countDocuments(),

      Download.countDocuments(),

      Order.countDocuments(),

      Order.aggregate([
        {
          $match: {
            status: 'paid'
          }
        },
        {
          $group: {
            _id: null,
            total: {
              $sum: '$amount'
            }
          }
        }
      ]),

      Preset.countDocuments({
        price: 0
      }),

      Preset.countDocuments({
        price: {
          $gt: 0
        }
      }),

      Preset.aggregate([
        {
          $match: {
            avgRating: {
              $gt: 0
            }
          }
        },
        {
          $group: {
            _id: null,
            avg: {
              $avg: '$avgRating'
            }
          }
        }
      ])
    ]);


    res.json({

      totalUsers,
      totalPresets,
      totalDownloads,
      totalOrders,

      totalRevenue:
        revenueAgg[0]?.total || 0,

      freePresets,
      paidPresets,

      avgRating:
        Number(
          ratingAgg[0]?.avg || 0
        ).toFixed(1)

    });

  } catch (err) {

    console.error(
      'Analytics error:',
      err
    );

    res.status(500).json({
      error: 'Failed to load analytics'
    });
  }
});


// ============================================================
// STATS COMPATIBILITY
// ============================================================

router.get('/stats', async (req, res) => {

  try {

    const startOfDay = new Date();

    startOfDay.setHours(
      0,
      0,
      0,
      0
    );

    const onlineSince = new Date(
      Date.now() - 5 * 60 * 1000
    );


    const [
      newUsersToday,
      newPresetsToday,
      downloadsToday,
      totalUsers,
      totalPresets,
      totalDownloads,
      totalOrders,
      onlineUsers
    ] = await Promise.all([

      User.countDocuments({
        createdAt: {
          $gte: startOfDay
        }
      }),

      Preset.countDocuments({
        createdAt: {
          $gte: startOfDay
        }
      }),

      Download.countDocuments({
        downloadedAt: {
          $gte: startOfDay
        }
      }),

      User.countDocuments(),

      Preset.countDocuments(),

      Download.countDocuments(),

      Order.countDocuments(),

      User.countDocuments({
        status: 'active',
        lastActive: {
          $gte: onlineSince
        }
      })
    ]);


    res.json({

      newUsersToday,
      newPresetsToday,
      downloadsToday,

      totalUsers,
      totalPresets,
      totalDownloads,
      totalOrders,

      onlineUsers

    });

  } catch (err) {

    console.error(
      'Stats error:',
      err
    );

    res.status(500).json({
      error: 'Failed to load stats'
    });
  }
});


// ============================================================
// USER BLOCK / ACTIVATE
// ============================================================

router.put('/users/:id/status', async (req, res) => {

  try {

    if (!validObjectId(req.params.id)) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    const {
      status
    } = req.body;

    if (
      !['active', 'blocked', 'deactivated']
        .includes(status)
    ) {
      return res.status(400).json({
        error: 'Invalid status'
      });
    }


    const user =
      await User.findById(
        req.params.id
      );

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    if (user.role === 'admin' && user._id.toString() === req.user.id) {
      return res.status(400).json({ error: 'Cannot change your own admin status' });
    }

    if (
      user.role === 'admin' &&
      user._id.toString() !== req.user.id
    ) {
      return res.status(400).json({
        error: 'Cannot change another admin status'
      });
    }


    user.status = status;

    await user.save();


    res.json({
      success: true,
      status: user.status
    });

  } catch (err) {

    console.error(
      'User status error:',
      err
    );

    res.status(500).json({
      error: 'Failed to update user status'
    });
  }
});


// ============================================================
// DELETE USER
// ============================================================

router.delete('/users/:id', async (req, res) => {

  try {

    if (!validObjectId(req.params.id)) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    const user =
      await User.findById(
        req.params.id
      );

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    if (user.role === 'admin') {
      return res.status(400).json({
        error: 'Cannot delete admin'
      });
    }


    const presets = await Preset.find({ authorId: user._id }).select('_id fileUrl previewImage').lean();
    const presetIds = presets.map(p => p._id);
    await Promise.all(presets.flatMap(p => [deleteFromMongo(p.fileUrl), deleteFromMongo(p.previewImage)]));
    await Promise.all([
      Preset.deleteMany({ authorId: user._id }),
      Download.deleteMany({ $or: [{ userId: user._id }, { presetId: { $in: presetIds } }] }),
      Share.deleteMany({ $or: [{ userId: user._id }, { presetId: { $in: presetIds } }] }),
      ShareClick.deleteMany({ $or: [{ userId: user._id }, { presetId: { $in: presetIds } }] }),
      ShortLink.deleteMany({ $or: [{ userId: user._id }, { presetId: { $in: presetIds } }] }),
      Comment.deleteMany({ $or: [{ userId: user._id }, { presetId: { $in: presetIds } }] }),
      Message.deleteMany({ $or: [{ senderId: user._id }, { receiverId: user._id }] }),
      Order.deleteMany({ userId: user._id }),
      User.updateMany({ followers: user._id }, { $pull: { followers: user._id } }),
      User.updateMany({ following: user._id }, { $pull: { following: user._id } }),
      User.updateMany({ 'referral.referredBy': user._id }, { $set: { 'referral.referredBy': null } })
    ]);
    await User.deleteOne({ _id: user._id });


    res.json({
      success: true
    });

  } catch (err) {

    console.error(
      'Delete user error:',
      err
    );

    res.status(500).json({
      error: 'Failed to delete user'
    });
  }
});


// ============================================================
// v3.2 — OVERVIEW, ALERTS, SYSTEM, SUBSCRIPTIONS, TEXT POSTS
// ============================================================
router.get('/overview', async (req, res) => {
  try {
    const dayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const since14 = new Date(Date.now() - 14 * 86400000);
    const [users, usersToday, online, presets, texts, textsToday, proUsers, downloads, unreadAlerts, criticalAlerts, openSupport,
      rev, signups, recentUsers, recentAlerts, pendingOrders, suspicious] = await Promise.all([
      User.countDocuments(), User.countDocuments({ createdAt: { $gte: dayStart } }),
      User.countDocuments({ status: 'active', lastActive: { $gte: new Date(Date.now() - 5 * 60000) } }),
      Preset.countDocuments({ status: 'approved' }), TextPost.countDocuments({ status: 'approved' }),
      TextPost.countDocuments({ createdAt: { $gte: dayStart } }),
      User.countDocuments({ 'subscription.expiry': { $gt: new Date() }, 'subscription.plan': { $ne: '' } }),
      Download.countDocuments(), AlertLog.countDocuments({ read: false }),
      AlertLog.countDocuments({ read: false, severity: 'critical' }), SupportRequest.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
      Order.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: '$kind', amount: { $sum: '$amount' }, n: { $sum: 1 } } }]),
      User.aggregate([{ $match: { createdAt: { $gte: since14 } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      User.find({}).sort({ createdAt: -1 }).limit(6).select('name username email createdAt status').lean(),
      AlertLog.find({}).sort({ lastAt: -1 }).limit(6).lean(),
      Order.countDocuments({ status: 'created' }), Order.countDocuments({ status: 'suspicious' })
    ]);
    const revBy = Object.fromEntries(rev.map(r => [r._id || 'preset', r]));
    const map = Object.fromEntries(signups.map(x => [x._id, x.n]));
    const series = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); series.push({ date: d, users: map[d] || 0 }); }
    res.json({
      users, usersToday, online, presets, texts, textsToday, proUsers, downloads, unreadAlerts, criticalAlerts, openSupport, pendingOrders, suspiciousOrders: suspicious,
      revenue: { presets: revBy.preset?.amount || 0, subscriptions: revBy.subscription?.amount || 0, total: (revBy.preset?.amount || 0) + (revBy.subscription?.amount || 0), paidOrders: (revBy.preset?.n || 0) + (revBy.subscription?.n || 0) },
      signupSeries: series,
      recentUsers: recentUsers.map(u => ({ id: String(u._id), name: u.name, username: u.username, email: u.email, createdAt: u.createdAt, status: u.status })),
      recentAlerts: recentAlerts.map(a => ({ id: String(a._id), type: a.type, severity: a.severity, title: a.title, count: a.count, lastAt: a.lastAt, read: a.read }))
    });
  } catch (e) { console.error('Admin overview:', e); res.status(500).json({ error: 'Failed to load overview' }); }
});

router.get('/alerts', async (req, res) => {
  try {
    const f = {};
    if (['new_user', 'security', 'error', 'database', 'payment', 'subscription', 'system', 'viral'].includes(String(req.query.type))) f.type = req.query.type;
    if (['info', 'warning', 'critical'].includes(String(req.query.severity))) f.severity = req.query.severity;
    if (req.query.unread === '1') f.read = false;
    const { skip, limit, page } = paginate(req.query.page, req.query.limit || 30);
    const [items, total] = await Promise.all([AlertLog.find(f).sort({ lastAt: -1 }).skip(skip).limit(limit).lean(), AlertLog.countDocuments(f)]);
    res.json({ items: items.map(a => ({ ...a, id: String(a._id) })), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) { res.status(500).json({ error: 'Failed to load alerts' }); }
});
router.post('/alerts/read-all', async (req, res) => { await AlertLog.updateMany({ read: false }, { $set: { read: true } }); res.json({ success: true }); });
router.put('/alerts/:id/read', async (req, res) => {
  if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  await AlertLog.updateOne({ _id: req.params.id }, { $set: { read: true } }); res.json({ success: true });
});
router.delete('/alerts/:id', async (req, res) => {
  if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  await AlertLog.deleteOne({ _id: req.params.id }); res.json({ success: true });
});
router.post('/alerts/test', async (req, res) => {
  await adminAlert({ type: 'system', severity: 'warning', title: 'Test alert from admin panel', throttleMs: 1000, fingerprint: `test-${Date.now()}`, details: { by: req.user.email, note: 'If you received this on Telegram/e-mail, alerts are working.' } });
  res.json({ success: true });
});

router.get('/system', async (req, res) => {
  try {
    const mem = process.memoryUsage();
    const usage = await getDbUsage();
    const hasEnv = k => Boolean(process.env[k]);
    res.json({
      uptimeMinutes: Math.round(process.uptime() / 60), node: process.version, env: process.env.NODE_ENV || 'development',
      memoryMB: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576) },
      database: usage, bot: getBotStatus(),
      services: {
        payments: hasEnv('YOUPI_API_URL') && hasEnv('YOUPI_MERCHANT_ID') && hasEnv('YOUPI_WEBHOOK_SECRET'),
        email: hasEnv('RESEND_API_KEY'), telegramAlerts: hasEnv('BOT_TOKEN') && hasEnv('ADMIN_CHAT_ID'),
        webPush: hasEnv('VAPID_PUBLIC_KEY') && hasEnv('VAPID_PRIVATE_KEY'), adsense: hasEnv('ADSENSE_CLIENT')
      },
      viralScore: Number(process.env.VIRAL_SCORE || 300)
    });
  } catch (e) { res.status(500).json({ error: 'Failed to load system status' }); }
});

router.get('/subscriptions', async (req, res) => {
  try {
    const now = new Date();
    const users = await User.find({ 'subscription.plan': { $ne: '' }, 'subscription.expiry': { $ne: null } }).sort({ 'subscription.expiry': -1 }).limit(200).select('name username email subscription').lean();
    const orders = await Order.find({ kind: 'subscription' }).sort({ createdAt: -1 }).limit(100).populate('userId', 'name email').lean();
    res.json({
      plans: Object.values(getPlans()),
      users: users.map(u => ({ id: String(u._id), name: u.name, username: u.username, email: u.email, plan: u.subscription.plan, expiry: u.subscription.expiry, active: new Date(u.subscription.expiry) > now })),
      orders: orders.map(o => ({ id: String(o._id), user: o.userId?.name || o.userId?.email || '—', plan: o.plan, amount: o.amount, status: o.status, createdAt: o.createdAt, paidAt: o.paidAt || null }))
    });
  } catch (e) { res.status(500).json({ error: 'Failed to load subscriptions' }); }
});
router.post('/users/:id/pro', async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid user ID' });
    const days = Math.round(Number(req.body?.days));
    if (!Number.isFinite(days) || days < -3650 || days > 3650 || days === 0) return res.status(400).json({ error: 'Days must be between -3650 and 3650 (not 0). Negative removes Pro time.' });
    const user = await User.findById(req.params.id).select('subscription name');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const base = user.subscription?.expiry && new Date(user.subscription.expiry) > new Date() ? new Date(user.subscription.expiry) : new Date();
    const expiry = new Date(base.getTime() + days * 86400000);
    const active = expiry > new Date();
    await User.updateOne({ _id: user._id }, { $set: { 'subscription.expiry': active ? expiry : null, 'subscription.tier': active ? 'pro' : 'free', 'subscription.plan': active ? (user.subscription?.plan || 'monthly') : '', 'subscription.since': user.subscription?.since || new Date() } });
    if (days > 0) await createNotification(user._id, 'subscription', `👑 PresetHub Pro: admin added ${days} day(s). Active until ${expiry.toLocaleDateString('en-IN')}.`, '/', '👑 PresetHub Pro');
    res.json({ success: true, expiry: active ? expiry : null });
  } catch (e) { res.status(500).json({ error: 'Failed to update Pro status' }); }
});

router.get('/texts', async (req, res) => {
  try {
    const f = {};
    if (['approved', 'rejected'].includes(String(req.query.status))) f.status = req.query.status;
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q) f.$or = [{ text: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { author: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
    const { skip, limit, page } = paginate(req.query.page, req.query.limit || 30);
    const [items, total] = await Promise.all([TextPost.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), TextPost.countDocuments(f)]);
    res.json({ items: items.map(t => ({ id: String(t._id), title: t.title, text: t.text.slice(0, 300), category: t.category, author: t.author, status: t.status, likes: (t.likes || []).length, copies: t.copies, shares: t.shares, views: t.views, comments: t.commentsCount, createdAt: t.createdAt })), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) { res.status(500).json({ error: 'Failed to load text posts' }); }
});
router.put('/texts/:id/status', async (req, res) => {
  if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const status = String(req.body?.status);
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const t = await TextPost.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true }).select('authorId title').lean();
  if (!t) return res.status(404).json({ error: 'Post not found' });
  if (status === 'rejected') await createNotification(t.authorId, 'moderation', 'Your text post was removed by the PresetHub team for violating community rules.', '/shayari/');
  res.json({ success: true });
});
router.delete('/texts/:id', async (req, res) => {
  if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  await Promise.all([TextPost.deleteOne({ _id: req.params.id }), Comment.deleteMany({ textId: req.params.id })]);
  res.json({ success: true });
});

// ---------- COMMUNITY REPORTS (moderation queue) ----------
router.get('/reports', async (req, res) => {
  try {
    const f = {};
    if (['open', 'resolved', 'dismissed'].includes(String(req.query.status))) f.status = req.query.status;
    if (['preset', 'text', 'user', 'comment'].includes(String(req.query.targetType))) f.targetType = req.query.targetType;
    const { skip, limit, page } = paginate(req.query.page, req.query.limit || 30);
    const [rows, total] = await Promise.all([
      Report.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('reporterId', 'name username').lean(),
      Report.countDocuments(f)
    ]);
    // Load a short preview of each reported item so the admin can decide without leaving the panel.
    const previews = await Promise.all(rows.map(async r => {
      const M = { preset: Preset, text: TextPost, comment: Comment, user: User }[r.targetType];
      const doc = M ? await M.findById(r.targetId).select(r.targetType === 'preset' ? 'name status' : r.targetType === 'user' ? 'name username' : 'text status title').lean() : null;
      return doc ? (doc.text || doc.name || doc.username || '').slice(0, 200) + (doc.status ? ` [${doc.status}]` : '') : '(deleted)';
    }));
    res.json({
      items: rows.map((r, i) => ({ id: String(r._id), targetType: r.targetType, targetId: String(r.targetId), reason: r.reason, details: r.details, status: r.status, reporter: r.reporterId?.name || r.reporterId?.username || '—', createdAt: r.createdAt, preview: previews[i] })),
      total, page, pages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (e) { res.status(500).json({ error: 'Failed to load reports' }); }
});

// action: 'hide' (text/preset -> rejected), 'restore' (back to approved), 'dismiss' (report ignored), 'resolve'
router.put('/reports/:id', async (req, res) => {
  if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const action = String(req.body?.action || '');
  const report = await Report.findById(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  const M = { preset: Preset, text: TextPost }[report.targetType];
  if (action === 'hide' && M) await M.updateOne({ _id: report.targetId }, { $set: { status: 'rejected' } });
  if (action === 'restore' && M) await M.updateOne({ _id: report.targetId }, { $set: { status: 'approved' } });
  report.status = action === 'dismiss' ? 'dismissed' : 'resolved';
  report.resolvedBy = req.user.id; report.resolvedAt = new Date();
  await report.save();
  // Close every other open report on the same item in one go.
  if (action !== 'restore') await Report.updateMany({ targetType: report.targetType, targetId: report.targetId, status: 'open' }, { $set: { status: report.status, resolvedBy: req.user.id, resolvedAt: new Date() } });
  res.json({ success: true, status: report.status });
});

// ---------- CREATOR PAYOUTS (admin pays manually, then records the bank reference) ----------
router.get('/payouts', async (req, res) => {
  try {
    const f = {};
    if (['requested', 'approved', 'paid', 'rejected'].includes(String(req.query.status))) f.status = req.query.status;
    const { skip, limit, page } = paginate(req.query.page, req.query.limit || 30);
    const [rows, total] = await Promise.all([
      Payout.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('userId', 'name username email').lean(),
      Payout.countDocuments(f)
    ]);
    res.json({
      items: rows.map(x => ({
        id: String(x._id), creator: x.userId?.name || x.userId?.username || '—', creatorEmail: x.userId?.email || '', creatorId: String(x.userId?._id || ''),
        amount: Math.round(x.amountPaise) / 100, method: x.method, destination: x.destinationMasked, status: x.status,
        reference: x.reference || '', note: x.adminNote || '', createdAt: x.createdAt, processedAt: x.processedAt
      })),
      total, page, pages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (e) { res.status(500).json({ error: 'Failed to load payouts' }); }
});

// Full bank/UPI details are decrypted only on request and every view is recorded.
router.get('/payouts/:id/details', async (req, res) => {
  if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  if (!isKeyConfigured()) return res.status(503).json({ error: 'PAYOUT_ENC_KEY is not configured' });
  const payout = await Payout.findById(req.params.id).select('destinationEnc amountPaise userId').lean();
  if (!payout) return res.status(404).json({ error: 'Payout not found' });
  let detail;
  try { detail = JSON.parse(decrypt(payout.destinationEnc)); } catch (_) { return res.status(500).json({ error: 'Stored details could not be decrypted' }); }
  adminAlert({ type: 'payment', severity: 'info', title: 'Payout bank details viewed by admin', fingerprint: `payout-view-${req.params.id}`, throttleMs: 1000, email: false, details: { payoutId: String(req.params.id), byAdmin: req.user.email, amountRupees: Math.round(payout.amountPaise) / 100 } });
  res.set('Cache-Control', 'no-store');
  res.json({ method: detail.upi ? 'upi' : 'bank', holder: detail.holder, upi: detail.upi || '', account: detail.account || '', ifsc: detail.ifsc || '' });
});

// approve -> paid (needs reference), or reject (needs a note). Each step is an atomic status change.
router.put('/payouts/:id', async (req, res) => {
  if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const action = String(req.body?.action || '');
  const reference = String(req.body?.reference || '').trim().slice(0, 60);
  const note = String(req.body?.note || '').trim().slice(0, 300);
  const id = req.params.id, byAdmin = req.user.id;
  let update, from;
  if (action === 'approve') { from = ['requested']; update = { status: 'approved', processedBy: byAdmin, processedAt: new Date(), adminNote: note }; }
  else if (action === 'paid') {
    if (!/^[A-Za-z0-9\-_\/]{6,60}$/.test(reference)) return res.status(400).json({ error: 'Enter the bank/UPI reference (6–60 letters or numbers).' });
    from = ['requested', 'approved']; update = { status: 'paid', reference, processedBy: byAdmin, processedAt: new Date(), adminNote: note };
  }
  else if (action === 'reject') {
    if (note.length < 3) return res.status(400).json({ error: 'Add a reason for rejecting (shown to the creator).' });
    from = ['requested', 'approved']; update = { status: 'rejected', processedBy: byAdmin, processedAt: new Date(), adminNote: note };
  }
  else return res.status(400).json({ error: 'Invalid action' });

  const payout = await Payout.findOneAndUpdate({ _id: id, status: { $in: from } }, { $set: update }, { new: true }).lean();
  if (!payout) return res.status(409).json({ error: 'This payout was already processed or does not exist.' });
  const amount = Math.round(payout.amountPaise) / 100;
  const msg = action === 'paid' ? `✅ ₹${amount} has been sent to your ${payout.method === 'upi' ? 'UPI' : 'bank'} account. Reference: ${reference}`
    : action === 'approve' ? `⏳ Your payout of ₹${amount} is approved and will be sent shortly.`
    : `❌ Your payout of ₹${amount} was not approved. ${note}`;
  await notifyUser(payout.userId, 'payout', msg, '/creator.html', 'Payout update');
  adminAlert({ type: 'payment', severity: 'info', title: `Payout ${action === 'paid' ? 'paid' : action + 'd'}: ₹${amount}`, fingerprint: `payout-${id}-${action}`, throttleMs: 1000, email: false, details: { payoutId: String(id), byAdmin: req.user.email, reference: reference || '—', status: payout.status } });
  res.json({ success: true, status: payout.status });
});

// ---------- COUPONS (discounts for presets and Pro plans) ----------
function couponOut(c) {
  return { id: String(c._id), code: c.code, type: c.type, value: c.value, appliesTo: c.appliesTo, presetId: c.presetId ? String(c.presetId) : '', maxUses: c.maxUses, usedCount: c.usedCount, validFrom: c.validFrom, validUntil: c.validUntil, active: c.active, note: c.note || '', createdAt: c.createdAt };
}
// 'YYYY-MM-DD' -> start or end of that day in IST. Full timestamps are used as given.
function istDate(v, edge) {
  if (!v) return null;
  const str = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(`${str}T${edge === 'end' ? '23:59:59' : '00:00:00'}+05:30`);
  const d = new Date(str);
  if (isNaN(d)) throw Object.assign(new Error('Invalid date.'), { status: 400 });
  return d;
}
function couponInput(b, partial = false, currentType = '') {
  const out = {};
  if (!partial || b.code !== undefined) { const code = C.normaliseCode(b.code); if (!code) throw Object.assign(new Error('Code must be 3–32 letters, numbers, _ or -.'), { status: 400 }); out.code = code; }
  if (!partial || b.type !== undefined) { if (!['percent', 'fixed'].includes(b.type)) throw Object.assign(new Error('Type must be percent or fixed.'), { status: 400 }); out.type = b.type; }
  if (!partial || b.value !== undefined) {
    const v = Number(b.value);
    const effectiveType = out.type || currentType;
    if (!Number.isFinite(v) || v <= 0 || (effectiveType === 'percent' ? v > 100 : v > 100000)) throw Object.assign(new Error('Value must be above 0 (max 100 for percent).'), { status: 400 });
    out.value = v;
  }
  if (!partial || b.appliesTo !== undefined) { if (!C.KINDS.includes(b.appliesTo || 'all')) throw Object.assign(new Error('Applies to: preset, subscription, tip or all.'), { status: 400 }); out.appliesTo = b.appliesTo || 'all'; }
  if (b.presetId !== undefined) { if (b.presetId && !validObjectId(b.presetId)) throw Object.assign(new Error('Invalid preset ID.'), { status: 400 }); out.presetId = b.presetId || null; }
  if (b.maxUses !== undefined) { const m = Math.round(Number(b.maxUses)); if (!(m >= 0 && m <= 1000000)) throw Object.assign(new Error('Max uses must be 0 (unlimited) or more.'), { status: 400 }); out.maxUses = m; }
  // A date picked in the admin panel means that whole day in India time (IST), not midnight UTC.
  if (b.validFrom !== undefined) out.validFrom = istDate(b.validFrom, 'start');
  if (b.validUntil !== undefined) out.validUntil = istDate(b.validUntil, 'end');
  if (b.active !== undefined) out.active = b.active === true || b.active === 'true';
  if (b.note !== undefined) out.note = String(b.note || '').slice(0, 200);
  return out;
}
router.get('/coupons', async (req, res) => {
  const rows = await Coupon.find({}).sort({ createdAt: -1 }).limit(300).lean();
  res.json({ items: rows.map(couponOut) });
});
router.post('/coupons', async (req, res) => {
  try {
    const data = couponInput(req.body || {});
    const c = await Coupon.create(data);
    adminAlert({ type: 'payment', severity: 'info', title: `Coupon created: ${c.code}`, throttleMs: 1000, email: false, details: { by: req.user.email, type: c.type, value: c.value, appliesTo: c.appliesTo } });
    res.status(201).json(couponOut(c));
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'That code already exists.' });
    res.status(e.status || 400).json({ error: e.message || 'Could not create coupon' });
  }
});
router.put('/coupons/:id', async (req, res) => {
  if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  try {
    const existing = await Coupon.findById(req.params.id).select('type').lean();
    if (!existing) return res.status(404).json({ error: 'Coupon not found' });
    const data = couponInput(req.body || {}, true, existing.type);
    const c = await Coupon.findByIdAndUpdate(req.params.id, { $set: data }, { new: true }).lean();
    if (!c) return res.status(404).json({ error: 'Coupon not found' });
    res.json(couponOut(c));
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'That code already exists.' });
    res.status(e.status || 400).json({ error: e.message || 'Could not update coupon' });
  }
});
router.delete('/coupons/:id', async (req, res) => {
  if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  await Coupon.deleteOne({ _id: req.params.id });
  res.json({ success: true });
});

// ---------- GIFT PRO TO EVERYONE (confirmed, atomic, notifies all users) ----------
router.post('/subscriptions/grant-all', async (req, res) => {
  const days = Math.round(Number(req.body?.days));
  if (!(days >= 1 && days <= 365)) return res.status(400).json({ error: 'Days must be between 1 and 365.' });
  if (String(req.body?.confirm || '') !== 'GRANT ALL') return res.status(400).json({ error: 'Type GRANT ALL to confirm.' });
  const now = new Date();
  // Adds the days on top of each user's remaining Pro time (or from now). Done in one pipeline update.
  const r = await User.updateMany({ status: 'active' }, [{ $set: {
    'subscription.expiry': { $add: [ { $cond: [{ $gt: ['$subscription.expiry', now] }, '$subscription.expiry', now] }, days * 86400000 ] },
    'subscription.tier': 'pro',
    'subscription.plan': { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$subscription.plan', ''] } }, 0] }, '$subscription.plan', 'gift'] },
    'subscription.since': { $ifNull: ['$subscription.since', now] }
  } }]);
  const message = `🎁 PresetHub gifted you ${days} day(s) of Pro. Enjoy ad-free presets and shayari!`;
  await broadcast({ type: 'subscription', title: '🎁 Pro gift', message, link: '/', tick: '' });
  adminAlert({ type: 'subscription', severity: 'warning', title: `Pro gifted to all users: ${days} day(s)`, throttleMs: 1000, email: true, details: { by: req.user.email, usersUpdated: r.modifiedCount, days } });
  res.json({ success: true, usersUpdated: r.modifiedCount });
});

// ---------- BOOSTS (active promotions, admin can revoke) ----------
router.get('/boosts', async (req, res) => {
  const rows = await Boost.find({ endsAt: { $gt: new Date() }, revokedAt: null }).sort({ endsAt: 1 }).limit(200).populate('userId', 'name username').lean();
  res.json({ items: rows.map(b => ({ id: String(b._id), creator: b.userId?.name || b.userId?.username || '—', targetType: b.targetType, targetId: b.targetId, days: b.days, amount: b.amount, startsAt: b.startsAt, endsAt: b.endsAt })) });
});
router.post('/boosts/:id/revoke', async (req, res) => {
  if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const b = await Boost.findOneAndUpdate({ _id: req.params.id, revokedAt: null }, { $set: { revokedAt: new Date() } }).lean();
  if (!b) return res.status(404).json({ error: 'Boost not found or already revoked' });
  const model = { profile: User, preset: Preset, text: TextPost }[b.targetType];
  if (model) await model.updateOne({ _id: b.targetId }, { $set: { boostUntil: null } });
  adminAlert({ type: 'payment', severity: 'warning', title: `Boost revoked (${b.targetType})`, throttleMs: 1000, email: false, details: { by: req.user.email, boostId: String(b._id), target: b.targetId } });
  res.json({ success: true });
});

// ---------- REFUNDS (mark after the refund is done in the Cashfree dashboard) ----------
// Reverses what the order gave: preset access and creator earnings (earnings only count paid orders),
// Pro time granted by that order, tip totals and boosts. Money is NOT sent back by this endpoint.
router.post('/orders/:id/refund', async (req, res) => {
  if (!validObjectId(req.params.id) && !/^PH-[A-Z0-9-]{6,40}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid order ID' });
  const reference = String(req.body?.reference || '').trim().slice(0, 60);
  const reason = String(req.body?.reason || '').trim().slice(0, 300);
  if (!/^[A-Za-z0-9\-_\/]{4,60}$/.test(reference)) return res.status(400).json({ error: 'Enter the refund reference from Cashfree (4–60 letters or numbers).' });
  if (reason.length < 3) return res.status(400).json({ error: 'Enter a reason for the refund.' });
  const order = await Order.findOneAndUpdate(
    { _id: String(req.params.id), status: 'paid' },
    { $set: { status: 'refunded', failureReason: `Refunded: ${reason}`.slice(0, 300), refundReference: reference, refundedAt: new Date() } },
    { new: true }
  ).lean();
  if (!order) return res.status(409).json({ error: 'Order not found, or it is not in the paid state.' });

  const amount = Math.round(order.amount * 100) / 100;
  if (order.kind === 'preset' && order.presetId) await Preset.updateOne({ _id: order.presetId }, { $inc: { totalRevenue: -amount } });
  if (order.kind === 'tip' && order.recipientId) await User.updateOne({ _id: order.recipientId }, { $inc: { tipsTotal: -amount } });
  if (order.kind === 'subscription') {
    // Only revoke Pro if this order is the one that set the current expiry.
    const u = await User.findById(order.userId).select('subscription').lean();
    if (u?.subscription?.lastOrderId === String(order._id)) await User.updateOne({ _id: order.userId }, { $set: { 'subscription.expiry': null, 'subscription.tier': 'free', 'subscription.plan': '' } });
  }
  if (order.kind === 'boost') {
    const b = await Boost.findOneAndUpdate({ orderId: String(order._id), revokedAt: null }, { $set: { revokedAt: new Date() } }).lean();
    const model = { profile: User, preset: Preset, text: TextPost }[order.boostTargetType];
    if (b && model) await model.updateOne({ _id: order.boostTargetId }, { $set: { boostUntil: null } });
  }
  await notifyUser(order.userId, 'refund', `↩️ Your payment of ₹${amount} was refunded. Reference: ${reference}.`, '/', 'Refund processed');
  adminAlert({ type: 'payment', severity: 'warning', title: `Order refunded: ₹${amount} (${order.kind})`, throttleMs: 1000, email: false, details: { orderId: String(order._id), by: req.user.email, reference, reason } });
  res.json({ success: true, status: 'refunded', orderId: String(order._id) });
});

// ---------- PAYOUT CSV EXPORT (for the accountant; no bank details) ----------
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Protect against spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
router.get('/payouts/export.csv', async (req, res) => {
  const f = {};
  if (['requested', 'approved', 'paid', 'rejected'].includes(String(req.query.status))) f.status = req.query.status;
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  if (from && !isNaN(from)) f.createdAt = { ...(f.createdAt || {}), $gte: from };
  if (to && !isNaN(to)) f.createdAt = { ...(f.createdAt || {}), $lte: new Date(to.getTime() + 86400000) };
  const rows = await Payout.find(f).sort({ createdAt: 1 }).limit(20000).populate('userId', 'name username email').lean();
  const head = ['payout_id', 'requested_at', 'processed_at', 'creator', 'creator_email', 'amount_inr', 'method', 'destination_masked', 'status', 'reference', 'note'];
  const lines = [head.join(',')].concat(rows.map(x => [
    String(x._id), x.createdAt?.toISOString(), x.processedAt?.toISOString() || '', x.userId?.name || x.userId?.username || '', x.userId?.email || '',
    (Math.round(x.amountPaise) / 100).toFixed(2), x.method, x.destinationMasked, x.status, x.reference || '', x.adminNote || ''
  ].map(csvCell).join(',')));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="payouts-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.set('Cache-Control', 'no-store');
  res.send('\uFEFF' + lines.join('\r\n'));
  adminAlert({ type: 'payment', severity: 'info', title: 'Payout CSV exported', throttleMs: 1000, email: false, details: { by: req.user.email, rows: rows.length } });
});

module.exports = router;