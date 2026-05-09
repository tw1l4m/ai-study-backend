require('dotenv').config();

module.exports = {
  MONGO_URI:   process.env.MONGO_URI   || '',
  NVIDIA_KEY:  process.env.NVIDIA_KEY  || '',
  ADMIN_PASS:  process.env.ADMIN_PASS  || 'admin2024',
  MONGO_DB:    process.env.MONGO_DB    || 'ai_study',
  PORT:        process.env.PORT        || 3000,
};
