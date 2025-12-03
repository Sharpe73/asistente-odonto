const crypto = require("crypto");

exports.generarSessionId = () => {
  return crypto.randomUUID();
};
