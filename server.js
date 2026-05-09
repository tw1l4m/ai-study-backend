const app        = require('./src/app');
const { PORT, NVIDIA_KEY } = require('./src/config/env');

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} | NVIDIA: ${!!NVIDIA_KEY}`);
});
