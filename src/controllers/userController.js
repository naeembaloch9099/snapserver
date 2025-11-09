const User = require("../models/User");
const Notification = require("../models/Notification");
const { emitToUser } = require("../sockets/notifier");

const getProfile = async (req, res) => {
  // ... (no changes in this function)
  try {
    // find by id; frontend may sometimes pass username - try both
    let user = null;
    const idOrUsername = req.params.id;
    if (/^[0-9a-fA-F]{24}$/.test(String(idOrUsername))) {
      user = await User.findById(idOrUsername)
        .select("-passwordHash -refreshTokens")
        .populate("followers", "username profilePic name _id")
        .populate("following", "username profilePic name _id")
        .populate("followRequests.user", "username profilePic name _id")
        .lean();
    }
    if (!user) {
      user = await User.findOne({ username: idOrUsername })
        .select("-passwordHash -refreshTokens")
        .populate("followers", "username profilePic name _id")
        .populate("following", "username profilePic name _id")
        .populate("followRequests.user", "username profilePic name _id")
        .lean();
    }
    if (!user) return res.status(404).json({ error: "Not found" });
    user.followersCount = (user.followers || []).length;
    user.followingCount = (user.following || []).length;

    console.log(
      `👤 [GET PROFILE] ${user.username}: followersCount=${user.followersCount}, followingCount=${user.followingCount}`
    ); // Determine whether the currently authenticated viewer can see posts

    const viewerId = req.user && req.user._id ? String(req.user._id) : null;
    const ownerId = String(user._id);
    const isOwner = viewerId && viewerId === ownerId;
    const isFollower =
      viewerId &&
      Array.isArray(user.followers) &&
      user.followers.some((f) => {
        // f could be ObjectId, string, or object with _id
        const followerId = String(f._id || f);
        return followerId === viewerId;
      });

    user.canViewPosts = !user.isPrivate || isOwner || Boolean(isFollower);

    console.log(
      `[getProfile] ${user.username}: isPrivate=${user.isPrivate}, isOwner=${isOwner}, isFollower=${isFollower}, canViewPosts=${user.canViewPosts}`
    ); // Owner can always see their followers/following lists // Others can only see if they're following or if account is public

    const canSeeFollowersList = isOwner || !user.isPrivate || isFollower;

    if (!canSeeFollowersList) {
      // hide followers/following lists if viewer doesn't have access
      user.followers = [];
      user.following = [];
    } // hide sensitive data if viewer is not allowed to see posts

    if (!user.canViewPosts && !isOwner) {
      // keep counts and public metadata, but remove email and other private fields
      delete user.email;
      delete user.refreshTokens; // do not include lists of posts on this response; frontend should check canViewPosts
    }

    res.json(user);
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

const searchUsers = async (req, res) => {
  // ... (no changes in this function)
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ results: [] }); // simple prefix search on username (case-insensitive)
    const regex = new RegExp(
      `^${q.replace(/[-\\/\\^$*+?.()|[\]{}]/g, "\\$&")}`,
      "i"
    ); // limit results to 20
    const users = await User.find({ username: { $regex: regex } })
      .select("username name profilePic isPrivate followers followRequests")
      .limit(20)
      .lean();

    const viewerId = req.user && req.user._id ? String(req.user._id) : null;
    const enriched = users.map((u) => {
      const followers = Array.isArray(u.followers)
        ? u.followers.map(String)
        : [];
      const requests = Array.isArray(u.followRequests)
        ? u.followRequests.map((r) => String(r.user || r))
        : [];
      return {
        _id: u._id,
        username: u.username,
        name: u.name,
        profilePic: u.profilePic,
        avatar: u.profilePic, // for compatibility with frontend
        isPrivate: Boolean(u.isPrivate),
        isFollowing: viewerId ? followers.includes(viewerId) : false,
        requested: viewerId ? requests.includes(viewerId) : false,
      };
    });

    res.json({ results: enriched });
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

const followToggle = async (req, res) => {
  // ... (no changes in this function)
  try {
    // require authenticated requester
    if (!req.user || !req.user._id) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    let target = await User.findById(req.params.id);
    if (!target) {
      // maybe frontend passed a username instead of id
      target = await User.findOne({ username: req.params.id });
    }
    if (!target) return res.status(404).json({ error: "Not found" });
    const me = await User.findById(req.user._id);
    if (!me) return res.status(401).json({ error: "Not authenticated" });

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`👤 [FOLLOW TOGGLE]`);
    console.log(`📌 From: ${me.username} (${me._id})`);
    console.log(`📌 To: ${target.username} (${target._id})`);
    console.log(`📌 Target is Private: ${target.isPrivate}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"); // ensure arrays exist to avoid null dereference

    me.following = Array.isArray(me.following) ? me.following : [];
    target.followers = Array.isArray(target.followers) ? target.followers : [];
    target.followRequests = Array.isArray(target.followRequests)
      ? target.followRequests
      : [];

    const alreadyFollowing = me.following.some(
      (f) => String(f) === String(target._id)
    );

    console.log(`📊 [FOLLOW TOGGLE] Already Following: ${alreadyFollowing}`); // If target is private and requester is not already a follower

    if (target.isPrivate && !alreadyFollowing) {
      console.log(
        `🔒 [FOLLOW TOGGLE] Private account - creating follow request`
      ); // check if there's an existing follow request from me

      const existing = (target.followRequests || []).some(
        (r) => String(r.user) === String(me._id)
      );

      if (existing) {
        console.log(`❌ [FOLLOW TOGGLE] Canceling existing follow request`); // cancel request
        target.followRequests = (target.followRequests || []).filter(
          (r) => String(r.user) !== String(me._id)
        );
        await target.save();
        return res.json({ ok: true, pending: false, requested: false });
      } // create a follow request instead of immediate follow

      console.log(
        `📤 [FOLLOW TOGGLE] Creating new follow request notification`
      );
      target.followRequests = target.followRequests || [];
      target.followRequests.push({ user: me._id });
      await target.save();

      const notification = await Notification.create({
        user: target._id,
        type: "follow_request",
        actor: me._id,
      });
      console.log(
        `✅ [FOLLOW TOGGLE] Request created. Notification ID:`,
        notification._id
      );
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      return res.json({ ok: true, pending: true, requested: true });
    }

    console.log(`🔓 [FOLLOW TOGGLE] Public account - direct follow`); // Public account or already approved: toggle follow immediately

    const already = alreadyFollowing;
    if (already) {
      console.log(`🔄 [FOLLOW TOGGLE] Unfollowing...`);
      me.following = me.following.filter(
        (f) => String(f) !== String(target._id)
      );
      target.followers = target.followers.filter(
        (f) => String(f) !== String(me._id)
      );
    } else {
      console.log(`🔄 [FOLLOW TOGGLE] Following...`);
      me.following.push(target._id);
      target.followers.push(me._id);

      const notification = await Notification.create({
        user: target._id,
        type: "follow",
        actor: me._id,
      });
      console.log(
        `📤 [FOLLOW TOGGLE] Follow notification sent. ID:`,
        notification._id
      );
    }

    await me.save();
    await target.save();

    console.log(`✅ [FOLLOW TOGGLE] Complete. New Following: ${!already}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    res.json({ ok: true, following: !already });
  } catch (e) {
    console.error("❌ [FOLLOW TOGGLE ERROR]", e);
    res.status(500).json({ error: "Server error" });
  }
};

const acceptFollowRequest = async (req, res) => {
  try {
    const ownerId = req.params.id; // The owner of the private account
    const requesterId = req.params.requesterId; // The user who sent the request
    const currentUserId = req.user._id;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`✅ [ACCEPT FOLLOW REQUEST]`);
    console.log(`📌 Owner ID: ${ownerId}`);
    console.log(`📌 Requester ID: ${requesterId}`);
    console.log(`📌 Current User ID: ${currentUserId}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"); // Verify current user is the owner

    if (String(currentUserId) !== String(ownerId)) {
      console.error(
        `❌ [ACCEPT] Not authorized. Current=${currentUserId}, Owner=${ownerId}`
      );
      return res.status(403).json({ error: "Not authorized" });
    }

    const owner = await User.findById(ownerId);
    const requester = await User.findById(requesterId);

    if (!owner || !requester) {
      console.error(`❌ [ACCEPT] Owner or Requester not found`);
      return res.status(404).json({ error: "User not found" });
    } // Check if request exists

    const exists = (owner.followRequests || []).some(
      (r) => String(r.user) === String(requesterId)
    );

    if (!exists) {
      console.warn(`⚠️ [ACCEPT] No such request found for ${requesterId}`); // This can happen if user double-clicks. // We can still proceed to send the notification, but log it. // The main goal is to ensure the follow relationship exists.
    }

    console.log(`🔄 [ACCEPT] Removing request from followRequests...`);
    owner.followRequests = (owner.followRequests || []).filter(
      (r) => String(r.user) !== String(requesterId)
    ); // add requester to owner's followers

    owner.followers = owner.followers || [];
    if (!owner.followers.some((f) => String(f) === String(requesterId))) {
      console.log(`🔄 [ACCEPT] Adding ${requesterId} to followers...`);
      owner.followers.push(requesterId);
    } else {
      console.log(`⚠️ [ACCEPT] ${requesterId} already in followers`);
    } // add owner to requester's following

    requester.following = requester.following || [];
    if (!requester.following.some((f) => String(f) === String(ownerId))) {
      console.log(`🔄 [ACCEPT] Adding ${ownerId} to requester's following...`);
      requester.following.push(ownerId);
    } else {
      console.log(`⚠️ [ACCEPT] ${ownerId} already in requester's following`);
    }

    await owner.save();
    await requester.save(); // --- ✅ START FIX: Delete the original notification ---

    try {
      await Notification.findOneAndDelete({
        user: ownerId, // The user who received the notification
        type: "follow_request",
        actor: requesterId, // The user who sent it
      });
      console.log(`[ACCEPT] Deleted original follow_request notification.`);
    } catch (err) {
      console.warn("Could not delete follow_request notification", err);
    } // --- ✅ END FIX --- // Send followback notification to requester
    console.log(
      `📤 [ACCEPT] Creating follow_accepted notification for ${requesterId}...`
    );
    const notification = await Notification.create({
      user: requesterId,
      type: "follow_accepted",
      actor: ownerId,
    });

    console.log(`✅ [ACCEPT] Notification created:`, notification._id); // Emit socket notification to requester

    console.log(`📡 [ACCEPT] Emitting notification to requester via socket...`);
    emitToUser(requesterId, "notification", {
      type: "follow_accepted",
      actor: {
        _id: owner._id,
        username: owner.username,
        profilePic: owner.profilePic,
      },
      message: `${owner.username} accepted your follow request`,
    });

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    res.json({ ok: true, notification });
  } catch (e) {
    console.error("❌ [ACCEPT ERROR]", e);
    res.status(500).json({ error: "Server error" });
  }
};

