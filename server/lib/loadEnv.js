const path = require('path');
const dotenv = require('dotenv');

function loadEnv() {
  const rootEnv = path.join(__dirname, '..', '..', '.env');
  const serverEnv = path.join(__dirname, '..', '.env');

  dotenv.config({ path: rootEnv });
  dotenv.config({ path: serverEnv });
}

module.exports = { loadEnv };
