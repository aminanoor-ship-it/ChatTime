const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { handle, requireId } = require('../utils/http');
const messages = require('../services/messages');

const router = express.Router();
router.use(requireAuth);

router.patch('/:id', handle(async (req, res) => {
  res.json({ message: await messages.editMessage(requireId(req.params.id, 'message'), req.user.id, req.body.body) });
}));

router.delete('/:id', handle(async (req, res) => {
  res.json({ message: await messages.deleteMessage(requireId(req.params.id, 'message'), req.user.id) });
}));

router.post('/:id/reactions', handle(async (req, res) => {
  res.json(await messages.setReaction(requireId(req.params.id, 'message'), req.user, req.body.emoji, true));
}));

router.delete('/:id/reactions/:emoji', handle(async (req, res) => {
  res.json(await messages.setReaction(requireId(req.params.id, 'message'), req.user, req.params.emoji, false));
}));

module.exports = router;