const rejectFollowRequest = async (req, res) => {
  try {
    const ownerId = req.params.id; // The owner of the private account
    const requesterId = req.params.requesterId; // The user who sent the request
    const currentUserId = req.user._id;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`✅ [REJECT FOLLOW REQUEST]`);
    console.log(`📌 Owner ID: ${ownerId}`);
    console.log(`📌 Requester ID: ${requesterId}`);
    console.log(`📌 Current User ID: ${currentUserId}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"); // Verify current user is the owner

    if (String(currentUserId) !== String(ownerId)) {
      console.error(
        `❌ [REJECT] Not authorized. Current=${currentUserId}, Owner=${ownerId}`
      );
      return res.status(403).json({ error: "Not authorized" });
    }

    const owner = await User.findById(ownerId);
    if (!owner) {
      console.error(`❌ [REJECT] Owner not found`);
      return res.status(404).json({ error: "User not found" });
    }

    console.log(`🔄 [REJECT] Removing request from followRequests...`);
    owner.followRequests = (owner.followRequests || []).filter(
      (r) => String(r.user) !== String(requesterId)
    );
    await owner.save(); // --- ✅ START FIX: Delete the original notification ---

    try {
      await Notification.findOneAndDelete({
        user: ownerId,
        type: "follow_request",
        actor: requesterId,
      });
      console.log(`[REJECT] Deleted original follow_request notification.`);
    } catch (err) {
      console.warn("Could not delete follow_request notification", err);
    } // --- ✅ END FIX ---
    console.log(
      `📤 [REJECT] Creating follow_rejected notification for ${requesterId}...`
    ); // We create this just so the requester knows, but we don't await it.
    Notification.create({
      user: requesterId,
      type: "follow_rejected",
      actor: ownerId,
    }).catch(console.warn);

    console.log(`✅ [REJECT] Request rejected successfully`);

    res.json({ ok: true });
  } catch (e) {
    console.error(`❌ [REJECT ERROR]`, e.message);
    res.status(500).json({ error: "Server error" });
  }
};

const updateProfile = async (req, res) => {
  // ... (no changes in this function)
  try {
    if (!req.user || !req.user._id)
      return res.status(401).json({ error: "Not authenticated" });
    const uid = req.user._id;
    const { name, username, bio, profilePic, isPrivate } = req.body;

    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ error: "User not found" }); // If username is changing, ensure it's valid and not taken

    if (username && String(username).trim() && username !== user.username) {
      const clean = String(username).trim(); // basic allowed chars: letters, numbers, underscore, dot
      if (!/^[a-zA-Z0-9._]+$/.test(clean)) {
        return res.status(400).json({ error: "Invalid username" });
      }
      const exists = await User.findOne({ username: clean });
      if (exists && String(exists._id) !== String(user._id)) {
        return res.status(400).json({ error: "Username already taken" });
      }
      user.username = clean;
    }

    if (typeof name === "string") user.name = name.trim();
    if (typeof bio === "string") user.bio = bio.trim();
    if (typeof profilePic === "string") user.profilePic = profilePic;
    if (typeof isPrivate === "boolean") user.isPrivate = isPrivate;

    await user.save();

    const safe = {
      id: user._id,
      username: user.username,
      name: user.name,
      profilePic: user.profilePic,
      bio: user.bio,
      isPrivate: user.isPrivate,
    };
    return res.json({ ok: true, user: safe });
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

const removeFollower = async (req, res) => {
  // ... (no changes in this function)
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const owner = await User.findById(req.user._id);
    const followerId = req.params.followerId;

    if (!owner) {
      return res.status(404).json({ error: "Owner not found" });
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`🗑️ [REMOVE FOLLOWER]`);
    console.log(`📌 Owner: ${owner.username} (${owner._id})`);
    console.log(`📌 Follower to Remove: ${followerId}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"); // Remove follower from owner's followers list

    owner.followers = Array.isArray(owner.followers) ? owner.followers : [];
    const followerUser = await User.findById(followerId);

    if (!followerUser) {
      return res.status(404).json({ error: "Follower not found" });
    } // Remove from owner's followers list

    const initialLength = owner.followers.length;
    owner.followers = owner.followers.filter(
      (f) => String(f) !== String(followerId)
    );

    const removed = initialLength !== owner.followers.length;
    console.log(`📊 [REMOVE FOLLOWER] Removed: ${removed}`); // Also remove owner from follower's following list

    followerUser.following = Array.isArray(followerUser.following)
      ? followerUser.following
      : [];
    const initialFollowingLength = followerUser.following.length;
    followerUser.following = followerUser.following.filter(
      (f) => String(f) !== String(owner._id)
    );

    const followingRemoved =
      initialFollowingLength !== followerUser.following.length;
    console.log(
      `📊 [REMOVE FOLLOWER] Follower's following list updated: ${followingRemoved}`
    );

    await owner.save();
    await followerUser.save();

    console.log(`✅ [REMOVE FOLLOWER] Complete`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    res.json({ ok: true, removed: removed || followingRemoved });
  } catch (e) {
    console.error("❌ [REMOVE FOLLOWER ERROR]", e);
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = {
  getProfile,
  searchUsers,
  followToggle,
  acceptFollowRequest,
  rejectFollowRequest,
  updateProfile,
  removeFollower,
};
