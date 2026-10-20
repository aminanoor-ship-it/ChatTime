const multer = require('multer');
const { getSettings } = require('../services/settings');
const { HttpError } = require('../utils/http');

// Accepts one file in memory, capped at the admin-configured size (or a fixed cap for avatars).
function singleFile({ fixedLimitMb } = {}) {
  return async (req, res, next) => {
    try {
      const limitMb = fixedLimitMb || (await getSettings()).max_upload_mb;
      multer({ storage: multer.memoryStorage(), limits: { fileSize: limitMb * 1024 * 1024, files: 1 } })
        .single('file')(req, res, (error) => {
          if (error?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `Files can be up to ${limitMb} MB.`));
          if (error) return next(new HttpError(400, 'The upload could not be read.'));
          if (!req.file) return next(new HttpError(400, 'Choose a file to upload.'));
          next();
        });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { singleFile };
