const express        = require('express');
const { NVIDIA_KEY } = require('../config/env');
const { MONGO_URI }  = require('../config/env');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    status:        'ok',
    ts:            new Date().toISOString(),
    nvidia_key_set: !!NVIDIA_KEY,
    mongo_uri_set:  !!MONGO_URI,
  });
});

module.exports = router;
