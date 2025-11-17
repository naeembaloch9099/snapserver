const cloudinary = require("cloudinary").v2;
const fs = require("fs");

// Cloudinary is configured via CLOUDINARY_URL env var, e.g.
// CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
if (process.env.CLOUDINARY_URL) {
  try {
    cloudinary.config();
    console.log("Cloudinary configured from CLOUDINARY_URL");
  } catch (e) {
    console.warn("Cloudinary config failed:", e?.message || e);
  }
} else {
  console.warn("CLOUDINARY_URL not set — Cloudinary uploads disabled");
}

const uploadFile = (localFilePath, options = {}) => {
  return new Promise((resolve, reject) => {
    if (!process.env.CLOUDINARY_URL) {
      return reject(new Error("CLOUDINARY_URL not configured"));
    }

    // use resource_type auto so both images and videos are handled
    cloudinary.uploader.upload(
      localFilePath,
      { resource_type: "auto", ...options },
      (err, result) => {
        // remove local file after upload attempt
        fs.unlink(localFilePath, (unlinkErr) => {
          if (unlinkErr) console.warn("Failed to unlink temp file", unlinkErr);
        });
        if (err) return reject(err);
        resolve(result);
      }
    );
  });
};

module.exports = { uploadFile, cloudinary };
