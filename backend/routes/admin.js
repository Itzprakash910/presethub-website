const express = require('express');
const mongoose = require('mongoose');

const auth = require('../middleware/auth');

const {
  User, Preset, Order, Download, Share, ShortLink, ShareClick, Comment, Message, HomeAd
} = require('../models');
const { deleteFromMongo } = require('../config/mongoStorage');
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
    active: body.active === undefined ? (existing.active ?? true) : Boolean(body.active),
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

router.post('/ads', async (req, res) => {
  try {
    const payload = adPayload(req.body || {});
    const ad = await HomeAd.create({ ...payload, createdBy: req.user.id });
    res.status(201).json({ success: true, ad: { ...ad.toObject(), id: ad._id.toString() } });
  } catch (err) {
    console.error('Create ad error:', err);
    res.status(400).json({ error: err.message || 'Failed to create ad' });
  }
});

router.put('/ads/:id', async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ad ID' });
    const ad = await HomeAd.findById(req.params.id);
    if (!ad) return res.status(404).json({ error: 'Ad not found' });
    Object.assign(ad, adPayload(req.body || {}, ad.toObject()));
    await ad.save();
    res.json({ success: true, ad: { ...ad.toObject(), id: ad._id.toString() } });
  } catch (err) {
    console.error('Update ad error:', err);
    res.status(400).json({ error: err.message || 'Failed to update ad' });
  }
});

router.delete('/ads/:id', async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ad ID' });
    const result = await HomeAd.deleteOne({ _id: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ error: 'Ad not found' });
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


module.exports = router;