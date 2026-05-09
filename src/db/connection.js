const { MongoClient } = require('mongodb');
const { MONGO_URI, MONGO_DB } = require('../config/env');

let _db = null;

async function getDb() {
  if (_db) return _db;
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  _db = client.db(MONGO_DB);
  console.log('✅ MongoDB connected');
  return _db;
}

module.exports = { getDb };
