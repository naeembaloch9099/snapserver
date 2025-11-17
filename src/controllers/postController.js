const Post = require("../models/Post");
const Comment = require("../models/Comment");
const Notification = require("../models/Notification");
const User = require("../models/User");
const emitter = require("../events/eventEmitter");
const mongoose = require("mongoose");

const createPost = async (req, res) => {
  try {
    const { caption, media, type } = req.body; // media: data url or remote url
    const uploadedFile = req.file;

    // map incoming `media` to the correct field expected by the Post model
    const payload = { owner: req.user._id, caption, type };

    // If a file was uploaded, try uploading to Cloudinary
    if (uploadedFile) {
      try {
        const { uploadFile } = require("../services/cloudinary");
        const path = require("path");
        const localPath = path.join(
          __dirname,
          "..",
          "..",
          "uploads",
          uploadedFile.filename
        );
        const uploadResult = await uploadFile(localPath, {
          folder: "snapgram/posts",
        });
        const url = uploadResult.secure_url || uploadResult.url;
        if (uploadResult.resource_type === "video") {
          payload.video = url;
          payload.type = "video";
        } else {
          payload.image = url;
          payload.type = payload.type || "image";
        }
      } catch (e) {
        console.warn(
          "Cloudinary post upload failed, falling back to body media or local file",
          e?.message || e
        );
        // fallback to body media or local file URL
        if (media) {
          if (type === "video") payload.video = media;
          else payload.image = media;
        } else {
          const host = `${req.protocol}://${req.get("host")}`;
          if (uploadedFile) {
            const localUrl = `${host}/uploads/${uploadedFile.filename}`;
            if (uploadedFile.mimetype.startsWith("video"))
              payload.video = localUrl;
            else payload.image = localUrl;
          }
        }
      }
    } else {
      if (type === "video") payload.video = media;
      else payload.image = media;
    }
    const post = new Post(payload);
    await post.save();
    res.status(201).json(post);
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

const getFeed = async (req, res) => {
  try {
    console.log(
      "📥 [getFeed] Request received from:",
      req.user?.username || "unauthenticated"
    );

    const { page = 0, limit = 20 } = req.query;
    const skip = Math.max(0, parseInt(page)) * parseInt(limit);

    console.log(
      `📥 [getFeed] Fetching posts: page=${page}, limit=${limit}, skip=${skip}`
    );

    // Populate owner including privacy/followers so we can filter private accounts
    // Use server-side Redis cache to avoid hitting MongoDB on every request for
    // the public feed. Cache key is based on page & limit.
    const { getCached } = require("../cache");
    const cacheKey = `posts:feed:page:${page}:limit:${limit}`;

    const postsRaw = await getCached(
      cacheKey,
      async () => {
        const rows = await Post.find()
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .populate(
            "owner",
            "username displayName avatar profilePic isPrivate followers"
          )
          .populate({
            path: "comments",
            populate: {
              path: "user",
              select: "username displayName avatar profilePic",
            },
          })
          .lean()
          .exec();
        return rows;
      },
      60 * 5 // cache for 5 minutes
    );

    console.log(`📥 [getFeed] Found ${postsRaw.length} posts from database`);
    console.log("[getFeed] Post with populated comments:", {
      postId: postsRaw[0]?._id,
      firstComment: postsRaw[0]?.comments?.[0],
      firstCommentReplyTo: postsRaw[0]?.comments?.[0]?.replyTo,
      allComments: postsRaw[0]?.comments?.map((c) => ({
        id: c._id,
        text: c.text,
        replyTo: c.replyTo,
      })),
    });

    // If viewer is authenticated, use their id for private checks
    const viewerId = req.user && req.user._id ? String(req.user._id) : null;

    // Show all posts in feed regardless of privacy settings
    // Privacy is enforced at the profile level, not the feed level
    const posts = postsRaw;

    // Alternative: If you want to respect privacy in feed, uncomment below
    /*
    const posts = postsRaw.filter((p) => {
      const owner = p.owner || {};
      if (!owner.isPrivate) return true;
      // owner is private: allow if viewer is owner or a follower
      const ownerId = String(owner._id || owner);
      if (viewerId && viewerId === ownerId) return true;
      if (
        viewerId &&
        Array.isArray(owner.followers) &&
        owner.followers.some((f) => {
          // f could be ObjectId, string, or object with _id
          const followerId = String(f._id || f);
          return followerId === viewerId;
        })
      )
        return true;
      return false;
    });
    */

    console.log(
      `✅ [getFeed] Returning ${posts.length} posts after privacy filter`
    );
    res.json(posts);
  } catch (e) {
    console.error("❌ [getFeed] Error:", e);
    res.status(500).json({ error: "Server error" });
  }
};

const toggleLike = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Not found" });

    // DEBUG: Log who is liking the post
    console.log(
      `[toggleLike] Post owner: ${post.owner}, Current user (liker): ${req.user._id}`
    );

    const already = post.likedBy.some(
      (u) => String(u) === String(req.user._id)
    );
    if (already) {
      post.likedBy = post.likedBy.filter(
        (u) => String(u) !== String(req.user._id)
      );
      post.likes = Math.max(0, (post.likes || 1) - 1);
    } else {
      post.likedBy.push(req.user._id);
      post.likes = (post.likes || 0) + 1;

      // Create notification: user (post owner) receives notification about actor (the liker)
      console.log(`[toggleLike] Creating notification with:`);
      console.log(`  - user (recipient): ${post.owner}`);
      console.log(`  - actor (liker): ${req.user._id}`);
      console.log(`  - req.user._id type: ${typeof req.user._id}`);
      console.log(`  - req.user._id value: ${JSON.stringify(req.user._id)}`);

      const notif = await Notification.create({
        user: post.owner, // Who receives the notification (post owner)
        type: "like",
        actor: req.user._id, // Who did the action (the liker)
        post: post._id,
      });

      // Fetch back from DB to verify what was stored
      const saved = await Notification.findById(notif._id);
      console.log(`[toggleLike] Notification SAVED to DB:`);
      console.log(`  - user: ${saved.user}`);
      console.log(`  - actor: ${saved.actor}`);
    }
    await post.save();
    res.json({ ok: true, likes: post.likes, liked: !already });
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

const addComment = async (req, res) => {
  try {
    const { text, replyTo } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "Empty" });
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Not found" });

    // DEBUG: Log who is commenting
    console.log(
      `[addComment] Post owner: ${post.owner}, Current user (commenter): ${req.user._id}, replyTo: ${replyTo}`
    );

    // resolve mentions usernames -> user ids and attach to comment
    const mentionsInput = Array.isArray(req.body.mentions)
      ? req.body.mentions
      : [];
    const mentionsIds = [];
    if (mentionsInput.length > 0) {
      for (const username of mentionsInput) {
        try {
          if (!username || typeof username !== "string") continue;
          const u = await User.findOne({ username: username }).select("_id");
          if (u) mentionsIds.push(u._id);
        } catch (e) {
          console.warn("[addComment] mention lookup failed for", username, e);
        }
      }
    }

    const comment = new Comment({
      post: post._id,
      user: req.user._id,
      text,
      replyTo: replyTo || undefined,
      mentions: mentionsIds,
    });
    await comment.save();
    post.comments = post.comments || [];
    post.comments.push(comment._id);
    post.commentsCount = (post.commentsCount || 0) + 1;
    await post.save();

    // include meta info so frontend can route (post vs reel)
    const kind = post.type === "video" ? "reel" : "post";
    const snippet = (String(text || "") || "").substring(0, 160);

    const notif = await Notification.create({
      user: post.owner,
      type: "comment",
      actor: req.user._id,
      post: post._id,
      comment: comment._id,
      meta: { kind, snippet },
    });

    // Emit notification to the post owner (if not the commenter)
    try {
      if (String(post.owner) !== String(req.user._id)) {
        const actorProfile = {
          _id: req.user._id,
          username: req.user.username,
          displayName: req.user.displayName,
          avatar: req.user.profilePic || req.user.avatar,
        };
        emitter.emit("notification", {
          userId: String(post.owner),
          notification: {
            type: "comment",
            from: req.user._id,
            actor: actorProfile,
            post: post._id,
            comment: comment._id,
            meta: { kind },
          },
        });
      }
    } catch (e) {
      console.warn("[addComment] emit notification failed:", e.message || e);
    }
    console.log(
      `[addComment] Notification created - Recipient: ${notif.user}, Actor: ${notif.actor}`
    );

    // If the comment text contained @mentions, create mention notifications
    // Expect `mentions` to be an array of usernames in the request body
    try {
      const mentions = Array.isArray(req.body.mentions)
        ? req.body.mentions
        : [];
      if (mentions.length > 0) {
        for (const username of mentions) {
          try {
            if (!username || typeof username !== "string") continue;
            const mentioned = await User.findOne({ username: username });
            if (!mentioned) continue;
            // Don't notify the commenter themself
            if (String(mentioned._id) === String(req.user._id)) continue;
            // Create a mention notification and include meta about kind (post vs reel)
            await Notification.create({
              user: mentioned._id,
              type: "mention",
              actor: req.user._id,
              post: post._id,
              comment: comment._id,
              meta: { kind, snippet },
            });

            // Emit a realtime notification to the mentioned user
            try {
              if (String(mentioned._id) !== String(req.user._id)) {
                const actorProfile = {
                  _id: req.user._id,
                  username: req.user.username,
                  displayName: req.user.displayName,
                  avatar: req.user.profilePic || req.user.avatar,
                };
                emitter.emit("notification", {
                  userId: String(mentioned._id),
                  notification: {
                    type: "mention",
                    from: req.user._id,
                    actor: actorProfile,
                    post: post._id,
                    comment: comment._id,
                    meta: { kind, snippet },
                  },
                });
              }
            } catch (innerEmitErr) {
              console.warn(
                `[addComment] emit mention notification failed for ${username}:`,
                innerEmitErr.message || innerEmitErr
              );
            }
          } catch (inner) {
            console.warn(
              `[addComment] failed to create mention for ${username}:`,
              inner.message || inner
            );
          }
        }
      }
    } catch (e) {
      console.warn("[addComment] mentions processing failed", e);
    }

    // Populate comment with user data before returning
    const populatedComment = await Comment.findById(comment._id)
      .populate("user", "username displayName avatar profilePic")
      .populate("mentions", "username displayName profilePic");

    console.log("[addComment] Response comment:", {
      id: populatedComment._id,
      user: populatedComment.user,
      text: populatedComment.text,
      replyTo: populatedComment.replyTo,
    });

    res.status(201).json(populatedComment);
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

const toggleCommentLike = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    console.log(
      `[toggleCommentLike] postId: ${postId}, commentId: ${commentId}, userId: ${req.user._id}`
    );

    const CommentModel = Comment; // alias
    const comment = await CommentModel.findById(commentId);
    if (!comment) {
      console.log(`[toggleCommentLike] Comment not found: ${commentId}`);
      return res.status(404).json({ error: "Not found" });
    }

    // Ensure likedBy is always an array
    if (!Array.isArray(comment.likedBy)) {
      comment.likedBy = [];
    }

    console.log(`[toggleCommentLike] Comment found:`, {
      _id: comment._id,
      text: comment.text,
      likedBy: comment.likedBy,
      likes: comment.likes,
    });

    const already = comment.likedBy.some(
      (u) => String(u) === String(req.user._id)
    );
    console.log(`[toggleCommentLike] Already liked: ${already}`);

    if (already) {
      comment.likedBy = comment.likedBy.filter(
        (u) => String(u) !== String(req.user._id)
      );
      comment.likes = Math.max(0, (comment.likes || 1) - 1);
    } else {
      comment.likedBy.push(req.user._id);
      comment.likes = (comment.likes || 0) + 1;
      // notify the comment owner (if not liking own comment)
      if (String(comment.user) !== String(req.user._id)) {
        Notification.create({
          user: comment.user,
          type: "like",
          actor: req.user._id,
          post: comment.post,
          comment: comment._id,
        }).catch(console.warn);
      }
    }
    await comment.save();
    res.json({ ok: true, likes: comment.likes, liked: !already });
  } catch (e) {
    console.error("[toggleCommentLike] ERROR:", e);
    res.status(500).json({ error: "Server error", details: e.message });
  }
};

