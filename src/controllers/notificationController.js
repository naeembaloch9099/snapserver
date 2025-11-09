const Notification = require("../models/Notification");

const listNotifications = async (req, res) => {
  try {
    const { page = 0, limit = 50, unreadOnly = false } = req.query;
    const skip = Math.max(0, parseInt(page)) * parseInt(limit);

    // ✅ FIX: Support filtering by read status
    const query = { user: req.user._id };
    if (unreadOnly === "true" || unreadOnly === true) {
      query.read = false;
    }

    // First, fetch WITHOUT populate to see raw data
    const rawNotifs = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    console.log(`[listNotifications] RAW (before populate):`, {
      query,
      count: rawNotifs.length,
    });
    rawNotifs.forEach((n, i) => {
      console.log(
        `  [${i}] actor field (raw): ${n.actor}, user field (raw): ${n.user}, read: ${n.read}`
      );
    });

    // Now fetch WITH populate
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      // include profilePic (canonical) and avatar (legacy) so frontend can use either
      .populate("actor", "username displayName avatar profilePic")
      .lean();

    // DEBUG: Log what's being returned
    console.log(
      `[listNotifications] AFTER POPULATE - Fetching ${limit} notifications for user ${req.user._id}`,
      { unreadOnly, totalReturned: notifications.length }
    );
    notifications.forEach((n, i) => {
      console.log(
        `  [${i}] Type: ${n.type}, Read: ${n.read}, User (recipient): ${
          n.user
        }, Actor (liker/commenter): ${
          n.actor ? n.actor.username || n.actor._id : "null"
        }`
      );
    });

    res.json(notifications);
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

const markRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, read: false },
      { $set: { read: true } }
    );
    res.json({ ok: true });
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(
      `🗑️ [DELETE NOTIFICATION] Notification ID: ${id}, User: ${req.user._id}`
    );

    // Find and delete the notification (only if it belongs to current user)
    const notification = await Notification.findOneAndDelete({
      _id: id,
      user: req.user._id,
    });

    if (!notification) {
      console.warn(`⚠️ [DELETE NOTIFICATION] Not found or not authorized`);
      return res.status(404).json({ error: "Notification not found" });
    }

    console.log(`✅ [DELETE NOTIFICATION] Successfully deleted: ${id}`);
    res.json({ ok: true });
  } catch (e) {
    console.error(`❌ [DELETE NOTIFICATION ERROR]`, e);
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = { listNotifications, markRead, deleteNotification };
