/**
 * User collections (playlists of presets). Private by default; public collections get a shareable page.
 *   GET    /api/collections/mine                 my collections (auth)
 *   POST   /api/collections                      create (auth)
 *   PUT    /api/collections/:id                  rename / description / visibility (owner)
 *   DELETE /api/collections/:id                  delete (owner)
 *   POST   /api/collections/:id/presets/:presetId  add or remove a preset (owner, toggles)
 *   GET    /api/collections/public/:id           public collection with its presets
 */
const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { Collection, Preset } = require('../models');
const { presetOut } = require('./features');

const router = express.Router();
const isId = v => mongoose.Types.ObjectId.isValid(v);
const MAX_COLLECTIONS = 50;
const MAX_PRESETS = 200;

function colOut(c, presetsById) {
  return {
    id: String(c._id), name: c.name, description: c.description || '', isPublic: !!c.isPublic,
    count: (c.presetIds || []).length, updatedAt: c.updatedAt,
    presets: presetsById ? (c.presetIds || []).map(id => presetsById.get(String(id))).filter(Boolean) : undefined
  };
}

router.get('/mine', auth, async (req, res) => {
  const rows = await Collection.find({ userId: req.user.id }).sort({ updatedAt: -1 }).lean();
  res.json({ items: rows.map(c => colOut(c)) });
});

router.post('/', auth, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Name must be 2 to 60 characters.' });
  const count = await Collection.countDocuments({ userId: req.user.id });
  if (count >= MAX_COLLECTIONS) return res.status(400).json({ error: `You can create up to ${MAX_COLLECTIONS} collections.` });
  const c = await Collection.create({
    userId: req.user.id, name, description: String(req.body?.description || '').slice(0, 300), isPublic: req.body?.isPublic === true
  });
  res.status(201).json(colOut(c));
});

async function ownCollection(req, res) {
  if (!isId(req.params.id)) { res.status(400).json({ error: 'Invalid ID' }); return null; }
  const c = await Collection.findById(req.params.id);
  if (!c) { res.status(404).json({ error: 'Collection not found' }); return null; }
  if (String(c.userId) !== req.user.id && req.user.role !== 'admin') { res.status(403).json({ error: 'Unauthorized' }); return null; }
  return c;
}

router.put('/:id', auth, async (req, res) => {
  const c = await ownCollection(req, res); if (!c) return;
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Name must be 2 to 60 characters.' });
    c.name = name;
  }
  if (req.body?.description !== undefined) c.description = String(req.body.description).slice(0, 300);
  if (req.body?.isPublic !== undefined) c.isPublic = req.body.isPublic === true;
  await c.save();
  res.json(colOut(c));
});

router.delete('/:id', auth, async (req, res) => {
  const c = await ownCollection(req, res); if (!c) return;
  await c.deleteOne();
  res.json({ success: true });
});

// Toggle: adds the preset if missing, removes it if already there.
router.post('/:id/presets/:presetId', auth, async (req, res) => {
  const c = await ownCollection(req, res); if (!c) return;
  if (!isId(req.params.presetId)) return res.status(400).json({ error: 'Invalid preset ID' });
  const pid = String(req.params.presetId);
  const exists = (c.presetIds || []).some(x => String(x) === pid);
  if (exists) {
    c.presetIds = c.presetIds.filter(x => String(x) !== pid);
  } else {
    if (!(await Preset.exists({ _id: pid, status: 'approved' }))) return res.status(404).json({ error: 'Preset not found' });
    if (c.presetIds.length >= MAX_PRESETS) return res.status(400).json({ error: `A collection can hold up to ${MAX_PRESETS} presets.` });
    c.presetIds.push(pid);
  }
  await c.save();
  res.json({ added: !exists, count: c.presetIds.length });
});

router.get('/public/:id', async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const c = await Collection.findOne({ _id: req.params.id, isPublic: true }).lean();
  if (!c) return res.status(404).json({ error: 'Collection not found or private' });
  const presets = await Preset.find({ _id: { $in: c.presetIds || [] }, status: 'approved' }).lean();
  const map = new Map(presets.map(p => [String(p._id), presetOut(p)]));
  res.set('Cache-Control', 'public, max-age=120');
  res.json(colOut(c, map));
});

module.exports = router;