const toggleRepost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Not found" });
    const already = post.repostedBy.some(
      (u) => String(u) === String(req.user._id)
    );
    if (already) {
      post.repostedBy = post.repostedBy.filter(
        (u) => String(u) !== String(req.user._id)
      );
      post.reposts = Math.max(0, (post.reposts || 1) - 1);
    } else {
      post.repostedBy.push(req.user._id);
      post.reposts = (post.reposts || 0) + 1;
      Notification.create({
        user: post.owner,
        type: "repost",
        actor: req.user._id,
        post: post._id,
      }).catch(console.warn);
    }
    await post.save();
    res.json({ ok: true, reposts: post.reposts, reposted: !already });
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

const updatePost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Not found" });
    // only owner can edit
    if (String(post.owner) !== String(req.user._id))
      return res.status(403).json({ error: "Not authorized" });

    const { caption } = req.body;
    if (typeof caption !== "undefined") post.caption = caption;
    await post.save();
    // populate owner and comments for client convenience
    const out = await Post.findById(post._id)
      .populate("owner", "username displayName avatar profilePic")
      .populate({
        path: "comments",
        populate: {
          path: "user",
          select: "username displayName avatar profilePic",
        },
      })
      .lean();
    res.json(out);
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

const deletePost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Not found" });
    if (String(post.owner) !== String(req.user._id))
      return res.status(403).json({ error: "Not authorized" });

    // ✅ FIX: Delete all comments associated with this post before deleting the post
    const commentIds = post.comments || [];
    if (commentIds.length > 0) {
      const deletedComments = await Comment.deleteMany({
        _id: { $in: commentIds },
      });
      console.log(
        `🗑️ [deletePost] Deleted ${deletedComments.deletedCount} comments for post ${post._id}`
      );
    }

    // ✅ FIX: Also delete notifications related to this post
    const deletedNotifications = await Notification.deleteMany({
      $or: [{ "meta.postId": post._id }, { post: post._id }],
    });
    console.log(
      `🔔 [deletePost] Deleted ${deletedNotifications.deletedCount} notifications for post ${post._id}`
    );

    await Post.deleteOne({ _id: post._id });
    return res.json({ ok: true });
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = {
  createPost,
  getFeed,
  toggleLike,
  addComment,
  toggleCommentLike,
  toggleRepost,
  updatePost,
  deletePost,
};
